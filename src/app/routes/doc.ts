/*
 * Implement documentation route handlers
 */

import * as express from 'express';

export function init(app: express.Application) {
  app.get('/docs', (req, res) => {
    res.render('doc-in-one');
  });

  app.get('/docs/form-manager', (req, res) => {
    res.render('doc-form-manager');
  });
}
