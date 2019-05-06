/**
 * Binder model
 */

import * as mongoose from 'mongoose';

import {
  error,
} from '../shared/logging';

import * as share from './share.js';

type ObjectId = mongoose.Types.ObjectId;


interface ISpec {
  _id: any;
  status?: number;
  totalInput?: number;
  finishedInput?: number;
  totalValue?: number;
  finishedValue?: number;
  inProgressValue?: number;
}

export interface IWork {
  alias?: string;
  refType: 'traveler' | 'binder';
  addedOn?: Date;
  addedBy?: string;
  status?: number;
  finished?: number;
  inProgress?: number;
  priority?: number;
  sequence?: number;
  value?: number;
  color: 'green' | 'yellow' | 'red' | 'blue' | 'black';
}

export interface Work extends IWork, mongoose.Document {
  // nothing extra right now
}

export interface IBinder {
  title?: string;
  description?: string;
  status?: number;
  tags?: string[];
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
  works?: IWork[];
  finishedValue?: number;
  inProgressValue?: number;
  totalValue?: number;
  archived?: boolean;
}

export interface Binder extends IBinder, mongoose.Document {
  updateWorkProgress(this: Binder, spec: ISpec);
  updateProgress(this: Binder, cb: (err: any, Binder) => void);
}

const Schema = mongoose.Schema;
const ObjectId = Schema.Types.ObjectId;


/**
 * finished is the percentage of value that is completed.
 * inProgress is the percentage of value that is still in progress.
 * If status === 2, then finished = 100, and inProgress = 0;
 * If status === 0, then finished = 0, and inProgress = 0;
 */

const workSchema = new Schema({
  alias: String,
  refType: {
    type: String,
    required: true,
    enum: ['traveler', 'binder'],
  },
  addedOn: Date,
  addedBy: String,
  status: Number,
  finished: {
    type: Number,
    default: 0,
    min: 0,
  },
  inProgress: {
    type: Number,
    default: 0,
    min: 0,
  },
  priority: {
    type: Number,
    min: 1,
    max: 10,
    default: 5,
  },
  sequence: {
    type: Number,
    min: 1,
    default: 1,
  },
  value: {
    type: Number,
    min: 0,
    default: 10,
  },
  color: {
    type: String,
    default: 'blue',
    enum: ['green', 'yellow', 'red', 'blue', 'black'],
  },
});

/**
 * publicAccess := 0 // for read or
 *               | 1 // for write or
 *               | -1 // no access
 *
 */

/**
 * totalValue = sum(work value)
 * finishedValue = sum(work value X finished)
 * inProgressValue = sum(work value X inProgress)
 */

/**
 * status := 0 // new
 *         | 1 // active
 *         | 2 // completed
 */

const binderSchema = new Schema({
  title: String,
  description: String,
  status: {
    type: Number,
    default: 0,
  },
  tags: [String],
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
    default: 0,
  },
  sharedWith: [share.userSchema],
  sharedGroup: [share.groupSchema],
  works: [workSchema],
  finishedValue: {
    type: Number,
    default: 0,
    min: 0,
  },
  inProgressValue: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalValue: {
    type: Number,
    default: 0,
    min: 0,
  },
  archived: {
    type: Boolean,
    default: false,
  },
});

binderSchema.methods.updateWorkProgress = function(this: Binder, spec: ISpec) {
  const w = (this.works as mongoose.Types.DocumentArray<Work>).id(spec._id);
  if (!w) {
    return;
  }
  if (w.status !== spec.status) {
    w.status = spec.status;
  }
  if (spec.status === 2) {
    w.finished = 1;
    w.inProgress = 0;
  } else if (spec.status === 0) {
    w.finished = 0;
    w.inProgress = 0;
  } else {
    if (w.refType === 'traveler') {
      w.finished = 0;
      if (spec.totalInput === 0) {
        w.inProgress = 1;
      } else {
        w.inProgress = spec.finishedInput / spec.totalInput;
      }
    } else {
      if (spec.totalValue === 0) {
        w.finished = 0;
        w.inProgress = 1;
      } else {
        w.finished = spec.finishedValue / spec.totalValue;
        w.inProgress = spec.inProgressValue / spec.totalValue;
      }
    }
  }
};


binderSchema.methods.updateProgress = function(this: Binder, cb: (err: any, binder?: Binder) => void) {
  const works = this.works;
  let totalValue = 0;
  let finishedValue = 0;
  let inProgressValue = 0;
  works.forEach((w) => {
    totalValue = totalValue + w.value;
    finishedValue = finishedValue + w.value * w.finished;
    inProgressValue = inProgressValue + w.value * w.inProgress;
  });

  this.totalValue = totalValue;
  this.finishedValue = finishedValue;
  this.inProgressValue = inProgressValue;
  if (this.isModified()) {
    this.save((err, newBinder) => {
      if (cb) {
        cb(err, newBinder);
      } else {
        if (err) {
          error(err);
        }
      }
    });
  }
};

export const Binder = mongoose.model<Binder>('Binder', binderSchema);
