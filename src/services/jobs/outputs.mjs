import { requireThat } from '../../errors.mjs';

const maxOutputLength=1024*1024;
export function requireOutputSize(value) {
  requireThat(JSON.stringify(value).length<maxOutputLength,'OUTPUT_LIMIT');
}
export function setJobOutput(outputs,key,value) {
  outputs[key]=value;
  requireOutputSize(outputs);
}
