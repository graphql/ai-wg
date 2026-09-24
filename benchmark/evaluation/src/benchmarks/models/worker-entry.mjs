// Worker bootstrap. node:worker_threads can't resolve .ts files by default
// even with `--import tsx` in execArgv, so we load the TS worker via tsx's
// programmatic API.
import { tsImport } from 'tsx/esm/api';
await tsImport('./worker.ts', import.meta.url);
