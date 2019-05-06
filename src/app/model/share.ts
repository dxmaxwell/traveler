/**
 * Common sub-schemas for implementing form, traveler and binder models
 */
import { Schema } from 'mongoose';

export interface IUser {
  _id: any;
  username: string;
  access: number;
}

export interface IGroup {
  _id: any;
  groupname: string;
  access: number;
}

/*
access :=  0 // for read or
        |  1 // for write or
        | -1 // no access
*/

export const userSchema = new Schema({
  _id: String,
  username: String,
  access: Number,
});

export const groupSchema = new Schema({
  _id: String,
  groupname: String,
  access: Number,
});
