// Composition only: register each platform once; domain rules stay in services.
import * as telegram from './services/telegram/index.mjs';
import * as x from './services/x/index.mjs';
import * as metrika from './services/metrika/index.mjs';

const domains = { telegram, x, metrika };
export const platformNames = Object.freeze(Object.keys(domains));
export const hasConnectorDomain = platform => Object.hasOwn(domains, platform);
export const connectorDomain = platform => domains[platform];
