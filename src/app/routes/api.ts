/**
 * Traveler v1 API
 */

import * as fs from 'fs';

import * as express from 'express';

import * as auth from '../lib/auth';

import {
  Traveler,
  TravelerData,
  TravelerNote,
} from '../model/traveler';

import {
  error,
} from '../shared/logging';


let router: express.Router | null = null;

export function getRouter(opts?: {}) {
  if (router) {
    return router;
  }

  router = express.Router(opts);

  router.get('/api/v1/travelers', auth.basicAuth, (req, res) => {
    const search: { archived: { $ne: boolean }, devices?: { $in: unknown[] }  } = {
      archived: {
        $ne: true,
      },
    };
    if (Object.prototype.hasOwnProperty.call(req.query, 'device')) {
      search.devices = {
        $in: [req.query.device],
      };
    }
    // tslint:disable:max-line-length
    Traveler.find(search, 'title status devices createdBy clonedBy createdOn deadline updatedBy updatedOn sharedWith finishedInput totalInput').lean().exec((err, travelers) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).json(travelers);
    });
  });

  router.get('/api/v1/travelers/:id', auth.basicAuth, (req, res) => {
    Traveler.findById(req.params.id, (err, doc) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!doc) {
        return res.status(410).send('gone');
      }
      return res.status(200).json(doc);
    });
  });

  router.get('/api/v1/travelers/:id/data', auth.basicAuth, (req, res) => {
    Traveler.findById(req.params.id, (err, doc) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!doc) {
        return res.status(410).send('gone');
      }
      TravelerData.find({
        _id: {
          $in: doc.data,
        },
      }, 'name value inputType inputBy inputOn').exec((err1, docs) => {
        if (err1) {
          error(err1);
          return res.status(500).send(err1.message);
        }
        return res.status(200).json(docs);
      });
    });
  });

  router.get('/api/v1/travelers/:id/notes', auth.basicAuth, (req, res) => {
    Traveler.findById(req.params.id, (err, doc) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!doc) {
        return res.status(410).send('gone');
      }
      TravelerNote.find({
        _id: {
          $in: doc.notes,
        },
      }, 'name value inputBy inputOn').exec((err1, docs) => {
        if (err1) {
          error(err1);
          return res.status(500).send(err1.message);
        }
        return res.status(200).json(docs);
      });
    });
  });

  router.get('/api/v1/data/:id', auth.basicAuth, (req, res) => {
    TravelerData.findById(req.params.id).exec((err, data) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!data) {
        return res.status(410).send('gone');
      }
      if (data.inputType === 'file') {
        fs.exists(data.file.path, (exists) => {
          if (exists) {
            return res.sendfile(data.file.path);  // TODO: Path should relative to a configured root directory!
          }
          return res.status(410).send('gone');
        });
      } else {
        res.status(200).json(data);
      }
    });
  });

  return router;
}
