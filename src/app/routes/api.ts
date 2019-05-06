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


let router: express.Router | null = null;

export function getRouter(opts?: {}) {
  if (router) {
    return router;
  }

  router = express.Router(opts);

  router.get('/api/v1/travelers', auth.basicAuth, function (req, res) {
    var search: { archived: { $ne: boolean }, devices?: { $in: unknown[] }  } = {
      archived: {
        $ne: true
      }
    };
    if (Object.prototype.hasOwnProperty.call(req.query, 'device')) {
      search.devices = {
        $in: [req.query.device]
      };
    }
    Traveler.find(search, 'title status devices createdBy clonedBy createdOn deadline updatedBy updatedOn sharedWith finishedInput totalInput').lean().exec(function (err, travelers) {
      if (err) {
        console.error(err);
        return res.status(500).send(err.message);
      }
      return res.status(200).json(travelers);
    });
  });

  router.get('/api/v1/travelers/:id', auth.basicAuth, function (req, res) {
    Traveler.findById(req.params.id, function (err, doc) {
      if (err) {
        console.error(err);
        return res.status(500).send(err.message);
      }
      if (!doc) {
        return res.status(410).send('gone');
      }
      return res.status(200).json(doc);
    });
  });

  router.get('/api/v1/travelers/:id/data', auth.basicAuth, function (req, res) {
    Traveler.findById(req.params.id, function (err, doc) {
      if (err) {
        console.error(err);
        return res.status(500).send(err.message);
      }
      if (!doc) {
        return res.status(410).send('gone');
      }
      TravelerData.find({
        _id: {
          $in: doc.data
        }
      }, 'name value inputType inputBy inputOn').exec(function (err, docs) {
        if (err) {
          console.error(err);
          return res.status(500).send(err.message);
        }
        return res.status(200).json(docs);
      });
    });
  });

  router.get('/api/v1/travelers/:id/notes', auth.basicAuth, function (req, res) {
    Traveler.findById(req.params.id, function (err, doc) {
      if (err) {
        console.error(err);
        return res.status(500).send(err.message);
      }
      if (!doc) {
        return res.status(410).send('gone');
      }
      TravelerNote.find({
        _id: {
          $in: doc.notes
        }
      }, 'name value inputBy inputOn').exec(function (err, docs) {
        if (err) {
          console.error(err);
          return res.status(500).send(err.message);
        }
        return res.status(200).json(docs);
      });
    });
  });

  router.get('/api/v1/data/:id', auth.basicAuth, function (req, res) {
    TravelerData.findById(req.params.id).exec(function (err, data) {
      if (err) {
        console.error(err);
        return res.status(500).send(err.message);
      }
      if (!data) {
        return res.status(410).send('gone');
      }
      if (data.inputType === 'file') {
        fs.exists(data.file.path, function (exists) {
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
};
