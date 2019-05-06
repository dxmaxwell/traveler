/*
 * Implement documentation route handlers
 */

import * as express from 'express';

export function init(app: express.Application) {
  app.get('/docs', function (req, res) {
    res.render('doc-in-one', {
      // prefix: req.proxied ? req.proxied_prefix : ''
      prefix: ''
    });
  });

  app.get('/docs/form-manager', function (req, res) {
    res.render('doc-form-manager', {
      // prefix: req.proxied ? req.proxied_prefix : ''
      prefix: ''
    });
  });
};
