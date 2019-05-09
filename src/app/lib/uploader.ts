/*
 * Utility wrapping the Multer middleware
 */

import * as express from 'express';
import * as multer from 'multer';

export interface Instance extends multer.Instance {
  singleParam: (loc: 'body' | 'params' | 'query', name: string) => express.RequestHandler;
}

export default function(options: multer.Options): Instance  {

  const m =  multer(options);

  return {
    fields: m.fields,
    single: m.single,
    array: m.array,
    none: m.none,
    any: m.any,
    // custom methods
    singleParam: (loc: 'body' | 'params' | 'query', name: string) => {
      return (req, res, next) => {
        const param = req[loc][name];
        if (param) {
          m.single(param)(req, res, next);
        }
      };
    },
  };
}
