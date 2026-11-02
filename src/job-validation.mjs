// Bind the pure job contract to this distribution's registered connectors.
import { platformNames } from './connector-registry.mjs';
import { validateJob as validateDefinition } from './services/jobs/index.mjs';
export const validateJob = job => validateDefinition(job, platformNames);
