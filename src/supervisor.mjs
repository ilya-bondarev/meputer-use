// Process entry point; scheduling belongs to runtime/supervisor.mjs.
import { setPriority, constants } from 'node:os';
import { JobStore } from './persistence/jobs.mjs';
import { runSupervisor } from './runtime/supervisor.mjs';

try { setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
const controller = new AbortController();
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => controller.abort());
await runSupervisor({ store: new JobStore(process.argv[2]), signal: controller.signal });
