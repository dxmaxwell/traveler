/**
 * Implement admin route handlers
 */

import * as express from 'express';

import * as handlers from '../shared/handlers';

import * as auth from '../lib/auth';

export function init(app: express.Application) {
  app.get('/admin', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }
    if (req.session.roles === undefined || req.session.roles.indexOf('admin') === -1) {
      return res.status(403).send('only admin allowed');
    }
    return res.render('admin');
  });
}
