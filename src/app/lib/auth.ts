/**
 *  authentication and authorization functions
 */
import * as url from 'url';

import * as basic from 'basic-auth';
import Client = require('cas.js');
import * as express from 'express';

import {
  error,
  info,
  warn,
} from '../shared/logging';

import * as ldapjs from './ldap-client';

import { User } from '../model/user';

type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;

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

function cn(s: string): string {
  const first = s.split(',', 1)[0];
  return first.substr(3).toLowerCase();
}

function filterGroup(a: string[]): string[] {
  const output: string[] = [];
  let i: number;
  let group: string;
  for (i = 0; i < a.length; i += 1) {
    group = cn(a[i]);
    if (group.indexOf('lab.frib') === 0) {
      output.push(group);
      if (alias.hasOwnProperty(group)) {
        const groupalias = alias[group];
        if (groupalias && output.indexOf(groupalias) === -1) {
          output.push(groupalias);
        }
      }
    }
  }
  return output;
}

export function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (!req.session) {
    next(new Error('Session not found'));
    return;
  }
  const ticketUrl = url.parse(req.url, true);
  if (!!req.session.userid) {
    // logged in already
    if (!!req.query.ticket) {
      // remove the ticket query param
      delete ticketUrl.query.ticket;
      return res.redirect(301, url.format({
        // tslint:disable:max-line-length
        // pathname: req.proxied ? url.resolve(auth.proxied_service + '/', '.' + ticketUrl.pathname) : ticketUrl.pathname,
        pathname: ticketUrl.pathname,
        query: ticketUrl.query,
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
    cas.validate(req.query.ticket, (err, casresponse, result) => {
      if (err) {
        error(err.message);
        return res.status(401).send(err.message);
      }
      if (!req.session) {
        res.status(500).send('session not found');
        return;
      }
      if (result.validated) {
        const userid = result.username;
        // set userid in session
        req.session.userid = userid;
        const searchFilter = ad.searchFilter.replace('_id', userid);
        const opts = {
          filter: searchFilter,
          attributes: ad.memberAttributes,
          scope: 'sub',
        };

        // query ad about other attribute
        ldapClient.legacySearch(ad.searchBase, opts, false, (err1, result1) => {
          if (err1) {
            error(err.name + ' : ' + err1.message);
            return res.status(500).send('something wrong with ad');
          }
          if (!req.session) {
            res.status(500).send('session not found');
            return;
          }
          if (!result1 || result1.length === 0) {
            warn('cannot find ' + userid);
            return res.status(500).send(userid + ' is not found!');
          }
          if (result1.length > 1) {
            return res.status(500).send(userid + ' is not unique!');
          }

          // set username and memberof in session
          req.session.username = result1[0].displayName;

          if (Array.isArray(result1[0].memberOf)) {
            req.session.memberOf = filterGroup((result1[0].memberOf as Array<string | Buffer>).map(String));
          } else {
            req.session.memberOf = filterGroup([ String(result1[0].memberOf) ]);
          }

          // load others from db
          User.findOne({ _id: userid }).exec((err2, user) => {
            if (err2) {
              error(err2.message);
            }
            if (!req.session) {
              res.status(500).send('session not found');
              return;
            }
            if (user) {
              req.session.roles = user.roles;
              // update user last visited on
              User.findByIdAndUpdate(user._id, {
                lastVisitedOn: Date.now(),
              }, (err3, update) => {
                if (err3) {
                  error(err3.message);
                }
              });
            } else {
              // create a new user
              req.session.roles = [];
              const first = new User({
                _id: userid,
                name: result1[0].displayName,
                email: result1[0].mail,
                office: result1[0].physicalDeliveryOfficeName,
                phone: result1[0].telephoneNumber,
                mobile: result1[0].mobile,
                roles: [],
                lastVisitedOn: Date.now(),
              });

              first.save((err3, newUser) => {
                if (err3) {
                  error(err3.message);
                  error(first.toJSON());
                  return res.status(500).send('cannot log in. Please contact admin.');
                }
                info('A new user created : ' + newUser);
              });
            }
            if (req.session.landing && req.session.landing !== '/login') {
              // res.redirect(req.proxied ? url.resolve(auth.proxied_service + '/', '.' + req.session.landing) : req.session.landing);
              res.redirect(req.session.landing);
            } else {
              // has a ticket but not landed before, must copy the ticket from somewhere ...
              // res.redirect(req.proxied ? auth.proxied_service + '/' : '/');
              res.redirect('/');
            }
            // halt.resume();
          });
        });
      } else {
        error('CAS reject this ticket');
        // return res.redirect(req.proxied ? auth.login_proxied_service : auth.login_service);
        return res.redirect(authConfig.service);
      }
    });
  } else {
    // if this is ajax call, then send 401 without redirect
    if (req.xhr) {
      // TODO: might need to properly set the WWW-Authenticate header
      // res.set('WWW-Authenticate', 'CAS realm="' + (req.proxied ? auth.proxied_service : auth.service) + '"');
      res.set('WWW-Authenticate', 'CAS realm="' + authConfig.service + '"');
      return res.status(401).send('xhr cannot be authenticated');
    } else {
      // set the landing, the first unauthenticated url
      req.session.landing = req.url;
      // if (req.proxied) {
      //   res.redirect(auth.proxied_cas + '/login?service=' + encodeURIComponent(auth.login_proxied_service));
      // } else {
      res.redirect(authConfig.cas + '/login?service=' + encodeURIComponent(authConfig.service));
      // }
    }
  }
}


export function sessionLocals(req: Request, res: Response, next: NextFunction) {
  (res as any).locals.session = req.session;
  next();
}


export function checkAuth(req: Request, res: Response, next: NextFunction) {
  if (req.query.ticket) {
    ensureAuthenticated(req, res, next);
  } else {
    next();
  }
}

export function verifyRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      next(new Error('session not found'));
      return;
    }
    // console.log(req.session);
    if (req.session.roles) {
      if (req.session.roles.indexOf(role) > -1) {
        next();
      } else {
        return res.status(403).send('You are not authorized to access this resource.');
      }
    } else {
      warn("Cannot find the user's role.");
      return res.status(500).send('something wrong for the user\'s session');
    }
  };
}

function notKnown(cred: basic.BasicAuthResult) {
  if (apiUsers.hasOwnProperty(cred.name)) {
    if (apiUsers[cred.name] === cred.pass) {
      return false;
    }
  }
  return true;
}

export function basicAuth(req: Request, res: Response, next: NextFunction) {
  const cred = basic(req);
  if (!cred || notKnown(cred)) {
    res.set('WWW-Authenticate', 'Basic realm="api"');
    return res.send(401);
  }
  next();
}

