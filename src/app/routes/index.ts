/**
 * Implements general handlers
 */

// var authConfig = require('../config/config').auth;

export function main(req, res) {
  // console.log(req.session);
  res.render('main');
};

export function logout(req, res) {
  if (req.session) {
    req.session.destroy(function (err) {
      if (err) {
        console.error(err);
      }
    });
  }
  // if (res.proxied) {
  //   res.redirect(authConfig.proxied_cas + '/logout');
  // } else {
  //   res.redirect(authConfig.cas + '/logout');
  // }
};
