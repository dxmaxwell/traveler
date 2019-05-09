/**
 * Implement Form route handlers
 */

import sanitize = require('@mapbox/sanitize-caja');

import * as express from 'express';
import * as mongoose from 'mongoose';

import * as handlers from '../shared/handlers';

import * as auth from '../lib/auth';
import * as reqUtils from '../lib/req-utils';
import * as shareLib from '../lib/share';
import * as Uploader from '../lib/uploader';

import {
  Form,
  FormFile,
} from '../model/form';

import {
  Group,
  User,
} from '../model/user';

import {
  Group as ShareGroup,
  User as ShareUser,
} from '../model/share';

import {
  error,
} from '../shared/logging';

let serviceUrl = '';

export function getServiceUrl(): string {
  return serviceUrl;
}

export function setServiceUrl(url: string) {
  serviceUrl = url;
}

let uploader: Uploader.Instance;

export function setUploader(u: Uploader.Instance) {
  uploader = u;
}

export function init(app: express.Application) {

  app.get('/forms', auth.ensureAuthenticated, (req, res) => {
    res.render('forms');
  });

  app.get('/forms/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Form.find({
      createdBy: req.session.userid,
      archived: {
        $ne: true,
      },
      owner: {
        $exists: false,
      },
    }, 'title createdBy createdOn updatedBy updatedOn publicAccess sharedWith sharedGroup').exec((err, forms) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      res.status(200).json(forms);
    });
  });

  app.get('/transferredforms/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Form.find({
      owner: req.session.userid,
      archived: {
        $ne: true,
      },
    // tslint:disable:max-line-length
    }, 'title createdBy createdOn updatedBy updatedOn transferredOn publicAccess sharedWith sharedGroup').exec((err, forms) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      res.status(200).json(forms);
    });
  });

  app.get('/sharedforms/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    User.findOne({
      _id: req.session.userid,
    }, 'forms').exec((err, me) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!me) {
        return res.status(400).send('cannot identify the current user');
      }
      Form.find({
        _id: {
          $in: me.forms,
        },
        archived: {
          $ne: true,
        },
      }, 'title owner updatedBy updatedOn publicAccess sharedWith sharedGroup').exec((fErr, forms) => {
        if (fErr) {
          error(fErr);
          return res.status(500).send(fErr.message);
        }
        res.status(200).json(forms);
      });
    });
  });

  app.get('/groupsharedforms/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Group.find({
      _id: {
        $in: req.session.memberOf,
      },
    }, 'forms').exec((err, groups) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      const formids = [];
      let i;
      let j;
      // merge the forms arrays
      for (i = 0; i < groups.length; i += 1) {
        for (j = 0; j < groups[i].forms.length; j += 1) {
          if (formids.indexOf(groups[i].forms[j]) === -1) {
            formids.push(groups[i].forms[j]);
          }
        }
      }
      Form.find({
        _id: {
          $in: formids,
        },
        archived: {
          $ne: true,
        },
      }, 'title owner updatedBy updatedOn publicAccess sharedWith sharedGroup').exec((fErr, forms) => {
        if (fErr) {
          error(fErr);
          return res.status(500).send(fErr.message);
        }
        res.status(200).json(forms);
      });
    });
  });

  app.get('/archivedforms/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Form.find({
      createdBy: req.session.userid,
      archived: true,
    }, 'title archivedOn sharedWith sharedGroup').exec((err, forms) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      res.status(200).json(forms);
    });
  });

  app.get('/publicforms', auth.ensureAuthenticated, (req, res) => {
    res.render('public-forms');
  });

  app.get('/publicforms/json', auth.ensureAuthenticated, (req, res) => {
    Form.find({
      publicAccess: {
        $in: [0, 1],
      },
      archived: {
        $ne: true,
      },
    }).exec((err, forms) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      res.status(200).json(forms);
    });
  });

  app.get('/forms/new', auth.ensureAuthenticated, (req, res) => {
    return res.render('form-new', {
      // prefix: req.proxied ? req.proxied_prefix : ''
      prefix: '',
    });
  });

  app.get('/forms/:id', auth.ensureAuthenticated, reqUtils.exist('id', Form), (req, res) => {
    const form: Form = (req as any)[req.params.id];
    const access = reqUtils.getAccess(req, form);

    if (access === -1) {
      return res.status(403).send('you are not authorized to access this resource');
    }

    if (form.archived) {
      return res.redirect(serviceUrl + '/forms/' + req.params.id + '/preview');
    }

    if (access === 1) {
      return res.render('form-builder', {
        id: req.params.id,
        title: form.title,
        html: form.html,
        status: form.status,
        prefix: '',
        // prefix: req.proxied ? req.proxied_prefix : ''
      });
    }

    return res.redirect(serviceUrl + '/forms/' + req.params.id + '/preview');
  });

  app.get('/forms/:id/json', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.canReadMw('id'), (req, res) => {
    return res.status(200).json((req as any)[req.params.id]);
  });

  app.post('/forms/:id/uploads', auth.ensureAuthenticated, uploader.singleParam('body', 'name'), reqUtils.exist('id', Form), reqUtils.canReadMw('id'), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const doc: Form = (req as any)[req.params.id];
    if (!req.file) {
      return res.status(400).send('Expected one uploaded file');
    }

    if (!req.body.name) {
      return res.status(400).send('Expected input name');
    }

    const file = new FormFile({
      form: doc._id,
      value: req.file.originalname,
      file: {
        path: req.file.path,
        encoding: req.file.encoding,
        mimetype: req.file.mimetype,
      },
      inputType: req.body.type,
      uploadedBy: req.session.userid,
      uploadedOn: Date.now(),
    });

    file.save((saveErr, newfile) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      const url = serviceUrl + '/formfiles/' + newfile.id;
      res.set('Location', url);
      return res.status(201).send('The uploaded file is at <a target="_blank" href="' + url + '">' + url + '</a>');
    });
  });

  app.get('/formfiles/:id', auth.ensureAuthenticated, reqUtils.exist('id', FormFile), (req, res) => {
    const data: FormFile = (req as any)[req.params.id];
    if (data.inputType === 'file' && data.file) {
      return res.sendfile(data.file.path);
    }
    return res.status(500).send('it is not a file');
  });

  app.get('/forms/:id/preview', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.canReadMw('id'), (req, res) => {
    const form: Form = (req as any)[req.params.id];
    return res.render('form-viewer', {
      id: req.params.id,
      title: form.title,
      html: form.html,
      // prefix: req.proxied ? req.proxied_prefix : ''
      prefix: '',
    });
  });

  app.get('/forms/:id/share', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), (req, res) => {
    const form: Form = (req as any)[req.params.id];
    return res.render('share', {
      type: 'form',
      id: req.params.id,
      title: form.title,
      access: String(form.publicAccess),
    });
  });

  app.put('/forms/:id/share/public', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), reqUtils.filter('body', ['access']), (req, res) => {
    const form: Form = (req as any)[req.params.id];
    // change the access
    let access = req.body.access;
    if (['-1', '0', '1'].indexOf(access) === -1) {
      return res.status(400).send('not valid value');
    }
    access = Number(access);
    if (form.publicAccess === access) {
      return res.send(204);
    }
    form.publicAccess = access;
    form.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.status(200).send('public access is set to ' + req.body.access);
    });
  });

  app.get('/forms/:id/share/:list/json', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), (req, res) => {
    const form: Form = (req as any)[req.params.id];
    if (req.params.list === 'users') {
      return res.status(200).json(form.sharedWith || []);
    }
    if (req.params.list === 'groups') {
      return res.status(200).json(form.sharedGroup || []);
    }
    return res.status(400).send('unknown share list.');
  });

  app.post('/forms/:id/share/:list', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), (req, res) => {
    const form: Form = (req as any)[req.params.id];
    let share = -2;
    if (req.params.list === 'users') {
      if (req.body.name) {
        share = reqUtils.getSharedWith(form.sharedWith, req.body.name);
      } else {
        return res.status(400).send('user name is empty.');
      }
    }
    if (req.params.list === 'groups') {
      if (req.body.id) {
        share = reqUtils.getSharedGroup(form.sharedGroup, req.body.id);
      } else {
        return res.status(400).send('group id is empty.');
      }
    }

    if (share === -2) {
      return res.status(400).send('unknown share list.');
    }

    if (share >= 0) {
      return res.status(400).send(req.body.name || req.body.id + ' is already in the ' + req.params.list + ' list.');
    }

    if (share === -1) {
      // new user
      shareLib.addShare(req, res, form);
    }
  });

  app.put('/forms/:id/share/:list/:shareid', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), reqUtils.filter('body', ['access']), (req, res) => {
    const form: Form = (req as any)[req.params.id];
    let share: ShareGroup | ShareUser | undefined;
    if (req.params.list === 'users') {
      share = form.sharedWith.id(req.params.shareid);
    }
    if (req.params.list === 'groups') {
      share = form.sharedGroup.id(req.params.shareid);
    }
    if (!share) {
      return res.status(400).send('cannot find ' + req.params.shareid + ' in the list.');
    }
    // change the access
    if (req.body.access === 'write') {
      share.access = 1;
    } else if (req.body.access === 'read') {
      share.access = 0;
    } else {
      return res.status(400).send('cannot take the access ' + req.body.access);
    }
    form.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      // check consistency of user's form list
      let Target: mongoose.Model<Group | User> | undefined;
      if (req.params.list === 'users') {
        Target = User;
      }
      if (req.params.list === 'groups') {
        Target = Group;
      }
      if (Target) {
        Target.findByIdAndUpdate(req.params.shareid, {
          $addToSet: {
            forms: form._id,
          },
        }, (updateErr: any, target: any) => {
          if (updateErr) {
            error(updateErr);
          }
          if (!target) {
            error('The user/group ' + req.params.userid + ' is not in the db');
          }
        });
      }
      return res.status(200).json(share);
    });
  });

  app.delete('/forms/:id/share/:list/:shareid', reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), auth.ensureAuthenticated, (req, res) => {
    const form: Form = (req as any)[req.params.id];
    shareLib.removeShare(req, res, form);
  });

  app.post('/forms', auth.ensureAuthenticated, reqUtils.sanitize('body', ['html']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const form: {
      html?: unknown;
      clonedFrom?: unknown,
      title?: unknown;
      createdBy?: unknown;
      createdOn?: number
      sharedWith?: unknown[] } = {};
    if (req.body.html) {
      form.html = req.body.html;
      form.clonedFrom = req.body.id;
    } else {
      form.html = '';
    }
    form.title = req.body.title;
    form.createdBy = req.session.userid;
    form.createdOn = Date.now();
    form.sharedWith = [];
    (new Form(form)).save((err, newform) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      const url = serviceUrl + '/forms/' + newform.id + '/';

      res.set('Location', url);
      return res.status(201).send('You can see the new form at <a href="' + url + '">' + url + '</a>');
    });
  });

  app.post('/forms/:id/clone', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.canReadMw('id'), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const doc: Form = (req as any)[req.params.id];
    const form: {
      html?: unknown;
      clonedFrom?: unknown,
      title?: unknown;
      createdBy?: unknown;
      createdOn?: number
      sharedWith?: unknown[] } = {};
    form.html = sanitize(doc.html || '');
    form.title = sanitize(doc.title || '') + ' clone';
    form.createdBy = req.session.userid;
    form.createdOn = Date.now();
    form.clonedFrom = doc._id;
    form.sharedWith = [];

    (new Form(form)).save((saveErr, newform) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      const url = serviceUrl + '/forms/' + newform.id + '/';
      res.set('Location', url);
      return res.status(201).send('You can see the new form at <a href="' + url + '">' + url + '</a>');
    });
  });

  app.put('/forms/:id/archived', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), reqUtils.filter('body', ['archived']), (req, res) => {
    const doc: Form = (req as any)[req.params.id];
    if (doc.archived === req.body.archived) {
      return res.send(204);
    }

    doc.archived = req.body.archived;
    if (doc.archived) {
      doc.archivedOn = new Date();
    }

    doc.save((saveErr, newDoc) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.status(200).send('Form ' + req.params.id + ' archived state set to ' + newDoc.archived);
    });
  });

  app.put('/forms/:id/owner', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), reqUtils.filter('body', ['name']), (req, res) => {
    const doc: Form = (req as any)[req.params.id];
    shareLib.changeOwner(req, res, doc);
  });

  app.put('/forms/:id', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.canWriteMw('id'), reqUtils.status('id', [0]), reqUtils.filter('body', ['html', 'title']), reqUtils.sanitize('body', ['html', 'title']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    if (!req.is('json')) {
      return res.status(415).send('json request expected');
    }
    const doc: Form = (req as any)[req.params.id];
    if (req.body.hasOwnProperty('html')) {
      doc.html = req.body.html;
    }
    if (req.body.hasOwnProperty('title')) {
      if (reqUtils.isOwner(req, doc)) {
        doc.title = req.body.title;
      } else {
        res.status(403).send('not authorized to access this resource');
      }
    }

    doc.updatedBy = req.session.userid;
    doc.updatedOn = new Date();
    doc.save((saveErr, newDoc) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.json(newDoc);
    });
  });

  app.put('/forms/:id/status', auth.ensureAuthenticated, reqUtils.exist('id', Form), reqUtils.isOwnerMw('id'), reqUtils.filter('body', ['status']), reqUtils.hasAll('body', ['status']), (req, res) => {
    const f: Form = (req as any)[req.params.id];
    const s = req.body.status;

    if ([0, 0.5, 1, 2].indexOf(s) === -1) {
      return res.status(400).send('invalid status');
    }

    // no change
    if (f.status === s) {
      return res.send(204);
    }

    if (s === 0) {
      if ([0.5].indexOf(f.status) === -1) {
        return res.status(400).send('invalid status change');
      } else {
        f.status = s;
      }
    }

    if (s === 0.5) {
      if ([0].indexOf(f.status) === -1) {
        return res.status(400).send('invalid status change');
      } else {
        f.status = s;
      }
    }

    if (s === 1) {
      if ([0.5].indexOf(f.status) === -1) {
        return res.status(400).send('invalid status change');
      } else {
        f.status = s;
      }
    }

    if (s === 2) {
      if ([1].indexOf(f.status) === -1) {
        return res.status(400).send('invalid status change');
      } else {
        f.status = s;
      }
    }

    f.save((err) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).send('status updated to ' + s);
    });

  });
}
