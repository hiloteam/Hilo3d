import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { prepareAssetRuntime } from './prepare-runtime.js';

/** Source-checkout worker/asset locations; published packages contain the same colocated files. */
export function assetRuntimePlugin(): Plugin {
    const worker = fileURLToPath(new URL('../src/worker.ts', import.meta.url));
    let pending: Promise<void> | undefined;
    return {
        name: 'hilo3d-assets-runtime',
        enforce: 'pre',
        async transform(code, id): Promise<string | null> {
            if (id.split('?')[0] !== worker) return null;
            pending ??= prepareAssetRuntime(new URL('../dist/runtime/basis.wasm', import.meta.url));
            await pending;
            return code.replace("'./runtime/basis.wasm'", "'../dist/runtime/basis.wasm'");
        }
    };
}
