/*
 * Utility wrapping the Multer middleware
 *
 * Most of the complexity with this wrapping is to mitigate the risk caused by use of the 'any()' method,
 * which allows the storage of arbitrary files contained in the mutlipart request.
 * (See details: https://www.npmjs.com/package/multer#any)
 */
import * as crypto from 'crypto';
import * as path from 'path';

import * as Debug from 'debug';
import * as express from 'express';
import * as multer from 'multer';

import { warn } from '../shared/logging';

const debug = Debug('traveler:lib:uploader');

export interface Options extends multer.Options {
  dest: string; // make `dest` property required
}

export interface Instance extends multer.Instance {
  dest: string;
  singleParam: (loc: 'body' | 'params' | 'query', name: string) => express.RequestHandler;
}

type FileFilter = multer.Options['fileFilter'];

export default function(options: Options): Instance  {

  if (!path.isAbsolute(options.dest)) {
    options.dest = path.resolve(options.dest);
  }

  // Use a custom storage that maintains the file extention
  options.storage = multer.diskStorage({
    destination: options.dest,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      crypto.pseudoRandomBytes(16, (err, raw) => {
        cb(err, err ? '' : raw.toString('hex') + ext);
      });
    },
  });

  const optionalFileFilter = options.fileFilter;

  const callOptionalFileFilter: FileFilter = (req, file, cb) => {
    if (optionalFileFilter) {
      optionalFileFilter(req, file, cb);
      return;
    }
    cb(null, true);
  };

  options.fileFilter = (req, file, cb) => {
    callOptionalFileFilter(req, file, (err, accept) => {
      if (err || !accept) {
        cb(err, false);
        return;
      }
      if (typeof (req as any).fileFilter  === 'function') {
        (req as any).fileFilter(req, file, cb);
        return;
      }
      cb(null, true);
    });
  };

  debug('multer(%j)', options);
  const m = multer(options);

  return {
    // multer methods
    fields: m.fields,
    single: m.single,
    array: m.array,
    none: m.none,
    any: m.any,
    // custom properties
    dest: options.dest,
    // custom methods
    singleParam: (loc: 'body' | 'params' | 'query', name: string) => {
      return (req, res, next) => {
        let fileFound = false;

        const fileFilter: FileFilter = (_, file, cb) => {
          if (req[loc][name] === file.fieldname) {
            debug('SingleParam: File found with fieldname: req[%s][%s]: %s', loc, name, req[loc][name]);
            if (!fileFound) {
              fileFound = true;
              cb(null, true);
              return;
            }
            warn('SingleParam: Expecting single file with fieldname: %s: multiple files rejected', req[loc][name]);
          }
          cb(null, false);
        };

        // Add fileFilter to the request
        (req as any).fileFilter = fileFilter;

        m.any()(req, res, (err) => {
          // Remove fileFilter from the request
          delete (req as any).fileFilter;

          if (err) {
            next(err);
            return;
          }

          if (Array.isArray(req.files) && req.files.length > 0) {
            req.file = req.files[0];
          }
          next();
        });
      };
    },
  };
}
