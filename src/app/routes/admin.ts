/**
 * Implement admin route handlers
 */

import * as auth from '../lib/auth';

export function init(app) {
  app.get('/admin', auth.ensureAuthenticated, function (req, res) {
    if (req.session.roles === undefined || req.session.roles.indexOf('admin') === -1) {
      return res.send(403, 'only admin allowed');
    }
    return res.render('admin');
  });
};
