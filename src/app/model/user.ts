/**
 * User model for Traveler
 */

import * as mongoose from 'mongoose';

type ObjectId = mongoose.Types.ObjectId;

export interface IUser {
  _id: any;
  name?: string;
  email?: string;
  office?: string;
  phone?: string;
  mobile?: string;
  roles?: string[];
  lastVisitedOn?: Date;
  forms?: ObjectId[];
  travelers?: ObjectId[];
  binders?: ObjectId[];
  subscribe?: boolean;
}

export interface User extends IUser, mongoose.Document {
  // nothing extra right now
}

export interface IGroup {
  _id: any;
  name?: string;
  forms?: ObjectId[];
  travelers?: ObjectId[];
  binders?: ObjectId[];
}

export interface Group extends IGroup, mongoose.Document {
  // nothing extra right now
}


const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;

const userSchema = new Schema({
  _id: String,
  name: String,
  email: String,
  office: String,
  phone: String,
  mobile: String,
  roles: [String],
  lastVisitedOn: Date,
  forms: [ObjectId],
  travelers: [ObjectId],
  binders: [ObjectId],
  subscribe: {
    type: Boolean,
    default: false,
  }
});

const groupSchema = new Schema({
  _id: String,
  name: String,
  forms: [ObjectId],
  travelers: [ObjectId],
  binders: [ObjectId],
});

export const User = mongoose.model<User>('User', userSchema);
export const Group = mongoose.model<Group>('Group', groupSchema);
