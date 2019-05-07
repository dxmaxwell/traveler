/**
 * Common sub-schemas for implementing form, traveler and binder models
 */
import * as mongoose from 'mongoose';

export interface IUser {
  _id: any;
  username: string;
  access: number;
}

export interface User extends IUser, mongoose.Document {
  // nothing extra right now
}

export interface IGroup {
  _id: any;
  groupname: string;
  access: number;
}

export interface Group extends IGroup, mongoose.Document {
  // nothing extra right now
}

/*
access :=  0 // for read or
        |  1 // for write or
        | -1 // no access
*/

export const userSchema = new mongoose.Schema({
  _id: String,
  username: String,
  access: Number,
});

export const groupSchema = new mongoose.Schema({
  _id: String,
  groupname: String,
  access: Number,
});
