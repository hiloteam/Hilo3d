import { prepareAssetRuntime } from './prepare-runtime.js';
await prepareAssetRuntime(new URL('../dist/runtime/basis.wasm', import.meta.url));
