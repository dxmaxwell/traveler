/**
 * Implement profile route handlers
 */
import * as express from 'express';

import * as handlers from '../shared/handlers';

import {
  error,
} from '../shared/logging';

import * as auth from '../lib/auth';

import {
  User,
} from '../model/user';

export function init(app: express.Application) {
  app.get('/profile', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    // render the profile page
    User.findOne({
      _id: req.session.userid,
    }).exec((err, user) => {
      if (err) {
        error(err);
        return res.status(500).send('something is wrong with the DB.');
      }
      return res.render('profile', {
        user: user,
      });
    });
  });

  // user update her/his profile. This is a little different from the admin update the user's roles.
  app.put('/profile', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    if (!req.is('json')) {
      return res.status(415).json({
        error: 'json request expected.',
      });
    }
    User.findOneAndUpdate({
      _id: req.session.userid,
    }, {
      subscribe: req.body.subscribe,
    }).exec((err, user) => {
      if (err) {
        error(err);
        return res.status(500).json({
          error: err.message,
        });
      }
      return res.sendStatus(204);
    });
  });
}
