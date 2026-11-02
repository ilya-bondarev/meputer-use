// Shared contract for operations on an observed application interface.
export { normalize, validateSelector, select, identity, validateCondition, evaluate } from './selectors.mjs';
export { validatePlan, isMutatingStep } from './plans.mjs';
export { validatePageRequest, pageNeedsInput } from './pages.mjs';
export { simpleChallengeSchema, buildSimpleChallengePlan, buildChallengeReloadPlan,
  challengeMayReload, challengeOutcome, challengeRetryContext, challengeRetryExpiry, challengeConditions } from './challenges.mjs';
export const objectSchema=properties=>({type:'object',properties,additionalProperties:false});
const freeObject={type:'object'};
export const commonOperations=Object.freeze([
  {name:'ui.read',readOnly:true,durable:true,description:'Read a bounded accessibility tree without changing focus.',inputSchema:objectSchema({observe:freeObject})},
  {name:'ui.text',readOnly:true,durable:true,description:'Read active browser document text directly through accessibility. No image or full control tree.',inputSchema:objectSchema({maxChars:{type:'integer',minimum:1,maximum:500000}})},
  {name:'ui.plan',readOnly:false,durable:true,description:'Run a UIA v1 plan with observable postconditions.',inputSchema:{...objectSchema({plan:freeObject}),required:['plan']}},
  {name:'ui.action',readOnly:false,durable:false,description:'One observed native action; returns unverified, then observe the result.',inputSchema:{...objectSchema({operation:{enum:['click','move','drag','wheel','key','type','close_window','clipboard_read']},parameters:freeObject}),required:['operation','parameters']}},
  {name:'auth.fill',readOnly:false,durable:false,description:'Enter an authorized credential reference into a freshly observed field; never returns the credential.',inputSchema:{...objectSchema({selector:freeObject,secretRef:{type:'string',pattern:'^(env:|wincred:)'},observe:freeObject,expectedWindowTitle:{type:'string'},expectedOrigin:{type:'string'}}),required:['selector','secretRef','expectedWindowTitle']}},
]);
export function planOperations(groups) {
  return Object.entries(groups).flatMap(([family,actions])=>actions.split(' ').map(action=>({
    name:family+'.'+action,readOnly:false,durable:true,execution:'observed_plan',
    description:'Execute '+family+'.'+action+' using controls observed in the current interface; a verified plan is required.',
    inputSchema:{...objectSchema({plan:{type:'object'}}),required:['plan']},
  })));
}
