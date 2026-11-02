import { requireThat } from '../../errors.mjs';
import { validateSelector, validateCondition } from './selectors.mjs';

const actions = new Set(['invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse']);
const stepKeys = new Set(['id', 'op', 'selector', 'value', 'expect', 'before', 'skipIf', 'timeoutMs']);
const snapshotKeys = new Set(['maxElements', 'maxDepth', 'budgetMs', 'includeValues', 'scope', 'activeDocument']);
export function validatePlan(plan) {
  requireThat(plan && plan.version === 1 && typeof plan.goal === 'string' && plan.goal.length > 0 && plan.goal.length <= 4096, 'INVALID_PLAN');
  requireThat(Object.keys(plan).every(k => ['version', 'goal', 'steps', 'observe'].includes(k)), 'INVALID_PLAN');
  requireThat(Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.length <= 64, 'INVALID_PLAN');
  if (plan.observe) {
    requireThat(typeof plan.observe === 'object' && Object.keys(plan.observe).every(k => snapshotKeys.has(k)), 'INVALID_OBSERVATION');
    if (plan.observe.scope) {
      requireThat(Object.keys(plan.observe.scope).every(k => ['name', 'automationId'].includes(k)), 'INVALID_SCOPE');
      validateSelector(plan.observe.scope);
    }
    for (const [key, min, max] of [['maxElements', 1, 1000], ['maxDepth', 0, 30], ['budgetMs', 50, 10000]]) {
      if (key in plan.observe) requireThat(Number.isInteger(plan.observe[key]) && plan.observe[key] >= min && plan.observe[key] <= max, 'INVALID_OBSERVATION');
    }
    if ('includeValues' in plan.observe) requireThat(typeof plan.observe.includeValues === 'boolean', 'INVALID_OBSERVATION');
    if ('activeDocument' in plan.observe) requireThat(typeof plan.observe.activeDocument === 'boolean', 'INVALID_OBSERVATION');
  }
  const ids = new Set();
  for (const step of plan.steps) {
    requireThat(step && typeof step.id === 'string' && step.id.length > 0 && step.id.length <= 100 && !ids.has(step.id), 'INVALID_STEP_ID');
    ids.add(step.id);
    requireThat(Object.keys(step).every(k => stepKeys.has(k)), 'INVALID_STEP');
    requireThat(actions.has(step.op) || ['assert', 'wait'].includes(step.op), 'INVALID_OPERATION');
    if (actions.has(step.op)) validateSelector(step.selector);
    // Every mutation needs observable postconditions; DONE alone is not evidence.
    validateCondition(step.expect);
    if (step.before) validateCondition(step.before);
    if (step.skipIf) validateCondition(step.skipIf);
    if (step.op === 'set_value') requireThat(typeof step.value === 'string' && step.value.length <= 100000, 'INVALID_VALUE');
    else requireThat(!('value' in step), 'INVALID_VALUE');
    if ('timeoutMs' in step) requireThat(Number.isInteger(step.timeoutMs) && step.timeoutMs >= 0 && step.timeoutMs <= 30000, 'INVALID_TIMEOUT');
  }
  return plan;
}

export const isMutatingStep = step => actions.has(step.op);
