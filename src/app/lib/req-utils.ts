/**
 * Utilities for handling requests
 */

import * as sanitizeCaja from 'sanitize-caja';
import * as _ from 'underscore';

/**
 * Check the property list of http request. Set the property to null if it is
 *   not in the give names list. Go next() if at least one in the give names
 *   list, otherwise respond 400
 * @param  {String} list    'body'|'params'|'query'
 * @param  {[String]} names The property list to check against
 * @return {Function}       The middleware
 */
export function filter(list, names) {
  return function (req, res, next) {
    var k;
    var found = false;
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
      return res.send(400, 'cannot find required information in ' + list);
    }
  };
}


function sanitizeJson(input) {
  var jsonString = JSON.stringify(input);
  jsonString = sanitizeCaja(jsonString);
  var output = null;
  try {
    output = JSON.parse(jsonString);
  } catch (e) {
    console.error(e);
  }
  return output;
}

/**
 * Sanitize the property list of http request against the give name list.
 * @param  {String} list    'body'|'params'|'query'
 * @param  {[String]} names The list to sanitize
 * @return {Function}       The middleware
 */
export function sanitize(list, names) {
  return function (req, res, next) {
    names.forEach(function (n) {
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
export function hasAll(list, names) {
  return function (req, res, next) {
    var i;
    var miss = false;
    for (i = 0; i < names.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(req[list], names[i])) {
        miss = true;
        break;
      }
    }
    if (miss) {
      return res.send(400, 'cannot find required information in ' + list);
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
export function exist(pName, collection) {
  return function (req, res, next) {
    collection.findById(req.params[pName]).exec(function (err, item) {
      if (err) {
        console.error(err);
        return res.send(500, err.message);
      }

      if (!item) {
        return res.send(404, 'item ' + req.params[pName] + ' not found');
      }

      req[req.params[pName]] = item;
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
export function status(pName, sList) {
  return function (req, res, next) {
    var s = req[req.params[pName]].status;
    if (sList.indexOf(s) === -1) {
      return res.send(400, 'request is not allowed for item ' + req.params[pName] + ' status ' + s);
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
export function archived(pName, a) {
  return function (req, res, next) {
    var arch = req[req.params[pName]].archived;
    if (a !== arch) {
      return res.send(400, 'request is not allowed for item ' + req.params[pName] + ' archived ' + arch);
    }
    next();
  };
}

/*****
access := -1 // no access
        | 0  // read
        | 1  // write
*****/

export function getAccess(req, doc) {
  if (doc.publicAccess === 1) {
    return 1;
  }
  if (doc.createdBy === req.session.userid && !doc.owner) {
    return 1;
  }
  if (doc.owner === req.session.userid) {
    return 1;
  }
  if (doc.sharedWith && doc.sharedWith.id(req.session.userid)) {
    return doc.sharedWith.id(req.session.userid).access;
  }
  var i;
  if (doc.sharedGroup) {
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

export function canWrite(req, doc) {
  return getAccess(req, doc) === 1;
}


/**
 * check if the user can write the document, and go next if yes
 * @param  {String} pName the document to check
 * @return {Function}     the middleware
 */
export function canWriteMw(pName) {
  return function (req, res, next) {
    if (!canWrite(req, req[req.params[pName]])) {
      return res.send(403, 'you are not authorized to access this resource');
    }
    next();
  };
}


export function canRead(req, doc) {
  return getAccess(req, doc) >= 0;
}

/**
 * check if the user can read the document, and go next if yes
 * @param  {String} pName the parameter name identifying the object
 * @return {Function}     the middleware
 */
export function canReadMw(pName) {
  return function (req, res, next) {
    if (!canRead(req, req[req.params[pName]])) {
      return res.send(403, 'you are not authorized to access this resource');
    }
    next();
  };
}

export function isOwner(req, doc) {
  if (doc.createdBy === req.session.userid && !doc.owner) {
    return true;
  }
  if (doc.owner === req.session.userid) {
    return true;
  }
  return false;
}

/**
 * check if the user is the owner of the document, if yes next()
 * @param  {String}  pName the object's id to check
 * @return {Function}      the middleware
 */
export function isOwnerMw(pName) {
  return function (req, res, next) {
    if (!isOwner(req, req[req.params[pName]])) {
      return res.send(403, 'you are not authorized to access this resource');
    }
    next();
  };
}

export function getSharedWith(sharedWith, name) {
  var i;
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

export function getSharedGroup(sharedGroup, id) {
  var i;
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
