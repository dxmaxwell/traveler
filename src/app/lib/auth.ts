/**
 *  authentication and authorization functions
 */
import * as url from 'url';

import Client = require('cas.js');

import * as ldapjs from './ldap-client';

import { User } from '../model/user';

interface AliasConfig {
  [key: string]: string | undefined;
}

interface ADConfig {
  searchFilter: string;
  objAttributes: string[];
  searchBase: string;
  memberAttributes: string[];
}

interface AuthConfig {
  cas: string;
  service: string;
}

interface ApiUserConfig {
  [key: string]: string | undefined;
}

let ad: ADConfig;

export function setADConfig(config: ADConfig) {
  ad = config;
}

let cas: Client;

let authConfig: AuthConfig;

export function setAuthConfig(config: AuthConfig) {
  authConfig = config;
  cas = new Client({
    base_url: authConfig.cas,
    service: authConfig.service,
    version: 1.0,
  });
}

let ldapClient: ldapjs.Client;

export function setLDAPClient(client: ldapjs.Client) {
  ldapClient = client;
}

let alias: AliasConfig = {};

export function setAliases(a: AliasConfig) {
  alias = a;
}

let apiUsers: ApiUserConfig = {};

export function setAPIUsers(users: ApiUserConfig) {
  apiUsers = users;
}

// var config = require('../config/config.js');
// var ad = config.ad;
// var auth = config.auth;

// var apiUsers = config.api.users;


export function proxied(req, res, next) {
  if (req.get('x-forwarded-host') && req.get('x-forwarded-host') === auth.proxy) {
    req.proxied = true;
    req.proxied_prefix = url.parse(auth.proxied_service).pathname;
  }
  next();
}

function cn(s) {
  var first = s.split(',', 1)[0];
  return first.substr(3).toLowerCase();
}

function filterGroup(a) {
  var output = [];
  var i;
  var group;
  for (i = 0; i < a.length; i += 1) {
    group = cn(a[i]);
    if (group.indexOf('lab.frib') === 0) {
      output.push(group);
      if (alias.hasOwnProperty(group) && output.indexOf(alias[group]) === -1) {
        output.push(alias[group]);
      }
    }
  }
  return output;
}

export function ensureAuthenticated(req, res, next) {
  var ticketUrl = url.parse(req.url, true);
  if (!!req.session.userid) {
    // logged in already
    if (!!req.query.ticket) {
      // remove the ticket query param
      delete ticketUrl.query.ticket;
      return res.redirect(301, url.format({
        pathname: req.proxied ? url.resolve(auth.proxied_service + '/', '.' + ticketUrl.pathname) : ticketUrl.pathname,
        query: ticketUrl.query
      }));
    }
    next();
  } else if (!!req.query.ticket) {
    // just kicked back by CAS
    // var halt = pause(req);
    // if (req.proxied) {
    //   cas.service = auth.login_proxied_service;
    // } else {
    //   cas.service = auth.login_service;
    // }
    // validate the ticket
    cas.validate(req.query.ticket, function (err, casresponse, result) {
      if (err) {
        console.error(err.message);
        return res.send(401, err.message);
      }
      if (result.validated) {
        var userid = result.username;
        // set userid in session
        req.session.userid = userid;
        var searchFilter = ad.searchFilter.replace('_id', userid);
        var opts = {
          filter: searchFilter,
          attributes: ad.memberAttributes,
          scope: 'sub'
        };

        // query ad about other attribute
        ldapClient.legacySearch(ad.searchBase, opts, false, function (err, result) {
          if (err) {
            console.error(err.name + ' : ' + err.message);
            return res.send(500, 'something wrong with ad');
          }
          if (result.length === 0) {
            console.warn('cannot find ' + userid);
            return res.send(500, userid + ' is not found!');
          }
          if (result.length > 1) {
            return res.send(500, userid + ' is not unique!');
          }

          // set username and memberof in session
          req.session.username = result[0].displayName;
          req.session.memberOf = filterGroup(result[0].memberOf);

          // load others from db
          User.findOne({
            _id: userid
          }).exec(function (err, user) {
            if (err) {
              console.error(err.message);
            }
            if (user) {
              req.session.roles = user.roles;
              // update user last visited on
              User.findByIdAndUpdate(user._id, {
                lastVisitedOn: Date.now()
              }, function (err, update) {
                if (err) {
                  console.error(err.message);
                }
              });
            } else {
              // create a new user
              req.session.roles = [];
              var first = new User({
                _id: userid,
                name: result[0].displayName,
                email: result[0].mail,
                office: result[0].physicalDeliveryOfficeName,
                phone: result[0].telephoneNumber,
                mobile: result[0].mobile,
                roles: [],
                lastVisitedOn: Date.now()
              });

              first.save(function (err, newUser) {
                if (err) {
                  console.error(err.message);
                  console.error(first.toJSON());
                  return res.send(500, 'cannot log in. Please contact admin.');
                }
                console.info('A new user created : ' + newUser);
              });
            }
            if (req.session.landing && req.session.landing !== '/login') {
              res.redirect(req.proxied ? url.resolve(auth.proxied_service + '/', '.' + req.session.landing) : req.session.landing);
            } else {
              // has a ticket but not landed before, must copy the ticket from somewhere ...
              res.redirect(req.proxied ? auth.proxied_service + '/' : '/');
            }
            // halt.resume();
          });
        });
      } else {
        console.error('CAS reject this ticket');
        return res.redirect(req.proxied ? auth.login_proxied_service : auth.login_service);
      }
    });
  } else {
    // if this is ajax call, then send 401 without redirect
    if (req.xhr) {
      // TODO: might need to properly set the WWW-Authenticate header
      res.set('WWW-Authenticate', 'CAS realm="' + (req.proxied ? auth.proxied_service : auth.service) + '"');
      return res.send(401, 'xhr cannot be authenticated');
    } else {
      // set the landing, the first unauthenticated url
      req.session.landing = req.url;
      if (req.proxied) {
        res.redirect(auth.proxied_cas + '/login?service=' + encodeURIComponent(auth.login_proxied_service));
      } else {
        res.redirect(auth.cas + '/login?service=' + encodeURIComponent(auth.login_service));
      }
    }
  }
}


export function sessionLocals(req, res, next) {
  res.locals.session = req.session;
  res.locals.prefix =  req.proxied ? req.proxied_prefix : '';
  next();
}


export function checkAuth(req, res, next) {
  if (req.query.ticket) {
    ensureAuthenticated(req, res, next);
  } else {
    next();
  }
}

export function verifyRole(role) {
  return function (req, res, next) {
    // console.log(req.session);
    if (req.session.roles) {
      if (req.session.roles.indexOf(role) > -1) {
        next();
      } else {
        return res.send(403, "You are not authorized to access this resource. ");
      }
    } else {
      console.log("Cannot find the user's role.");
      return res.send(500, "something wrong for the user's session");
    }
  };
}

var basic = require('basic-auth');

function notKnown(cred) {
  if (apiUsers.hasOwnProperty(cred.name)) {
    if (apiUsers[cred.name] === cred.pass) {
      return false;
    }
  }
  return true;
}

export function basicAuth(req, res, next) {
  var cred = basic(req);
  if (!cred || notKnown(cred)) {
    res.set('WWW-Authenticate', 'Basic realm="api"');
    return res.send(401);
  }
  next();
}

