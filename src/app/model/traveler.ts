/**
 * Traveler model definition
 */

import * as mongoose from 'mongoose';

import * as share from './share.js';

type ObjectId = mongoose.Types.ObjectId;

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

export interface IForm {
  _id: any;
  html: string;
  activatedOn: Date[];
  reference: ObjectId;
  alias: string;
}

export interface IUser {
  _id: any;
  username: string;
}

export interface ITraveler {
  title?: string;
  description?: string;
  devices?: string[];
  locations?: string[];
  manPower?: IUser[];
  status: number;
  createdBy?: string;
  createdOn?: Date;
  clonedBy?: string;
  clonedFrom?: ObjectId;
  updatedBy?: string;
  updatedOn?: Date;
  archivedOn?: Date;
  owner?: string;
  transferredOn?: Date;
  deadline?: Date;
  publicAccess?: number;
  sharedWith?: share.IUser[];
  sharedGroup?: share.IGroup[];
  referenceForm?: ObjectId;
  forms?: IForm[];
  activeForm?: string;
  data?: ObjectId[];
  notes?: ObjectId[];
  totalInput?: number;
  finishedInput?: number;
  archived?: boolean;
}

export interface Traveler extends ITraveler, mongoose.Document {
  // nothing extra right now
}

export interface ITravelerData {
  traveler: ObjectId;
  name?: string;
  value?: any;
  file?: {
    path: string;
    encoding: string;
    mimetype: string;
  };
  inputType?: string;
  inputBy?: string;
  inputOn?: Date;
}

export interface TravelerData extends ITravelerData, mongoose.Document {
  // nothing extra right now
}

export interface ITravelerNote {
  traveler: ObjectId;
  name?: string;
  value?: string;
  inputBy?: string;
  inputOn?: Date;
}

export interface TravelerNote extends ITravelerNote, mongoose.Document {
  // nothing extra right now
}


/**
 * A form can become active, inactive, and reactive. The form's activated date
 *   and the form's updated data can tell if the form has been updated since
 *   it is used by the traveler.
 * activatedOn: the dates when this form starts to be active
 * alias : a name for convenience to distinguish forms.
 */

const formSchema = new Schema({
  html: String,
  activatedOn: [Date],
  reference: ObjectId,
  alias: String
});


const userSchema = new Schema({
  _id: String,
  username: String
});

/**
 * status := 0 // new
 *         | 1 // active
 *         | 1.5 // complete request
 *         | 2 // completed
 *         | 3 // frozen
 */

/**
 * publicAccess := 0 // for read or
 *               | 1 // for write or
 *               | -1 // no access
 */

const travelerSchema = new Schema({
  title: String,
  description: String,
  devices: [String],
  locations: [String],
  manPower: [userSchema],
  status: {
    type: Number,
    default: 0
  },
  createdBy: String,
  createdOn: Date,
  clonedBy: String,
  clonedFrom: ObjectId,
  updatedBy: String,
  updatedOn: Date,
  archivedOn: Date,
  owner: String,
  transferredOn: Date,
  deadline: Date,
  publicAccess: {
    type: Number,
    default: 0
  },
  sharedWith: [share.userSchema],
  sharedGroup: [share.groupSchema],
  referenceForm: ObjectId,
  forms: [formSchema],
  activeForm: String,
  data: [ObjectId],
  notes: [ObjectId],
  totalInput: {
    type: Number,
    default: 0,
    min: 0
  },
  finishedInput: {
    type: Number,
    default: 0,
    min: 0
  },
  archived: {
    type: Boolean,
    default: false
  }
});


/**
 * type := 'file'
 *       | 'text'
 *       | 'textarea'
 *       | 'number'
 */

const travelerDataSchema = new Schema({
  traveler: ObjectId,
  name: String,
  value: Schema.Types.Mixed,
  file: {
    path: String,
    encoding: String,
    mimetype: String
  },
  inputType: String,
  inputBy: String,
  inputOn: Date
});

const travelerNoteSchema = new Schema({
  traveler: ObjectId,
  name: String,
  value: String,
  inputBy: String,
  inputOn: Date
});


export const Traveler = mongoose.model<Traveler>('Traveler', travelerSchema);
export const TravelerData = mongoose.model<TravelerData>('TravelerData', travelerDataSchema);
export const TravelerNote = mongoose.model<TravelerNote>('TravelerNote', travelerNoteSchema);
