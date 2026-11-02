import { requireThat } from '../../errors.mjs';

export const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\u200e\u200f]/g, '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU');
const selectorKeys = new Set(['name', 'automationId', 'role', 'contains', 'enabled', 'within']);

export function validateSelector(selector, depth = 0) {
  requireThat(selector && typeof selector === 'object' && !Array.isArray(selector) && depth < 8, 'INVALID_SELECTOR');
  requireThat(Object.keys(selector).length > 0 && Object.keys(selector).every(k => selectorKeys.has(k)), 'INVALID_SELECTOR');
  for (const key of ['name', 'automationId', 'role', 'contains']) {
    if (key in selector) requireThat(typeof selector[key] === 'string' && selector[key].length > 0 && selector[key].length <= 2048, 'INVALID_SELECTOR');
  }
  if ('enabled' in selector) requireThat(typeof selector.enabled === 'boolean', 'INVALID_SELECTOR');
  if (selector.within) validateSelector(selector.within, depth + 1);
}
function ownMatch(element, selector) {
  return (!('name' in selector) || normalize(element.name) === normalize(selector.name)) &&
    (!('automationId' in selector) || element.automationId === selector.automationId) &&
    (!('role' in selector) || normalize(element.role) === normalize(selector.role)) &&
    (!('contains' in selector) || normalize(element.name).includes(normalize(selector.contains))) &&
    (!('enabled' in selector) || element.enabled === selector.enabled);
}
export function select(snapshot, selector) {
  validateSelector(selector);
  const byRef = new Map(snapshot.elements.map(e => [e.ref, e]));
  function matches(element, rule) {
    if (!ownMatch(element, rule)) return false;
    if (!rule.within) return true;
    let parent = byRef.get(element.parent);
    const visited = new Set();
    while (parent && !visited.has(parent.ref)) {
      visited.add(parent.ref);
      if (matches(parent, rule.within)) return true;
      parent = byRef.get(parent.parent);
    }
    return false;
  }
  return snapshot.elements.filter(e => matches(e, selector));
}
export function identity(snapshot, element) {
  const byRef = new Map(snapshot.elements.map(e => [e.ref, e]));
  const ancestry = [];
  const visited = new Set();
  for (let current = element; current && !visited.has(current.ref); current = byRef.get(current.parent)) {
    visited.add(current.ref);
    ancestry.push([current.automationId, current.role, current.name]);
  }
  return JSON.stringify(ancestry);
}

export function validateCondition(condition, depth = 0) {
  requireThat(condition && typeof condition === 'object' && !Array.isArray(condition) && depth < 12, 'INVALID_CONDITION');
  const keys = Object.keys(condition);
  for (const group of ['all', 'any']) {
    if (group in condition) {
      requireThat(keys.length === 1 && Array.isArray(condition[group]) && condition[group].length > 0 && condition[group].length <= 32, 'INVALID_CONDITION');
      condition[group].forEach(c => validateCondition(c, depth + 1)); return;
    }
  }
  if ('not' in condition) {
    requireThat(keys.length === 1, 'INVALID_CONDITION'); validateCondition(condition.not, depth + 1); return;
  }
  validateSelector(condition.selector);
  const comparisons = ['exists', 'value', 'selected', 'toggleState', 'expandState', 'enabled'].filter(k => k in condition);
  requireThat(comparisons.length === 1 && keys.length === 2, 'INVALID_CONDITION', 'Use one comparison per condition; combine multiple conditions with all.');
  const key = comparisons[0];
  requireThat(['value', 'toggleState', 'expandState'].includes(key) ? typeof condition[key] === 'string' : typeof condition[key] === 'boolean', 'INVALID_CONDITION');
}

// Three-valued logic: absence in a truncated tree cannot prove absence in UI.
export function evaluate(snapshot, condition) {
  if (condition.all) {
    const states = condition.all.map(c => evaluate(snapshot, c));
    return states.includes(false) ? false : states.includes(null) ? null : true;
  }
  if (condition.any) {
    const states = condition.any.map(c => evaluate(snapshot, c));
    return states.includes(true) ? true : states.includes(null) ? null : false;
  }
  if (condition.not) { const state = evaluate(snapshot, condition.not); return state === null ? null : !state; }
  const matches = select(snapshot, condition.selector);
  if ('exists' in condition) {
    if (matches.length) return condition.exists;
    return snapshot.truncated ? null : !condition.exists;
  }
  if (matches.length !== 1) return !matches.length && snapshot.truncated ? null : false;
  const key = ['value', 'selected', 'toggleState', 'expandState', 'enabled'].find(k => k in condition);
  if (!(key in matches[0])) return null;
  return matches[0][key] === condition[key];
}
