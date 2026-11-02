import { requireThat } from './errors.mjs';
import { isDeepStrictEqual } from 'node:util';
import {platformNames} from './connectors.mjs';

export function validateConnectorCall(call) {
  requireThat(call&&platformNames.includes(call.platform)&&typeof call.name==='string'&&call.name.length>0,'INVALID_CONNECTOR_CALL');
  requireThat(!call.backend||call.backend==='ui','INVALID_CONNECTOR_CALL');
  requireThat(!call.args||(typeof call.args==='object'&&!Array.isArray(call.args)),'INVALID_CONNECTOR_CALL');
}
export function valueAt(value,pointer='') {
  requireThat(typeof pointer==='string'&&(pointer===''||pointer.startsWith('/')),'INVALID_POINTER');
  for(const part of pointer.split('/').slice(1)) {
    const key=part.replace(/~1/g,'/').replace(/~0/g,'~');
    requireThat(!['__proto__','constructor','prototype'].includes(key),'INVALID_POINTER');
    if(value===null||value===undefined||!Object.hasOwn(value,key))return undefined;
    value=value[key];
  }
  return value;
}
export function bindOutputs(value,outputs) {
  if(Array.isArray(value))return value.map(v=>bindOutputs(v,outputs));
  if(!value||typeof value!=='object')return value;
  if(Object.hasOwn(value,'$output')) {
    requireThat(Object.keys(value).length===1,'INVALID_OUTPUT_BINDING');
    const ref=value.$output;requireThat(ref&&typeof ref.key==='string'&&Object.hasOwn(outputs,ref.key),'MISSING_OUTPUT');
    const result=valueAt(outputs[ref.key],ref.pointer||'');requireThat(result!==undefined,'MISSING_OUTPUT');return result;
  }
  return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,bindOutputs(v,outputs)]));
}
export function validateConnectorCondition(c) {
  validateConnectorCall(c.call);
  requireThat(typeof c.pointer==='string'&&(c.pointer===''||c.pointer.startsWith('/')),'INVALID_CONNECTOR_CONDITION');
  requireThat(['equals','exists','greaterThan'].filter(key=>Object.hasOwn(c,key)).length===1,'INVALID_CONNECTOR_CONDITION');
  if(Object.hasOwn(c,'exists'))requireThat(typeof c.exists==='boolean','INVALID_CONNECTOR_CONDITION');
}
export function matchesConnector(output,c) {
  if(output?.snapshot?.truncated)return false;
  const value=valueAt(output,c.pointer);
  if(Object.hasOwn(c,'exists'))return (value!==undefined)===c.exists;
  if(Object.hasOwn(c,'greaterThan'))return typeof value==='number'&&typeof c.greaterThan==='number'&&value>c.greaterThan;
  return isDeepStrictEqual(value,c.equals);
}
