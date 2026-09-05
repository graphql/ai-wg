// Worker bootstrap for the templates benchmark. node:worker_threads can't
// resolve .ts files even with `--import tsx` in execArgv, so we load the TS
// worker via tsx's programmatic API. Mirrors benchmarks/strategies/worker-entry.mjs.
import { tsImport } from 'tsx/esm/api';
await tsImport('./worker.ts', import.meta.url);
