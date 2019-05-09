/**
 * Utilities for handling requests
 */

import sanitizeCaja = require('@mapbox/sanitize-caja');

import * as express from 'express';
import * as mongoose from 'mongoose';
import * as _ from 'underscore';

import {
  error,
} from '../shared/logging';

import * as share from '../model/share';

type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;

type ObjectId = mongoose.Types.ObjectId;

/**
 * Check the property list of http request. Set the property to null if it is
 *   not in the give names list. Go next() if at least one in the give names
 *   list, otherwise respond 400
 * @param  {String} list    'body'|'params'|'query'
 * @param  {[String]} names The property list to check against
 * @return {Function}       The middleware
 */
export function filter(list: 'body' | 'params' | 'query', names: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    let k;
    let found = false;
    for (k in req[list]) {
      if (Object.prototype.hasOwnProperty.call(req[list], k)) {
        if (names.indexOf(k) !== -1) {
          found = true;
        } else {
          req[list][k] = null;
        }
      }
    }
    if (found) {
      next();
    } else {
      return res.status(400).send('cannot find required information in ' + list);
    }
  };
}


function sanitizeJson<T>(input: T): T {
  let jsonString = JSON.stringify(input);
  jsonString = sanitizeCaja(jsonString);
  let output = null;
  try {
    output = JSON.parse(jsonString);
  } catch (e) {
    error(e);
  }
  return output;
}

/**
 * Sanitize the property list of http request against the give name list.
 * @param  {String} list    'body'|'params'|'query'
 * @param  {[String]} names The list to sanitize
 * @return {Function}       The middleware
 */
export function sanitize(list: 'body' | 'params' | 'query', names: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    names.forEach((n) => {
      if (Object.prototype.hasOwnProperty.call(req[list], n)) {
        if (_.isString(req[list][n])) {
          req[list][n] = sanitizeCaja(req[list][n]);
        }

        if (_.isObject(req[list][n]) || _.isArray(req[list][n])) {
          req[list][n] = sanitizeJson(req[list][n]);
        }
      }
    });
    next();
  };
}

/**
 * Check if the request[list] has all the properties in the names list
 * @param  {String}  list    'body'|'params'|'query'
 * @param  {[String]}  names The property list to check
 * @return {Function}        The middleware
 */
export function hasAll(list: 'body' | 'params' | 'query', names: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    let i;
    let miss = false;
    for (i = 0; i < names.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(req[list], names[i])) {
        miss = true;
        break;
      }
    }
    if (miss) {
      return res.status(400).send('cannot find required information in ' + list);
    }
    next();
  };
}

/**
 * Check if id exists in collection
 * @param  {String} pName         the parameter name of item id in req object
 * @param  {Model} collection     the collection model
 * @return {Function}             the middleware
 */
export function exist<T extends mongoose.Document>(pName: string, collection: mongoose.Model<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    collection.findById(req.params[pName]).exec((err, item) => {
      if (err) {
        error(err);
        return res.status(500).send(err.message);
      }

      if (!item) {
        return res.status(404).send('item ' + req.params[pName] + ' not found');
      }

      (req as any)[req.params[pName]] = item;
      next();
    });
  };
}

/**
 * check if the document in a certain status (list)
 * @param  {String} pName the parameter name of item id in req object
 * @param  {[Number]} sList the allowed status list
 * @return {Function}       the middleware
 */
export function status(pName: string, sList: number[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const s = (req as any)[req.params[pName]].status;
    if (sList.indexOf(s) === -1) {
      return res.status(400).send('request is not allowed for item ' + req.params[pName] + ' status ' + s);
    }
    next();
  };
}

/**
 * check if the document is archived
 * @param  {String} pName the parameter name of item id in req object
 * @param  {Boolean} a    true or false
 * @return {Function}     the middleware
 */
export function archived(pName: string, a: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const arch = (req as any)[req.params[pName]].archived;
    if (a !== arch) {
      return res.status(400).send('request is not allowed for item ' + req.params[pName] + ' archived ' + arch);
    }
    next();
  };
}

/*****
access := -1 // no access
        | 0  // read
        | 1  // write
*****/

interface Document {
  publicAccess?: number;
  createdBy?: string;
  owner?: string;
  sharedWith?: mongoose.Types.DocumentArray<share.User>;
  sharedGroup?: mongoose.Types.DocumentArray<share.Group>;
}

export function getAccess(req: Request, doc: Document) {
  if (doc.publicAccess === 1) {
    return 1;
  }
  if (req.session && doc.createdBy === req.session.userid && !doc.owner) {
    return 1;
  }
  if (req.session && doc.owner === req.session.userid) {
    return 1;
  }
  if (req.session && doc.sharedWith && doc.sharedWith.id(req.session.userid)) {
    return doc.sharedWith.id(req.session.userid).access;
  }
  let i;
  if (req.session && doc.sharedGroup) {
    for (i = 0; i < req.session.memberOf.length; i += 1) {
      if (doc.sharedGroup.id(req.session.memberOf[i]) && doc.sharedGroup.id(req.session.memberOf[i]).access === 1) {
        return 1;
      }
    }
    for (i = 0; i < req.session.memberOf.length; i += 1) {
      if (doc.sharedGroup.id(req.session.memberOf[i])) {
        return 0;
      }
    }
  }
  if (doc.publicAccess === 0) {
    return 0;
  }
  return -1;
}

export function canWrite(req: Request, doc: Document) {
  return getAccess(req, doc) === 1;
}


/**
 * check if the user can write the document, and go next if yes
 * @param  {String} pName the document to check
 * @return {Function}     the middleware
 */
export function canWriteMw(pName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!canWrite(req, (req as any)[req.params[pName]])) {
      return res.status(403).send('you are not authorized to access this resource');
    }
    next();
  };
}


export function canRead(req: Request, doc: Document) {
  return getAccess(req, doc) >= 0;
}

/**
 * check if the user can read the document, and go next if yes
 * @param  {String} pName the parameter name identifying the object
 * @return {Function}     the middleware
 */
export function canReadMw(pName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!canRead(req, (req as any)[req.params[pName]])) {
      return res.status(403).send('you are not authorized to access this resource');
    }
    next();
  };
}

export function isOwner(req: Request, doc: Document) {
  if (req.session && doc.createdBy === req.session.userid && !doc.owner) {
    return true;
  }
  if (req.session && doc.owner === req.session.userid) {
    return true;
  }
  return false;
}

/**
 * check if the user is the owner of the document, if yes next()
 * @param  {String}  pName the object's id to check
 * @return {Function}      the middleware
 */
export function isOwnerMw(pName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isOwner(req, (req as any)[req.params[pName]])) {
      return res.status(403).send('you are not authorized to access this resource');
    }
    next();
  };
}

export function getSharedWith(sharedWith: Array<{ username: string; }>, name: string) {
  let i;
  if (sharedWith.length === 0) {
    return -1;
  }
  for (i = 0; i < sharedWith.length; i += 1) {
    if (sharedWith[i].username === name) {
      return i;
    }
  }
  return -1;
}

export function getSharedGroup(sharedGroup: Array<{ _id?: ObjectId, groupname: string; }>, id: ObjectId) {
  let i;
  if (sharedGroup.length === 0) {
    return -1;
  }
  for (i = 0; i < sharedGroup.length; i += 1) {
    if (sharedGroup[i]._id === id) {
      return i;
    }
  }
  return -1;
}
