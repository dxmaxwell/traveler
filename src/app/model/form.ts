/**
 * Form model definition
 */

import * as mongoose from 'mongoose';

import * as share from './share.js';

type ObjectId = mongoose.Types.ObjectId;

export interface IForm {
  _id: any;
  title?: string;
  createdBy?: string;
  createdOn?: Date;
  clonedFrom?: ObjectId;
  updatedBy?: string;
  updatedOn?: Date;
  owner?: string;
  status: number;
  transferredOn?: Date;
  archivedOn?: Date;
  archived?: boolean;
  publicAccess?: number;
  sharedWith: share.IUser[];
  sharedGroup: share.IGroup[];
  html?: string;
}

export interface Form extends IForm, mongoose.Document {
  // nothing extra right now
}

export interface IFormFile {
  form?: ObjectId;
  value?: string;
  inputType?: string;
  file?: {
    path: string;
    encoding: string;
    mimetype: string;
  };
  uploadedBy?: string;
  uploadedOn?: Date;
}

export interface FormFile extends IFormFile, mongoose.Document {
  // nothing extra right now
}

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;


/******
publicAccess := 0 // for read or
             |  1 // for write or
             | -1 // no access
******/
/******
status := 0   // editable
        | 0.5 // ready to publish
        | 1   // published
        | 2   // obsoleted
******/


const formSchema = new Schema({
  title: String,
  createdBy: String,
  createdOn: Date,
  clonedFrom: ObjectId,
  updatedBy: String,
  updatedOn: Date,
  owner: String,
  status: {
    type: Number,
    default: 0
  },
  transferredOn: Date,
  archivedOn: Date,
  archived: {
    type: Boolean,
    default: false
  },
  publicAccess: {
    type: Number,
    default: -1
  },
  sharedWith: [share.userSchema],
  sharedGroup: [share.groupSchema],
  html: String
});

const formFileSchema = new Schema({
  form: ObjectId,
  value: String,
  inputType: String,
  file: {
    path: String,
    encoding: String,
    mimetype: String
  },
  uploadedBy: String,
  uploadedOn: Date
});

export const Form = mongoose.model<Form>('Form', formSchema);
export const FormFile = mongoose.model<FormFile>('FormFile', formFileSchema);
