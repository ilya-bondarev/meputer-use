import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { requireThat } from './errors.mjs';

export function summarize(values) {
  requireThat(values.length > 0 && values.every(Number.isFinite), 'INVALID_SAMPLES');
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, min: sorted[0], median: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] :
    (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
  p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
}
export async function benchmarkRead(executor, { samples = 3, observe = {}, signal } = {}) {
  requireThat(executor.mode === 'read-only', 'READ_ONLY_BENCHMARK_REQUIRED');
  requireThat(Number.isInteger(samples) && samples > 0 && samples <= 5, 'INVALID_SAMPLES');
  const measurements = [];
  for (let i = 0; i < samples; i++) {
    if (signal?.aborted) break;
    const t = performance.now();
    const snapshot = await executor.observe(observe);
    // Deliberately retain metrics only: never document text, field values or titles.
    measurements.push({ roundTripMs: performance.now() - t, nativeMs: snapshot.elapsedMs,
      elements: snapshot.elements.length, truncated: snapshot.truncated, inputChangedDuringRead: snapshot.inputChangedDuringRead });
    if (i + 1 < samples) await delay(250, undefined, { signal });
  }
  requireThat(measurements.length > 0, 'CANCELLED');
  return { kind: 'read-only', includesStartup: false, includesActions: false, includesModel: false,
    options: { ...observe, scope: observe.scope ? { configured: true } : undefined },
    measurements, roundTrip: summarize(measurements.map(x => x.roundTripMs)),
    native: summarize(measurements.map(x => x.nativeMs)),
    note: 'Small sample: this measures read latency, not full-task speedup. The first sample is retained separately in measurements.' };
}
