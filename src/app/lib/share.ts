/**
 * Utilities for managing shared forms, travelers and binders
 */
import * as express from 'express';
import * as mongoose from 'mongoose';

import {
  error,
} from '../shared/logging';

import * as models from '../shared/models';

import * as ldapjs from './ldap-client';

import {
  Group,
  User,
} from '../model/user';

import {
  Group as ShareGroup,
  User as ShareUser,
} from '../model/share';

interface AddToSet {
  forms?: unknown;
  travelers?: unknown;
  binders?: unknown;
}

interface ADConfig {
  // searchFilter: string;
  // rawAttributes: string[];
  objAttributes: string[];
  searchBase: string;
  nameFilter: string;
  groupSearchFilter: string;
  groupSearchBase: string;
  groupAttributes: string[];
}

interface SharedDocument extends mongoose.Document {
  owner?: string;
  transferredOn?: Date;
  sharedWith: mongoose.Types.DocumentArray<ShareUser>;
  sharedGroup: mongoose.Types.DocumentArray<ShareGroup>;
}

type Request = express.Request;
type Response = express.Response;


let ad: ADConfig;

export function setADConfig(config: ADConfig) {
  ad = config;
}

let ldapClient: ldapjs.Client;

export function setLDAPClient(client: ldapjs.Client) {
  ldapClient = client;
}

function addUserFromAD(req: Request, res: Response, doc: SharedDocument) {
  const name = req.body.name;
  const nameFilter = ad.nameFilter.replace('_name', name);
  const opts = {
    filter: nameFilter,
    attributes: ad.objAttributes,
    scope: 'sub',
  };

  ldapClient.legacySearch(ad.searchBase, opts, false, (err, result) => {
    if (err) {
      error(err.name + ' : ' + err.message);
      return res.status(500).json(err);
    }

    if (!result || result.length === 0) {
      return res.status(400).json(name + ' is not found in AD!');
    }

    if (result.length > 1) {
      return res.status(400).json(name + ' is not unique!');
    }

    const id = String(result[0].sAMAccountName).toLowerCase();
    let access = 0;
    if (req.body.access && req.body.access === 'write') {
      access = 1;
    }
    doc.sharedWith.addToSet({
      _id: id,
      username: name,
      access: access,
    });
    doc.save((docErr) => {
      if (docErr) {
        error(docErr);
        return res.status(500).json(docErr.message);
      }
      const user = new User({
        _id: String(result[0].sAMAccountName).toLowerCase(),
        name: result[0].displayName,
        email: result[0].mail,
        office: result[0].physicalDeliveryOfficeName,
        phone: result[0].telephoneNumber,
        mobile: result[0].mobile,
      });
      switch (models.getModelName(doc)) {
      case 'Form':
        user.forms = [doc._id];
        break;
      case 'Traveler':
        user.travelers = [doc._id];
        break;
      case 'Binder':
        user.binders = [doc._id];
        break;
      default:
        error('Something is wrong with doc type ' + models.getModelName(doc));
      }
      user.save((userErr) => {
        if (userErr) {
          error(userErr);
        }
      });
      return res.status(201).json('The user named ' + name + ' was added to the share list.');
    });
  });
}

function addGroupFromAD(req: Request, res: Response, doc: SharedDocument) {
  const id = req.body.id.toLowerCase();
  const filter = ad.groupSearchFilter.replace('_id', id);
  const opts = {
    filter: filter,
    attributes: ad.groupAttributes,
    scope: 'sub',
  };

  ldapClient.legacySearch(ad.groupSearchBase, opts, false, (err, result) => {
    if (err) {
      error(err);
      return res.status(500).json(err.message);
    }

    if (!result || result.length === 0) {
      return res.status(400).json(id + ' is not found in AD!');
    }

    if (result.length > 1) {
      return res.status(400).json(id + ' is not unique!');
    }

    const name = result[0].description;
    let access = 0;
    if (req.body.access && req.body.access === 'write') {
      access = 1;
    }
    doc.sharedGroup.addToSet({
      _id: id,
      groupname: name,
      access: access,
    });
    doc.save((docErr) => {
      if (docErr) {
        error(docErr);
        return res.status(500).json(docErr.message);
      }
      const group = new Group({
        // _id: String(result[0].sAMAccountName).toLowerCase(),
        // name: result[0].displayName,
        // email: result[0].mail,
        _id: String(result[0].cn).toLowerCase(),
        name: result[0].description,
        email: 'group@demo.com',
      });
      switch (models.getModelName(doc)) {
      case 'Form':
        group.forms = [doc._id];
        break;
      case 'Traveler':
        group.travelers = [doc._id];
        break;
      case 'Binder':
        group.binders = [doc._id];
        break;
      default:
        error('Something is wrong with doc type ' + models.getModelName(doc));
      }
      group.save((groupErr) => {
        if (groupErr) {
          error(groupErr);
        }
      });
      return res.status(201).json('The group ' + id + ' was added to the share list.');
    });
  });
}

function addUser(req: Request, res: Response, doc: SharedDocument) {
  const name = req.body.name;
  // check local db first then try ad
  User.findOne({
    name: name,
  }, (err, user) => {
    if (err) {
      error(err);
      return res.status(500).json(err.message);
    }
    if (user) {
      let access = 0;
      if (req.body.access && req.body.access === 'write') {
        access = 1;
      }
      doc.sharedWith.addToSet({
        _id: user._id,
        username: name,
        access: access,
      });
      doc.save((docErr) => {
        if (docErr) {
          error(docErr);
          return res.status(500).json(docErr.message);
        }
        return res.status(201).json('The user named ' + name + ' was added to the share list.');
      });
      const addToSet: AddToSet = {};
      switch (models.getModelName(doc)) {
      case 'Form':
        addToSet.forms = doc._id;
        break;
      case 'Traveler':
        addToSet.travelers = doc._id;
        break;
      case 'Binder':
        addToSet.binders = doc._id;
        break;
      default:
        error('Something is wrong with doc type ' + models.getModelName(doc));
      }
      user.update({
        $addToSet: addToSet,
      }, (useErr) => {
        if (useErr) {
          error(useErr);
        }
      });
    } else {
      addUserFromAD(req, res, doc);
    }
  });
}

function addGroup(req: Request, res: Response, doc: SharedDocument) {
  const id = req.body.id.toLowerCase();
  // check local db first then try ad
  Group.findOne({
    _id: id,
  }, (err, group) => {
    if (err) {
      error(err);
      return res.status(500).json(err.message);
    }
    if (group) {
      let access = 0;
      if (req.body.access && req.body.access === 'write') {
        access = 1;
      }
      doc.sharedGroup.addToSet({
        _id: id,
        groupname: group.name,
        access: access,
      });
      doc.save((docErr) => {
        if (docErr) {
          error(docErr);
          return res.status(500).json(docErr.message);
        }
        return res.status(201).json('The group ' + id + ' was added to the share list.');
      });
      const addToSet: AddToSet = {};
      switch (models.getModelName(doc)) {
      case 'Form':
        addToSet.forms = doc._id;
        break;
      case 'Traveler':
        addToSet.travelers = doc._id;
        break;
      case 'Binder':
        addToSet.binders = doc._id;
        break;
      default:
        error('Something is wrong with doc type ' + models.getModelName(doc));
      }
      group.update({
        $addToSet: addToSet,
      }, (groupErr) => {
        if (groupErr) {
          error(groupErr);
        }
      });
    } else {
      addGroupFromAD(req, res, doc);
    }
  });
}

function removeFromList(req: Request, res: Response, doc: SharedDocument) {
  // var form = req[req.params.id];
  let list: mongoose.Types.DocumentArray<ShareUser | ShareGroup>;
  const ids: string[] = req.params.shareid.split(',');
  const removed: string[] = [];

  if (req.params.list === 'users') {
    list = doc.sharedWith;
  }
  if (req.params.list === 'groups') {
    list = doc.sharedGroup;
  }

  ids.forEach((id) => {
    const share = list.id(id);
    if (share) {
      removed.push(id);
      share.remove();
    }
  });

  if (removed.length === 0) {
    return res.status(400).json('cannot find ' + req.params.shareid + ' in list.');
  }

  doc.save((saveErr) => {
    if (saveErr) {
      error(saveErr);
      return res.status(500).json(saveErr.message);
    }
    // keep the consistency of user's form list
    let Target: mongoose.Model<User | Group>;
    if (req.params.list === 'users') {
      Target = User;
    }
    if (req.params.list === 'groups') {
      Target = Group;
    }

    const pull: AddToSet = {};
    switch (models.getModelName(doc)) {
    case 'Form':
      pull.forms = doc._id;
      break;
    case 'Traveler':
      pull.travelers = doc._id;
      break;
    case 'Binder':
      pull.binders = doc._id;
      break;
    default:
      error('Something is wrong with doc type ' + models.getModelName(doc));
    }

    removed.forEach((id) => {
      Target.findByIdAndUpdate(id, {
        $pull: pull,
      }, (updateErr, target) => {
        if (updateErr) {
          error(updateErr);
        }
        if (!target) {
          error('The ' + req.params.list + ' ' + id + ' is not in the db');
        }
      });
    });

    return res.status(200).json( removed);
  });
}

/**
 * add a user or a group into a document's share list
 * @param  {ClientRequest}   req http request object
 * @param  {ServerResponse}   res http response object
 * @param  {Documment}   doc the document to share
 * @return {undefined}
 */
export function addShare(req: Request, res: Response, doc: SharedDocument) {
  if (['Form', 'Traveler', 'Binder'].indexOf(models.getModelName(doc)) === -1) {
    return res.status(500).json('cannot handle the document type ' + models.getModelName(doc));
  }
  if (req.params.list === 'users') {
    addUser(req, res, doc);
  }

  if (req.params.list === 'groups') {
    addGroup(req, res, doc);
  }
}

/**
 * remove a list of users or groups from a document's share list
 * @param  {ClientRequest} req http request object
 * @param  {ServerResponse} res http response object
 * @param  {Documment} doc the document to share
 * @return {undefined}
 */
export function removeShare(req: Request, res: Response, doc: SharedDocument) {
  if (['Form', 'Traveler', 'Binder'].indexOf(models.getModelName(doc)) === -1) {
    return res.status(500).json('cannot handle the document type ' + models.getModelName(doc));
  }

  removeFromList(req, res, doc);
}


export function changeOwner(req: Request, res: Response, doc: SharedDocument) {
  // get user id from name here
  const name = req.body.name;
  const nameFilter = ad.nameFilter.replace('_name', name);
  const opts = {
    filter: nameFilter,
    attributes: ad.objAttributes,
    scope: 'sub',
  };

  ldapClient.legacySearch(ad.searchBase, opts, false, (ldapErr, result) => {
    if (ldapErr) {
      error(ldapErr.name + ' : ' + ldapErr.message);
      return res.status(500).json(ldapErr.message);
    }

    if (!result || result.length === 0) {
      return res.status(400).json(name + ' is not found in AD!');
    }

    if (result.length > 1) {
      return res.status(400).json(name + ' is not unique!');
    }

    const id = String(result[0].sAMAccountName).toLowerCase();

    if (doc.owner === id) {
      return res.sendStatus(204);
    }

    doc.owner = id;
    doc.transferredOn = new Date();

    doc.save((saveErr) => {
      if (saveErr) {
        error(saveErr);
        return res.status(500).json(saveErr.message);
      }
      return res.status(200).json('Owner is changed to ' + id);
    });
  });
}
