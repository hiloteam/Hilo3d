import { fileURLToPath } from 'node:url';
import { buildPinnedLive2DRuntime } from './prepare-runtime.js';

// The gallery and package consume one hash-verified build of the pinned SDK and adapter.
// Consumers install the completed files; no SDK download or install-time build is required.
const output = fileURLToPath(new URL('../dist/runtime/prebuilt/', import.meta.url));
await buildPinnedLive2DRuntime(output, 'stable');
