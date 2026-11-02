// Compatibility composition: the domain receives the registered platform names.
import { platformNames } from './connector-registry.mjs';
import { validateConnectorCall as validateCall, validateConnectorCondition as validateCondition } from './services/jobs/index.mjs';
export { valueAt, bindOutputs, matchesConnector } from './services/jobs/index.mjs';
export const validateConnectorCall = call => validateCall(call, platformNames);
export const validateConnectorCondition = condition => validateCondition(condition, platformNames);
