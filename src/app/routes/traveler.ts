/**
 * Implements Traveler routes
 */

import * as fs from 'fs';

import * as express from 'express';
import * as mongoose from 'mongoose';

import * as auth from '../lib/auth';

import * as cheer from 'cheerio';

import * as handlers from '../shared/handlers';

import {
  error,
  info,
} from '../shared/logging';

import * as reqUtils from '../lib/req-utils';
import * as shareLib from '../lib/share';
import * as Uploader from '../lib/uploader';

import {
  Form,
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
  Traveler,
  TravelerData,
  TravelerNote,
} from '../model/traveler';

type Request = express.Request;
type Response = express.Response;

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

function createTraveler(form: Form, req: Request, res: Response) {
  if (!req.session) {
    return;
  }
  // update the total input number and finished input number
  const $ = cheer.load(form.html || '');
  const num = $('input, textarea').length;
  const traveler = new Traveler({
    title: form.title,
    description: '',
    devices: [],
    status: 0,
    createdBy: req.session.userid,
    createdOn: Date.now(),
    sharedWith: [],
    referenceForm: form._id,
    forms: [],
    data: [],
    comments: [],
    totalInput: num,
    finishedInput: 0,
  });
  traveler.forms.push({
    _id: undefined,
    html: form.html,
    activatedOn: [new Date()],
    reference: form._id,
    alias: form.title,
  });
  traveler.activeForm = traveler.forms[0]._id;
  traveler.save((err, doc) => {
    if (err) {
      error(err);
      return res.status(500).send(err.message);
    }
    info('new traveler ' + doc.id + ' created');
    const url = serviceUrl + '/travelers/' + doc.id + '/';
    res.set('Location', url);
    return res.status(201).json({
      // location: (req.proxied ? req.proxied_prefix : '') + '/travelers/' + doc.id + '/'
      location: res.locals.basePath + '/travelers/' + doc.id,
    });
  });
}

function cloneTraveler(source: Traveler, req: Request, res: Response) {
  if (!req.session) {
    res.status(500).send('Session not found');
    return;
  }
  const traveler = new Traveler({
    title: source.title + ' clone',
    description: source.description,
    devices: [],
    status: 1,
    createdBy: req.session.userid,
    createdOn: Date.now(),
    clonedBy: req.session.userid,
    clonedFrom: source._id,
    sharedWith: source.sharedWith,
    sharedGroup: source.sharedGroup,
    referenceForm: source.referenceForm,
    forms: source.forms,
    activeForm: source.activeForm,
    data: [],
    comments: [],
    totalInput: source.totalInput,
    finishedInput: 0,
  });

  traveler.save((err, doc) => {
    if (err) {
      error(err);
      return res.status(500).send(err.message);
    }
    info('new traveler ' + doc.id + ' created');
    doc.sharedWith.forEach((e) => {
      User.findByIdAndUpdate(e._id, {
        $addToSet: {
          travelers: doc._id,
        },
      }, (userErr, user) => {
        if (userErr) {
          error(userErr);
        }
        if (!user) {
          error('The user ' + e._id + ' does not in the db');
        }
      });
    });

    doc.sharedGroup.forEach((e) => {
      Group.findByIdAndUpdate(e._id, {
        $addToSet: {
          travelers: doc._id,
        },
      }, (groupErr, user) => {
        if (groupErr) {
          error(groupErr);
        }
        if (!user) {
          error('The group ' + e._id + ' does not in the db');
        }
      });
    });

    const url = serviceUrl + '/travelers/' + doc.id + '/';
    res.set('Location', url);
    return res.status(201).json({
      location: url,
    });
  });
}

export function init(app: express.Application) {

  app.get('/travelers', auth.ensureAuthenticated, (req, res) => {
    res.render('travelers');
  });

  app.get('/travelers/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Traveler.find({
      createdBy: req.session.userid,
      archived: {
        $ne: true,
      },
      owner: {
        $exists: false,
      },
    // tslint:disable:max-line-length
    }, 'title description status devices sharedWith sharedGroup publicAccess locations createdOn deadline updatedOn updatedBy manPower finishedInput totalInput').lean().exec((err, docs) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).json(docs);
    });
  });

  app.get('/transferredtravelers/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Traveler.find({
      owner: req.session.userid,
      archived: {
        $ne: true,
      },
    }, 'title description status devices sharedWith sharedGroup publicAccess locations createdOn transferredOn deadline updatedOn updatedBy manPower finishedInput totalInput').lean().exec((err, travelers) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      res.status(200).json(travelers);
    });
  });

  app.get('/sharedtravelers/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    User.findOne({
      _id: req.session.userid,
    }, 'travelers').exec((err, me) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!me) {
        return res.status(400).send('cannot identify the current user');
      }
      Traveler.find({
        _id: {
          $in: me.travelers,
        },
        archived: {
          $ne: true,
        },
      }, 'title description status devices locations createdBy createdOn owner deadline updatedBy updatedOn sharedWith sharedGroup publicAccess manPower finishedInput totalInput').lean().exec((tErr, travelers) => {
        if (tErr) {
          error(tErr);
          return res.status(500).send(tErr.message);
        }
        return res.status(200).json(travelers);
      });
    });
  });

  app.get('/groupsharedtravelers/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Group.find({
      _id: {
        $in: req.session.memberOf,
      },
    }, 'travelers').exec((err, groups) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      const travelerIds = [];
      let i;
      let j;
      // merge the travelers arrays
      for (i = 0; i < groups.length; i += 1) {
        for (j = 0; j < groups[i].travelers.length; j += 1) {
          if (travelerIds.indexOf(groups[i].travelers[j]) === -1) {
            travelerIds.push(groups[i].travelers[j]);
          }
        }
      }
      Traveler.find({
        _id: {
          $in: travelerIds,
        },
      }, 'title description status devices locations createdBy createdOn owner deadline updatedBy updatedOn sharedWith sharedGroup publicAccess manPower finishedInput totalInput').lean().exec((tErr, travelers) => {
        if (tErr) {
          error(tErr);
          return res.status(500).send(tErr.message);
        }
        res.status(200).json(travelers);
      });
    });
  });

  app.get('/publictravelers', auth.ensureAuthenticated, (req, res) => {
    res.render('public-travelers');
  });

  app.get('/publictravelers/json', auth.ensureAuthenticated, (req, res) => {
    Traveler.find({
      $or: [{
        publicAccess: {
          $in: [0, 1],
        },
      }, {
        publicAccess: {
          $exists: false,
        },
      }],
      archived: {
        $ne: true,
      },
    }, 'title description status devices locations createdBy createdOn owner deadline updatedBy updatedOn sharedWith sharedGroup').lean().exec((err, travelers) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      res.status(200).json(travelers);
    });
  });


  /*  app.get('/currenttravelers/json', auth.ensureAuthenticated, function (req, res) {
      var search = {
        archived: {
          $ne: true
        }
      };
      if (Object.prototype.hasOwnProperty.call(req.query, 'device')) {
        search.devices = {
          $in: [req.query.device]
        };
      }
      Traveler.find(search, 'title status devices createdBy clonedBy createdOn deadline updatedBy updatedOn sharedWith sharedGroup finishedInput totalInput').lean().exec(function (err, travelers) {
        if (err) {
          console.error(err);
          return res.status(500).send(err.message);
        }
        return res.status(200).json(travelers);
      });
    });

    app.get('/currenttravelersinv1/json', auth.ensureAuthenticated, function (req, res) {
      var fullurl = config.legacy_traveler.travelers;
      if (Object.prototype.hasOwnProperty.call(req.query, 'device')) {
        fullurl = config.legacy_traveler.devices + req.query.device;
      }
      request({
        strictSSL: false,
        url: fullurl
      }).pipe(res);
    });

    app.get('/currenttravelers', auth.ensureAuthenticated, function (req, res) {
      return res.render('currenttravelers', {
        device: req.query.device || null
      });
    });*/

  app.get('/archivedtravelers/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    const search = {
      $and: [{
        $or: [{
          createdBy: req.session.userid,
          owner: {
            $exists: false,
          },
        }, {
          owner: req.session.userid,
        }],
      }, {
        archived: true,
      }],
    };
    Traveler.find(search, 'title description status devices locations archivedOn updatedBy updatedOn deadline sharedWith sharedGroup manPower finishedInput totalInput').lean().exec((err, travelers) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).json(travelers);
    });
  });

  app.post('/travelers', auth.ensureAuthenticated, reqUtils.filter('body', ['form', 'source']), (req, res) => {
    if (req.body.form) {
      Form.findById(req.body.form, (err, form) => {
        if (err) {
          error(err);
          return res.status(500).send(err.message);
        }
        if (form) {
          createTraveler(form, req, res);
        } else {
          return res.status(400).send('cannot find the form ' + req.body.form);
        }
      });
    }
    if (req.body.source) {
      Traveler.findById(req.body.source, (err, traveler) => {
        if (err) {
          error(err);
          return res.status(500).send(err.message);
        }
        if (traveler) {
          // if (traveler.status === 0) {
          //   return res.status(400).send('You cannot clone an initialized traveler.');
          // }
          if (reqUtils.canRead(req, traveler)) {
            cloneTraveler(traveler, req, res);
          } else {
            return res.status(400).send('You cannot clone a traveler that you cannot read.');
          }
        } else {
          return res.status(400).send('cannot find the traveler ' + req.body.source);
        }
      });
    }
  });

  app.get('/travelers/:id', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
    if (doc.archived) {
      return res.redirect(serviceUrl + '/travelers/' + req.params.id + '/view');
    }

    if (reqUtils.canWrite(req, doc)) {
      return res.render('traveler', {
        isOwner: reqUtils.isOwner(req, doc),
        traveler: doc,
        formHTML: doc.forms.length === 1 ? doc.forms[0].html : doc.forms.id(doc.activeForm as any).html,
      });
    }

    if (reqUtils.canRead(req, doc)) {
      return res.redirect(serviceUrl + '/travelers/' + req.params.id + '/view');
    }

    return res.status(403).send('You are not authorized to access this resource');
  });

  app.get('/travelers/:id/view', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), (req, res) => {
    return res.render('traveler-viewer', {
      traveler: (req as any)[req.params.id],
    });
  });

  app.get('/travelers/:id/json', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.canReadMw('id'), (req, res) => {
    return res.status(200).json((req as any)[req.params.id]);
  });

  app.put('/travelers/:id/archived', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.filter('body', ['archived']), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
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
      return res.status(200).send('traveler ' + req.params.id + ' archived state set to ' + newDoc.archived);
    });

  });

  app.put('/travelers/:id/owner', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.status('id', [0, 1, 1.5]), reqUtils.filter('body', ['name']), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
    shareLib.changeOwner(req, res, doc);
  });

  app.get('/travelers/:id/config', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
    return res.render('traveler-config', {
      traveler: doc,
      isOwner: reqUtils.isOwner(req, doc),
    });
  });

  app.get('/travelers/:id/formmanager', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), (req, res) => {
    res.render('form-manager', {
      traveler: (req as any)[req.params.id],
    });
  });

  // use the form in the request as the active form
  app.post('/travelers/:id/forms', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), reqUtils.status('id', [0, 1]), reqUtils.filter('body', ['html', '_id', 'title']), reqUtils.hasAll('body', ['html', '_id', 'title']), reqUtils.sanitize('body', ['html', 'title']), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
    if (doc.status > 1 || doc.archived) {
      return res.status(400).send('cannot update form because of current traveler state');
    }
    const form = {
      html: req.body.html,
      activatedOn: [Date.now()],
      reference: req.body._id,
      alias: req.body.title,
    };

    const $ = cheer.load(form.html);
    const num = $('input, textarea').length;
    doc.forms.push(form);
    doc.activeForm = doc.forms[doc.forms.length - 1]._id;
    doc.totalInput = num;
    doc.save(function saveDoc(e, newDoc) {
      if (e) {
        error(e);
        return res.status(500).send(e.message);
      }
      return res.status(200).json(newDoc);
    });
  });

  // set active form
  app.put('/travelers/:id/forms/active', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), reqUtils.status('id', [0, 1]), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
    if (doc.status > 1 || doc.archived) {
      return res.status(400).send('cannot update form because of current traveler state');
    }
    const formid = req.body.formid;
    if (!formid) {
      return res.status(400).send('form id unknown');
    }

    const form = doc.forms.id(formid);

    if (!form) {
      return res.status(410).send('form ' + req.body.formid + ' gone');
    }

    doc.activeForm = form._id;
    const $ = cheer.load(form.html || '');
    const num = $('input, textarea').length;
    form.activatedOn.push(new Date());
    doc.totalInput = num;
    doc.save(function saveDoc(e, newDoc) {
      if (e) {
        error(e);
        return res.status(500).send(e.message);
      }
      return res.status(200).json(newDoc);
    });
  });

  // set form alias
  app.put('/travelers/:id/forms/:fid/alias', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), reqUtils.status('id', [0, 1]), reqUtils.filter('body', ['value']), reqUtils.sanitize('body', ['value']), function putFormAlias(req, res) {
    const doc: Traveler = (req as any)[req.params.id];
    if (doc.status > 1 || doc.archived) {
      return res.status(400).send('cannot update form because of current traveler state');
    }
    const form = doc.forms.id(req.params.fid);
    if (!form) {
      return res.status(410).send('from ' + req.params.fid + ' not found.');
    }

    form.alias = req.body.value;

    doc.save((e) => {
      if (e) {
        error(e);
        return res.status(500).send(e.message);
      }
      return res.send(204);
    });
  });

  app.put('/travelers/:id/config', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), reqUtils.status('id', [0, 1]), reqUtils.filter('body', ['title', 'description', 'deadline']), reqUtils.sanitize('body', ['title', 'description', 'deadline']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    const doc: Traveler = (req as any)[req.params.id];
    let k;
    for (k in req.body) {
      if (req.body.hasOwnProperty(k) && req.body[k] !== null) {
        (doc as any)[k] = req.body[k];
      }
    }
    doc.updatedBy = req.session.userid;
    doc.updatedOn = new Date();
    doc.save((saveErr, newDoc) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      const out = {};
      for (k in req.body) {
        if (req.body.hasOwnProperty(k) && req.body[k] !== null) {
          (out as any)[k] = newDoc.get(k);
        }
      }
      return res.status(200).json(out);
    });
  });

  app.put('/travelers/:id/status', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.canWriteMw('id'), reqUtils.archived('id', false), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const doc: Traveler = (req as any)[req.params.id];

    if ([1, 1.5, 2, 3].indexOf(req.body.status) === -1) {
      return res.status(400).send('invalid status');
    }

    if (doc.status === req.body.status) {
      return res.send(204);
    }

    if (req.body.status !== 1.5 && !reqUtils.isOwner(req, doc)) {
      return res.status(403).send('You are not authorized to change the status. ');
    }

    if (req.body.status === 1) {
      if ([0, 1.5, 3].indexOf(doc.status) !== -1) {
        doc.status = 1;
      } else {
        return res.status(400).send('cannot start to work from the current status. ');
      }
    }

    if (req.body.status === 1.5) {
      if ([1].indexOf(doc.status) !== -1) {
        doc.status = 1.5;
      } else {
        return res.status(400).send('cannot complete from the current status. ');
      }
    }

    if (req.body.status === 2) {
      if ([1.5].indexOf(doc.status) !== -1) {
        doc.status = 2;
      } else {
        return res.status(400).send('cannot complete from the current status. ');
      }
    }

    if (req.body.status === 3) {
      if ([1].indexOf(doc.status) !== -1) {
        doc.status = 3;
      } else {
        return res.status(400).send('cannot freeze from the current status. ');
      }
    }

    doc.updatedBy = req.session.userid;
    doc.updatedOn = new Date();
    doc.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.status(200).send('status updated to ' + req.body.status);
    });
  });


  app.post('/travelers/:id/devices', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), reqUtils.status('id', [0, 1]), reqUtils.filter('body', ['newdevice']), reqUtils.sanitize('body', ['newdevice']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const newdevice = req.body.newdevice;
    if (!newdevice) {
      return res.status(400).send('the new device name not accepted');
    }
    const doc: Traveler = (req as any)[req.params.id];
    doc.updatedBy = req.session.userid;
    doc.updatedOn = new Date();
    const added = doc.devices.addToSet(newdevice);
    if (added.length === 0) {
      return res.send(204);
    }
    doc.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.status(200).json({
        device: newdevice,
      });
    });
  });

  app.delete('/travelers/:id/devices/:number', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), reqUtils.status('id', [0, 1]), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const doc: Traveler = (req as any)[req.params.id];
    doc.updatedBy = req.session.userid;
    doc.updatedOn = new Date();
    doc.devices.pull(req.params.number);
    doc.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.send(204);
    });
  });

  app.get('/travelers/:id/data', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.canReadMw('id'), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
    TravelerData.find({
      _id: {
        $in: doc.data,
      },
    }, 'name value inputType inputBy inputOn').exec((dataErr, docs) => {
      if (dataErr) {
        error(dataErr);
        return res.status(500).send(dataErr.message);
      }
      return res.status(200).json(docs);
    });
  });

  app.post('/travelers/:id/data', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.archived('id', false), reqUtils.canWriteMw('id'), reqUtils.status('id', [1]), reqUtils.filter('body', ['name', 'value', 'type']), reqUtils.hasAll('body', ['name', 'value', 'type']), reqUtils.sanitize('body', ['name', 'value', 'type']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const doc: Traveler = (req as any)[req.params.id];
    const data = new TravelerData({
      traveler: doc._id,
      name: req.body.name,
      value: req.body.value,
      inputType: req.body.type,
      inputBy: req.session.userid,
      inputOn: Date.now(),
    });
    data.save((dataErr) => {
      if (dataErr) {
        error(dataErr);
        return res.status(500).send(dataErr.message);
      }
      if (!req.session) {
        res.status(500).send('Session not found');
        return;
      }
      doc.data.push(data._id);
      doc.manPower.addToSet({
        _id: req.session.userid,
        username: req.session.username,
      });
      doc.updatedBy = req.session.userid;
      doc.updatedOn = new Date();
      doc.save((saveErr) => {
        if (saveErr) {
          error(saveErr);
          return res.status(500).send(saveErr.message);
        }
        return res.send(204);
      });
    });
  });

  app.get('/travelers/:id/notes', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.canReadMw('id'), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
    TravelerNote.find({
      _id: {
        $in: doc.notes,
      },
    }, 'name value inputBy inputOn').exec((noteErr, docs) => {
      if (noteErr) {
        error(noteErr);
        return res.status(500).send(noteErr.message);
      }
      return res.status(200).json(docs);
    });
  });

  app.post('/travelers/:id/notes', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.archived('id', false), reqUtils.canWriteMw('id'), reqUtils.filter('body', ['name', 'value']), reqUtils.hasAll('body', ['name', 'value']), reqUtils.sanitize('body', ['name', 'value']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    const doc: Traveler = (req as any)[req.params.id];
    const note = new TravelerNote({
      traveler: doc._id,
      name: req.body.name,
      value: req.body.value,
      inputBy: req.session.userid,
      inputOn: Date.now(),
    });
    note.save((noteErr) => {
      if (noteErr) {
        error(noteErr);
        return res.status(500).send(noteErr.message);
      }
      if (!req.session) {
        res.status(500).send('Session not found');
        return;
      }
      doc.notes.push(note._id);
      doc.manPower.addToSet({
        _id: req.session.userid,
        username: req.session.username,
      });
      doc.updatedBy = req.session.userid;
      doc.updatedOn = new Date();
      doc.save((saveErr) => {
        if (saveErr) {
          error(saveErr);
          return res.status(500).send(saveErr.message);
        }
        return res.send(204);
      });
    });
  });

  app.put('/travelers/:id/finishedinput', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.canWriteMw('id'), reqUtils.status('id', [1, 1.5, 2]), reqUtils.filter('body', ['finishedInput']), (req, res) => {
    const doc: Traveler = (req as any)[req.params.id];
    doc.update({
      finishedInput: req.body.finishedInput,
    }, (saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.send(204);
    });
  });

  app.post('/travelers/:id/uploads', auth.ensureAuthenticated, uploader.singleParam('body', 'name'), reqUtils.exist('id', Traveler), reqUtils.canWriteMw('id'), reqUtils.status('id', [1]), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const doc: Traveler = (req as any)[req.params.id];

    if (!req.file) {
      return res.status(400).send('Expected one uploaded file');
    }

    const data = new TravelerData({
      traveler: doc._id,
      name: req.body.name,
      value: req.file.originalname,
      file: {
        path: req.file.path,
        encoding: req.file.encoding,
        mimetype: req.file.mimetype,
      },
      inputType: req.body.type,
      inputBy: req.session.userid,
      inputOn: Date.now(),
    });

    data.save((dataErr) => {
      if (dataErr) {
        error(dataErr);
        return res.status(500).send(dataErr.message);
      }
      if (!req.session) {
        res.status(500).send('Session not found');
        return;
      }
      doc.data.push(data._id);
      doc.updatedBy = req.session.userid;
      doc.updatedOn = new Date();
      doc.save((saveErr) => {
        if (saveErr) {
          error(saveErr);
          return res.status(500).send(saveErr.message);
        }
        const url = serviceUrl + '/data/' + data._id;
        res.set('Location', url);
        return res.status(201).json({
          location: url,
        });
      });
    });
  });

  app.get('/data/:id', auth.ensureAuthenticated, reqUtils.exist('id', TravelerData), (req, res) => {
    const data: TravelerData = (req as any)[req.params.id];
    if (data.inputType === 'file' && data.file) {
      const filePath = data.file.path;
      fs.exists(filePath, (exists) => {
        if (exists) {
          return res.sendfile(filePath);
        }
        return res.status(410).send('gone');
      });
    } else {
      res.status(200).json(data);
    }
  });

  app.get('/travelers/:id/share', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), (req, res) => {
    const traveler: Traveler = (req as any)[req.params.id];
    return res.render('share', {
      type: 'Traveler',
      id: req.params.id,
      title: traveler.title,
      access: String(traveler.publicAccess),
    });
  });

  app.put('/travelers/:id/share/public', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), reqUtils.filter('body', ['access']), (req, res) => {
    const traveler: Traveler = (req as any)[req.params.id];
    // change the access
    let access = req.body.access;
    if (['-1', '0', '1'].indexOf(access) === -1) {
      return res.status(400).send('not valid value');
    }
    access = Number(access);
    if (traveler.publicAccess === access) {
      return res.send(204);
    }
    traveler.publicAccess = access;
    traveler.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.status(200).send('public access is set to ' + req.body.access);
    });
  });

  app.get('/travelers/:id/share/:list/json', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), (req, res) => {
    const traveler: Traveler = (req as any)[req.params.id];
    if (req.params.list === 'users') {
      return res.status(200).json(traveler.sharedWith || []);
    }
    if (req.params.list === 'groups') {
      return res.status(200).json(traveler.sharedGroup || []);
    }
    return res.status(400).send('unknown share list.');
  });

  app.post('/travelers/:id/share/:list', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), (req, res) => {
    const traveler: Traveler = (req as any)[req.params.id];
    let share = -2;
    if (req.params.list === 'users') {
      if (req.body.name) {
        share = reqUtils.getSharedWith(traveler.sharedWith, req.body.name);
      } else {
        return res.status(400).send('user name is empty.');
      }
    }
    if (req.params.list === 'groups') {
      if (req.body.id) {
        share = reqUtils.getSharedGroup(traveler.sharedGroup, req.body.id);
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
      shareLib.addShare(req, res, traveler);
    }
  });

  app.put('/travelers/:id/share/:list/:shareid', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), (req, res) => {
    const traveler: Traveler = (req as any)[req.params.id];
    let share: ShareUser | ShareGroup | undefined;
    if (req.params.list === 'users') {
      share = traveler.sharedWith.id(req.params.shareid);
    }
    if (req.params.list === 'groups') {
      share = traveler.sharedGroup.id(req.params.shareid);
    }
    if (!share) {
      return res.status(400).send('cannot find ' + req.params.shareid + ' in the list.');
    }
    // change the access
    if (req.body.access && req.body.access === 'write') {
      share.access = 1;
    } else {
      share.access = 0;
    }
    traveler.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      // check consistency of user's traveler list
      let Target: mongoose.Model<User | Group> | undefined;
      if (req.params.list === 'users') {
        Target = User;
      }
      if (req.params.list === 'groups') {
        Target = Group;
      }
      if (Target) {
        Target.findByIdAndUpdate(req.params.shareid, {
          $addToSet: {
            travelers: traveler._id,
          },
        }, (updateErr, target) => {
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

  app.delete('/travelers/:id/share/:list/:shareid', auth.ensureAuthenticated, reqUtils.exist('id', Traveler), reqUtils.isOwnerMw('id'), reqUtils.archived('id', false), (req, res) => {
    const traveler: Traveler = (req as any)[req.params.id];
    shareLib.removeShare(req, res, traveler);
  });

}
