/**
 * Implement User route handlers
 */
import * as fs from 'fs';

import * as express from 'express';

import {
  error,
  warn,
} from '../shared/logging';

import * as handlers from '../shared/handlers';

import * as auth from '../lib/auth';
import * as ldapjs from '../lib/ldap-client';
import * as reqUtils from '../lib/req-utils';

import {
  User,
} from '../model/user';

type Request = express.Request;
type Response = express.Response;

interface ADConfig {
  searchFilter: string;
  rawAttributes: string[];
  objAttributes: string[];
  searchBase: string;
  nameFilter: string;
  groupSearchFilter: string;
  groupSearchBase: string;
  groupAttributes: string[];
}

const pendingPhotos: { [key: string]: Response[] | undefined } = {};

const options = {
  root: '',
  maxAge: 0,
};

export function setUserPhotoCacheRoot(path: string) {
  options.root = path;
}

export function setUserPhotoCacheMaxAge(age: number) {
  options.maxAge = age;
}

let serviceUrl = '';

export function getServiceUrl(): string {
  return serviceUrl;
}

export function setServiceUrl(url: string) {
  serviceUrl = url;
}

let ad: ADConfig;

export function setADConfig(config: ADConfig) {
  ad = config;
}

let ldapClient: ldapjs.Client;

export function setLDAPClient(client: ldapjs.Client) {
  ldapClient = client;
}

let defaultUserPhotoData: Buffer | undefined;

export function getDefaultUserPhotoData(): Buffer | undefined {
  return defaultUserPhotoData;
}

export function setDefaultUserPhotoData(data: Buffer) {
  defaultUserPhotoData = data;
}

let defaultUserPhotoType: string | undefined;

export function getDefaultUserPhotoType(): string | undefined {
  return defaultUserPhotoType;
}

export function setDefaultUserPhotoType(type: string) {
  defaultUserPhotoType = type;
}

function sendUserPhotoWithDefault(res: Response, status: number, data?: string | string[] | Buffer | Buffer[]) {
  if (!data) {
    if (!defaultUserPhotoType || !defaultUserPhotoData) {
      res.status(500).send('default user photo not specified');
      return;
    }
    res.set('Content-Type', defaultUserPhotoType);
    res.set('Cache-Control', 'public, max-age=' + options.maxAge);
    res.status(status).send(defaultUserPhotoData);
    return;
  }
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=' + options.maxAge);
  return res.status(status).send(data);
}

function cleanList(id: string, f: (v: Response) => void) {
  const reslist = pendingPhotos[id];
  delete pendingPhotos[id];
  if (reslist) {
    reslist.forEach(f);
  }
}

function fetch_photo_from_ad(id: string) {
  const searchFilter = ad.searchFilter.replace('_id', id);
  const opts = {
    filter: searchFilter,
    attributes: ad.rawAttributes,
    scope: 'sub',
  };
  ldapClient.legacySearch(ad.searchBase, opts, true, (err, result) => {
    if (err) {
      error('LDAP error fetching photo: %s', err);
      cleanList(id, (res) => {
        sendUserPhotoWithDefault(res, 500);
      });
    } else if (!result || result.length === 0) {
      cleanList(id, (res) => {
        sendUserPhotoWithDefault(res, 404);
      });
    } else if (result.length > 1) {
      warn('Multiple LDAP results for user id: %s', id);
      cleanList(id, (res) => {
        sendUserPhotoWithDefault(res, 500);
      });
    } else if (result[0].thumbnailPhoto && result[0].thumbnailPhoto.length) {
      if (!fs.existsSync(options.root + id + '.jpg')) {
        fs.writeFile(options.root + id + '.jpg', result[0].thumbnailPhoto, (fsErr) => {
          if (fsErr) {
            error('Error writing user photo cache: %s', fsErr);
          }
        });
      }
      cleanList(id, (res) => {
        sendUserPhotoWithDefault(res, 200, result[0].thumbnailPhoto);
      });
    } else {
      cleanList(id, (res) => {
        sendUserPhotoWithDefault(res, 200);
      });
    }
  });
}

function updateUserProfile(user: User, res: Response) {
  const searchFilter = ad.searchFilter.replace('_id', user._id);
  const opts = {
    filter: searchFilter,
    attributes: ad.objAttributes,
    scope: 'sub',
  };
  ldapClient.legacySearch(ad.searchBase, opts, false, (ldapErr, result) => {
    if (ldapErr) {
      return res.status(500).json(ldapErr);
    }
    if (!result || result.length === 0) {
      return res.status(500).json({
        error: user._id + ' is not found!',
      });
    }
    if (result.length > 1) {
      return res.status(500).json({
        error: user._id + ' is not unique!',
      });
    }
    user.update({
      name: result[0].displayName,
      email: result[0].mail,
      office: result[0].physicalDeliveryOfficeName,
      phone: result[0].telephoneNumber,
      mobile: result[0].mobile,
    }, (err) => {
      if (err) {
        return res.status(500).json(err);
      }
      return res.sendStatus(204);
    });
  });
}


function addUser(req: Request, res: Response) {
  const nameFilter = ad.nameFilter.replace('_name', req.body.name);
  const opts = {
    filter: nameFilter,
    attributes: ad.objAttributes,
    scope: 'sub',
  };

  ldapClient.legacySearch(ad.searchBase, opts, false, (ldapErr, result) => {
    if (ldapErr) {
      error(ldapErr.name + ' : ' + ldapErr.message);
      return res.status(500).json(ldapErr);
    }

    if (!result || result.length === 0) {
      return res.status(404).send(req.body.name + ' is not found in AD!');
    }

    if (result.length > 1) {
      return res.status(400).send(req.body.name + ' is not unique!');
    }
    const roles = [];
    if (req.body.manager) {
      roles.push('manager');
    }
    if (req.body.admin) {
      roles.push('admin');
    }
    const user = new User({
      _id: String(result[0].sAMAccountName).toLowerCase(),
      name: result[0].displayName,
      email: result[0].mail,
      office: result[0].physicalDeliveryOfficeName,
      phone: result[0].telephoneNumber,
      mobile: result[0].mobile,
      roles: roles,
    });

    user.save((err, newUser) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      const url = reqUtils.urijoin(serviceUrl, 'users', newUser.id);

      res.set('Location', url);
      return res.status(201).send('The new user is at <a target="_blank" href="' + url + '">' + url + '</a>');
    });

  });
}

export function init(app: express.Application) {

  app.get('/usernames/:name', auth.ensureAuthenticated, (req, res) => {
    User.findOne({
      name: req.params.name,
    }).exec((err, user) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!req.session) {
        res.status(500).send('Session not found');
        return;
      }
      if (user) {
        return res.render('user', {
          user: user,
          myRoles: req.session.roles,
        });
      }
      return res.status(404).send(req.params.name + ' not found');
    });
  });


  app.post('/users', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    if (req.session.roles === undefined || req.session.roles.indexOf('admin') === -1) {
      return res.status(403).send('only admin allowed');
    }

    if (!req.body.name) {
      return res.status(400).send('need to know name');
    }

    // check if already in db
    User.findOne({
      name: req.body.name,
    }).exec((err, user) => {
      if (err) {
        return res.status(500).send(err.message);
      }
      if (user) {
        const url = reqUtils.urijoin(serviceUrl, 'users', user.id);
        return res.status(200).send('The user is at <a target="_blank" href="' + url + '">' + url + '</a>');
      }
      addUser(req, res);
    });

  });

  app.get('/users/json', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    if (req.session.roles === undefined || req.session.roles.indexOf('admin') === -1) {
      return res.status(403).send('You are not authorized to access this resource. ');
    }
    User.find().exec((err, users) => {
      if (err) {
        error(err);
        return res.status(500).json({
          error: err.message,
        });
      }
      res.json(users);
    });
  });


  app.get('/users/:id', auth.ensureAuthenticated, (req, res) => {
    User.findOne({
      _id: req.params.id,
    }).exec((err, user) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (!req.session) {
        res.status(500).send('Session not found');
        return;
      }
      if (user) {
        return res.render('user', {
          user: user,
          myRoles: req.session.roles,
        });
      }
      return res.status(404).send(req.params.id + ' has never logged into the application.');
    });
  });

  app.put('/users/:id', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    if (req.session.roles === undefined || req.session.roles.indexOf('admin') === -1) {
      return res.status(403).send('You are not authorized to access this resource. ');
    }
    if (!req.is('json')) {
      return res.status(415).json({
        error: 'json request expected.',
      });
    }
    User.findOneAndUpdate({
      _id: req.params.id,
    }, req.body).exec((err) => {
      if (err) {
        error(err);
        return res.status(500).json({
          error: err.message,
        });
      }
      return res.sendStatus(204);
    });
  });

  // get from the db not ad
  app.get('/users/:id/json', auth.ensureAuthenticated, (req, res) => {
    User.findOne({
      _id: req.params.id,
    }).exec((err, user) => {
      if (err) {
        error(err);
        return res.status(500).json({
          error: err.message,
        });
      }
      return res.json(user);
    });
  });

  app.get('/users/:id/refresh', auth.ensureAuthenticated, (req, res) => {
    if (!req.session) {
      throw new handlers.RequestError('Session not found');
    }

    if (req.session.roles === undefined || req.session.roles.indexOf('admin') === -1) {
      return res.status(403).send('You are not authorized to access this resource. ');
    }
    User.findOne({
      _id: req.params.id,
    }).exec((err, user) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }
      if (user) {
        updateUserProfile(user, res);
      } else {
        return res.status(404).send(req.params.id + ' is not in the application.');
      }
    });
  });


  // resource /adusers

  app.get('/adusers', auth.ensureAuthenticated, (req, res) => {
    return res.status(200).send('Please provide the user id');
  });

  app.get('/adusers/:id', auth.ensureAuthenticated, (req, res) => {

    const searchFilter = ad.searchFilter.replace('_id', req.params.id);
    const opts = {
      filter: searchFilter,
      attributes: ad.objAttributes,
      scope: 'sub',
    };
    ldapClient.legacySearch(ad.searchBase, opts, false, (err, result) => {
      if (err) {
        return res.status(500).json(err);
      }
      if (!result || result.length === 0) {
        return res.status(500).json({
          error: req.params.id + ' is not found!',
        });
      }
      if (result.length > 1) {
        return res.status(500).json({
          error: req.params.id + ' is not unique!',
        });
      }

      return res.json(result[0]);
    });

  });


  app.get('/adusers/:id/photo', auth.ensureAuthenticated, (req, res) => {
    if (fs.existsSync(options.root + req.params.id + '.jpg')) {
      return res.sendFile(req.params.id + '.jpg', options);
    }
    const pending = pendingPhotos[req.params.id];
    if (pending) {
      pending.push(res);
    } else {
      pendingPhotos[req.params.id] = [res];
      fetch_photo_from_ad(req.params.id);
    }
  });

  app.get('/adusernames', auth.ensureAuthenticated, (req, res) => {
    const query = req.query.term;
    let nameFilter;
    let opts;
    if (query && query.length > 0) {
      nameFilter = ad.nameFilter.replace('_name', query + '*');
    } else {
      nameFilter = ad.nameFilter.replace('_name', '*');
    }
    opts = {
      filter: nameFilter,
      attributes: ['displayName'],
      paged: {
        pageSize: 200,
      },
      scope: 'sub',
    };
    ldapClient.legacySearch(ad.searchBase, opts, false, (err, result) => {
      if (err) {
        return res.status(500).json(err);
      }
      if (!result || result.length === 0) {
        return res.json([]);
      }
      return res.json(result);
    });
  });

  app.get('/adgroups', auth.ensureAuthenticated, (req, res) => {
    const query = req.query.term;
    let filter;
    let opts;
    if (query && query.length > 0) {
      if (query[query.length - 1] === '*') {
        filter = ad.groupSearchFilter.replace('_id', query);
      } else {
        filter = ad.groupSearchFilter.replace('_id', query + '*');
      }
    } else {
      filter = ad.groupSearchFilter.replace('_id', '*');
    }
    opts = {
      filter: filter,
      attributes: ad.groupAttributes,
      scope: 'sub',
    };
    ldapClient.legacySearch(ad.groupSearchBase, opts, false, (err, result) => {
      if (err) {
        return res.status(500).send(err.message);
      }
      if (!result || result.length === 0) {
        return res.json([]);
      }
      return res.json(result);
    });
  });
}
