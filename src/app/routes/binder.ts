/**
 * Implement binder route handlers
 */
import * as express from 'express';
import * as mongoose from 'mongoose';
import * as underscore from 'underscore';

import * as handlers from '../shared/handlers';

import * as auth from '../lib/auth';
import * as reqUtils from '../lib/req-utils';
import * as shareLib from '../lib/share';

import {
  Group,
  User,
} from '../model/user';

import {
  Group as ShareGroup,
  User as ShareUser,
} from '../model/share';

import {
  Binder,
  Work,
} from '../model/binder';

import {
  Traveler,
} from '../model/traveler';

import {
  error,
} from '../shared/logging';

type ObjectId = mongoose.Types.ObjectId;

type Request = express.Request;
type Response = express.Response;

let serviceUrl = '';

export function getServiceUrl(): string {
  return serviceUrl;
}

export function setServiceUrl(url: string) {
  serviceUrl = url;
}

export function init(app: express.Application) {

  app.get('/binders', auth.ensureAuthenticated, (req, res) => {
    res.render('binders');
  });

  app.get('/binders/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Binder.find({
      createdBy: req.session.userid,
      archived: {
        $ne: true,
      },
      owner: {
        $exists: false,
      },
    }).exec((err, docs) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).json(docs);
    });
  });

  // tslint:disable:max-line-length
  app.get('/binders/:id/config', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canWriteMw('id'), (req, res) => {
    return res.render('binder-config', {
      binder: (req as any)[req.params.id],
    });
  });

  app.post('/binders/:id/tags', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canWriteMw('id'), reqUtils.filter('body', ['newtag']), reqUtils.sanitize('body', ['newtag']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    const doc: Binder = (req as any)[req.params.id];
    doc.updatedBy = req.session.userid;
    doc.updatedOn = new Date();
    doc.tags.addToSet(req.body.newtag);
    doc.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.send(204);
    });
  });

  app.delete('/binders/:id/tags/:tag', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canWriteMw('id'), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    const doc: Binder = (req as any)[req.params.id];
    doc.updatedBy = req.session.userid;
    doc.updatedOn = new Date();
    doc.tags.pull(req.params.tag);
    doc.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.send(204);
    });
  });

  app.put('/binders/:id/config', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), reqUtils.status('id', [0, 1]), reqUtils.filter('body', ['title', 'description']), reqUtils.sanitize('body', ['title', 'description']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    const doc: Binder = (req as any)[req.params.id];
    for (const k in req.body) {
      if (req.body.hasOwnProperty(k) && req.body[k] !== null) {
        (doc as any)[k] = req.body[k];
      }
    }
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


  app.get('/binders/:id/share', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), (req, res) => {
    const binder: Binder = (req as any)[req.params.id];
    return res.render('share', {
      type: 'Binder',
      id: req.params.id,
      title: binder.title,
      access: String(binder.publicAccess),
    });
  });

  app.put('/binders/:id/share/public', auth.ensureAuthenticated, reqUtils.filter('body', ['access']), reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), (req, res) => {
    const binder: Binder = (req as any)[req.params.id];
    let access = req.body.access;
    if (['-1', '0', '1'].indexOf(access) === -1) {
      return res.status(400).send('not valid value');
    }
    access = Number(access);
    if (binder.publicAccess === access) {
      return res.send(204);
    }
    binder.publicAccess = access;
    binder.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.status(200).send('public access is set to ' + req.body.access);
    });
  });

  app.get('/binders/:id/share/:list/json', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canReadMw('id'), (req, res) => {
    const binder: Binder = (req as any)[req.params.id];
    if (req.params.list === 'users') {
      return res.status(200).json(binder.sharedWith || []);
    }
    if (req.params.list === 'groups') {
      return res.status(200).json(binder.sharedGroup || []);
    }
    return res.status(400).send('unknown share list.');
  });

  app.post('/binders/:id/share/:list', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), (req, res) => {
    const binder: Binder = (req as any)[req.params.id];
    let share = -2;
    if (req.params.list === 'users') {
      if (req.body.name) {
        share = reqUtils.getSharedWith(binder.sharedWith, req.body.name);
      } else {
        return res.status(400).send('user name is empty.');
      }
    }
    if (req.params.list === 'groups') {
      if (req.body.id) {
        share = reqUtils.getSharedGroup(binder.sharedGroup, req.body.id);
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
      // new user in the list
      shareLib.addShare(req, res, binder);
    }
  });

  app.put('/binders/:id/share/:list/:shareid', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), (req, res) => {
    const binder: Binder = (req as any)[req.params.id];
    let share: ShareUser | ShareGroup | undefined;
    if (req.params.list === 'users') {
      share = binder.sharedWith.id(req.params.shareid);
    }
    if (req.params.list === 'groups') {
      share = binder.sharedGroup.id(req.params.shareid);
    }

    if (!share) {
      // the user should in the list
      return res.status(404).send('cannot find ' + req.params.shareid + ' in the list.');
    }

    // change the access
    if (req.body.access && req.body.access === 'write') {
      share.access = 1;
    } else {
      share.access = 0;
    }
    binder.save((saveErr) => {
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
            binders: binder._id,
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

  app.delete('/binders/:id/share/:list/:shareid', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), (req, res) => {
    const binder: Binder = (req as any)[req.params.id];
    shareLib.removeShare(req, res, binder);
  });

  app.get('/binders/new', auth.ensureAuthenticated, (req, res) => {
    res.render('binder-new');
  });

  app.post('/binders', auth.ensureAuthenticated, reqUtils.filter('body', ['title', 'description']), reqUtils.hasAll('body', ['title']), reqUtils.sanitize('body', ['title', 'description']), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    const binder: {
      works?: unknown[];
      title?: unknown;
      description?: unknown;
      createdBy?: unknown;
      createdOn?: number } = {};
    if (req.body.works && underscore.isArray(req.body.works)) {
      binder.works = req.body.works;
    } else {
      binder.works = [];
    }

    binder.title = req.body.title;
    if (req.body.description) {
      binder.description = req.body.description;
    }
    binder.createdBy = req.session.userid;
    binder.createdOn = Date.now();
    (new Binder(binder)).save((err, newPackage) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      const url = reqUtils.urijoin(serviceUrl, 'binders', newPackage.id);

      res.set('Location', url);
      return res.status(201).send('You can access the new binder at <a href="' + url + '">' + url + '</a>');
    });
  });

  app.get('/transferredbinders/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Binder.find({
      owner: req.session.userid,
      archived: {
        $ne: true,
      },
    }).exec((err, binders) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      res.status(200).json(binders);
    });
  });

  app.get('/ownedbinders/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    const search = {
      archived: {
        $ne: true,
      },
      $or: [{
        createdBy: req.session.userid,
        owner: {
          $exists: false,
        },
      }, {
        owner: req.session.userid,
      }],
    };

    Binder.find(search).lean().exec((err, binders) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).json(binders);
    });
  });

  app.get('/sharedbinders/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    User.findOne({
      _id: req.session.userid,
    }, 'binders').exec((err, me) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!me) {
        return res.status(400).send('cannot identify the current user');
      }
      Binder.find({
        _id: {
          $in: me.binders,
        },
        archived: {
          $ne: true,
        },
      }).exec((pErr, binders) => {
        if (pErr) {
          error(pErr);
          return res.status(500).send(pErr.message);
        }
        return res.status(200).json(binders);
      });
    });
  });

  app.get('/groupsharedbinders/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Group.find({
      _id: {
        $in: req.session.memberOf,
      },
    }, 'binders').exec((err, groups) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      const binderIds = [];
      let i;
      let j;
      // merge the binders arrays
      for (i = 0; i < groups.length; i += 1) {
        for (j = 0; j < groups[i].binders.length; j += 1) {
          if (binderIds.indexOf(groups[i].binders[j]) === -1) {
            binderIds.push(groups[i].binders[j]);
          }
        }
      }
      Binder.find({
        _id: {
          $in: binderIds,
        },
      }).exec((pErr, binders) => {
        if (pErr) {
          error(pErr);
          return res.status(500).send(pErr.message);
        }
        res.status(200).json(binders);
      });
    });
  });

  app.get('/archivedbinders/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    Binder.find({
      createdBy: req.session.userid,
      archived: true,
    }).exec((err, binders) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).json(binders);
    });
  });

  app.put('/binders/:id/archived', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), reqUtils.filter('body', ['archived']), (req, res) => {
    const doc: Binder = (req as any)[req.params.id];
    if (doc.archived === req.body.archived) {
      return res.send(204);
    }

    doc.archived = req.body.archived;

    if (doc.archived) {
      doc.archivedOn = new Date();
    }

    doc.save((saveErr: any, newDoc) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).send(saveErr.message);
      }
      return res.status(200).send('Binder ' + req.params.id + ' archived state set to ' + newDoc.archived);
    });

  });

  app.put('/binders/:id/owner', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), reqUtils.status('id', [0, 1]), reqUtils.filter('body', ['name']), (req, res) => {
    const doc: Binder = (req as any)[req.params.id];
    shareLib.changeOwner(req, res, doc);
  });

  app.get('/binders/:id', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canReadMw('id'), (req, res) => {
    res.render('binder', {
      binder: (req as any)[req.params.id],
    });
  });

  app.get('/binders/:id/json', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canReadMw('id'), reqUtils.exist('id', Binder), (req, res) => {
    res.status(200).json((req as any)[req.params.id]);
  });

  app.put('/binders/:id/status', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.isOwnerMw('id'), reqUtils.filter('body', ['status']), reqUtils.hasAll('body', ['status']), (req, res) => {
    const p: Binder = (req as any)[req.params.id];
    const s = req.body.status;

    if ([1, 2].indexOf(s) === -1) {
      return res.status(400).send('invalid status');
    }

    if (p.status === s) {
      return res.send(204);
    }

    if (s === 1) {
      if (p.status === undefined || [0, 2].indexOf(p.status) === -1) {
        return res.status(400).send('invalid status change');
      } else {
        p.status = s;
      }
    }

    if (s === 2) {
      if (p.status === undefined || [1].indexOf(p.status) === -1) {
        return res.status(400).send('invalid status change');
      } else {
        p.status = s;
      }
    }

    p.save((err: any) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).send('status updated to ' + s);
    });

  });

  function sendMerged(t: boolean, p: boolean, res: Response, merged: Array<Traveler | Binder>, binder: Binder) {
    if (t && p) {
      if (binder.isModified()) {
        binder.updateProgress();
      }
      res.status(200).json(merged);
    }
  }

  app.get('/binders/:id/works/json', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canReadMw('id'), (req, res) => {
    const binder: Binder = (req as any)[req.params.id];
    const works = binder.works;

    const tids: ObjectId[] = [];
    const pids: ObjectId[] = [];

    works.forEach((w) => {
      if (w.refType === 'traveler') {
        tids.push(w._id);
      } else {
        pids.push(w._id);
      }
    });

    if (tids.length + pids.length === 0) {
      return res.status(200).json([]);
    }

    const merged: Array<Traveler | Binder> = [];

    let tFinished = false;
    let pFinished = false;

    if (tids.length === 0) {
      tFinished = true;
    }

    if (pids.length === 0) {
      pFinished = true;
    }

    if (tids.length !== 0) {
      Traveler.find({
        _id: {
          $in: tids,
        },
      }, 'devices locations manPower status createdBy owner sharedWith finishedInput totalInput').lean().exec((err, travelers: Traveler[]) => {
        if (err) {
          error(err);
          return res.status(500).send(err.message);
        }
        travelers.forEach((t) => {
          binder.updateWorkProgress(t);

          // works has its own toJSON, therefore need to merge only the plain
          // object
          underscore.extend(t, works.id(t._id).toJSON());
          merged.push(t);
        });
        tFinished = true;
        // check if ready to respond
        sendMerged(tFinished, pFinished, res, merged, binder);
      });
    }

    if (pids.length !== 0) {
      Binder.find({
        _id: {
          $in: pids,
        },
      }, 'tags status createdBy owner finishedValue inProgressValue totalValue').lean().exec((err, binders: Binder[]) => {
        binders.forEach((p) => {
          binder.updateWorkProgress(p);
          underscore.extend(p, works.id(p._id).toJSON());
          merged.push(p);
        });
        pFinished = true;
        sendMerged(tFinished, pFinished, res, merged, binder);
      });
    }
  });

  function addWork(p: Binder, req: Request, res: Response) {
    const tids: string[] | undefined = req.body.travelers;
    const pids: string[] | undefined = req.body.binders;
    let ids: string[];
    let type: string;
    let model: mongoose.Model<Traveler | Binder>;
    if (tids) {
      if (tids.length === 0) {
        return res.send(204);
      }
      type = 'traveler';
      model = Traveler;
      ids = tids;
    } else {
      if (!pids || pids.length === 0) {
        return res.send(204);
      }
      type = 'binder';
      model = Binder;
      ids = pids;
    }

    const works = p.works;
    const added = [];

    model.find({
      _id: {
        $in: ids,
      },
    }).exec((err, items) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }

      if (items.length === 0) {
        return res.send(204);
      }

      if (!req.session) {
        res.status(500).send('Session not found');
        return;
      }

      for (const item of items) {
        if (type === 'binder' && item.id === p.id) {
          // do not add itself as a work
          return;
        }

        if (!works.id(item._id)) {
          const newWork = {
            _id: item._id,
            alias: item.title,
            refType: type,
            addedOn: Date.now(),
            addedBy: req.session.userid,
            status: item.status || 0,
            value: (item as any).value || 10,
            finished: 0,
            inProgress: 0,
          };
          if (item.status === 2) {
            newWork.finished = 1;
            newWork.inProgress = 0;
          } else if (item.status === 0) {
            newWork.finished = 0;
            newWork.inProgress = 0;
          } else {
            if (type === 'traveler') {
              newWork.finished = 0;
              if ((item as Traveler).totalInput === 0) {
                newWork.inProgress = 1;
              } else {
                newWork.inProgress = (item as Traveler).finishedInput / (item as Traveler).totalInput;
              }
            } else {
              if ((item as Binder).totalValue === 0) {
                newWork.finished = 0;
                newWork.inProgress = 1;
              } else {
                newWork.finished = (item as Binder).finishedValue / (item as Binder).totalValue;
                newWork.inProgress = (item as Binder).inProgressValue / (item as Binder).totalValue;
              }
            }

          }

          works.push(newWork);
          added.push(item.id);
        }
      }

      if (added.length === 0) {
        return res.send(204);
      }

      p.updatedOn = new Date();
      p.updatedBy = req.session.userid;

      // update the totalValue, finishedValue, and finishedValue
      p.updateProgress((saveErr, newPackage) => {
        if (saveErr) {
          error(saveErr);
          return res.status(500).send(saveErr.message);
        }
        return res.status(200).json(newPackage);
      });
    });
  }

  app.post('/binders/:id', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canWriteMw('id'), reqUtils.status('id', [0, 1]), reqUtils.filter('body', ['travelers', 'binders']), (req, res) => {
    addWork((req as any)[req.params.id], req, res);
  });


  app.delete('/binders/:id/works/:wid', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canWriteMw('id'), reqUtils.status('id', [0, 1]), (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    const p: Binder = (req as any)[req.params.id];
    const work = p.works.id(req.params.wid);

    if (!work) {
      return res.status(404).send('Work ' + req.params.wid + ' not found in the binder.');
    }

    work.remove();
    p.updatedBy = req.session.userid;
    p.updatedOn = new Date();

    p.updateProgress((err, newPackage) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.json(newPackage);
    });

  });

  app.put('/binders/:id/works', auth.ensureAuthenticated, reqUtils.exist('id', Binder), reqUtils.canWriteMw('id'), reqUtils.status('id', [0, 1]), (req, res) => {
    const binder: Binder = (req as any)[req.params.id];
    const works = binder.works;
    const updates = req.body;
    let wid: string;
    let work: Work;
    let prop: string;
    let u;
    let valueChanged = false;
    for (wid in updates) {
      if (!updates.hasOwnProperty(wid)) {
        continue;
      }

      work = works.id(wid);
      if (!work) {
        continue;
      }

      u = updates[wid];
      for (prop in u) {
        if (!u.hasOwnProperty(prop)) {
          continue;
        }
        if ((work as any)[prop] !== u[prop]) {
          if (prop === 'value') {
            valueChanged = true;
          }
          (work as any)[prop] = u[prop];
        }
      }
    }

    if (!binder.isModified()) {
      return res.send(204);
    }

    const cb = (err: any, newWP: Binder): void => {
      if (err) {
        error(err);
        res.status(500).send('cannot save the updates to binder ' + binder._id);
        return;
      }
      res.status(200).json(newWP.works);
    };

    if (valueChanged) {
      binder.updateProgress(cb);
    } else {
      binder.save(cb);
    }

  });

  app.get('/publicbinders', auth.ensureAuthenticated, (req, res) => {
    res.render('public-binders');
  });

  app.get('/publicbinders/json', auth.ensureAuthenticated, (req, res) => {
    Binder.find({
      publicAccess: {
        $in: [0, 1],
      },
      archived: {
        $ne: true,
      },
    }).exec((err, binders) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      res.status(200).json(binders);
    });
  });

}
