import Ajv from 'ajv';
import { ExecutorError } from './errors.mjs';

// One JSON Schema engine for public UI contracts. Never coerce inputs.
const ajv = new Ajv({ strict:false, allErrors:true, validateFormats:true });
const cache=new WeakMap();
export function validateValue(schema, value) {
  let validate=cache.get(schema);
  if(!validate) {validate=ajv.compile(schema);cache.set(schema,validate);}
  if(!validate(value)) {
    const e=new ExecutorError('INVALID_ARGUMENTS');
    e.details=validate.errors.map(({instancePath,keyword,params})=>({path:instancePath,keyword,params}));
    throw e;
  }
  return value;
}
