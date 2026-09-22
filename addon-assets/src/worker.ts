import { createBasisDecoder } from './BasisDecoder.js';
import type { DecodedAssetTexture, TextureDecodeRequest } from './types.js';

interface WorkerScope {
    onmessage:
        | ((event: MessageEvent<{ request: TextureDecodeRequest; memoryBytes: number }>) => void)
        | null;
    postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
let decoder: Promise<(request: Readonly<TextureDecodeRequest>) => DecodedAssetTexture> | null =
    null;
scope.onmessage = event => {
    const { request, memoryBytes } = event.data;
    decoder ??= (async () => {
        const response = await fetch(new URL('./runtime/basis.wasm', import.meta.url));
        if (!response.ok) throw new Error(`Basis WASM request failed: ${String(response.status)}`);
        return createBasisDecoder(await response.arrayBuffer(), memoryBytes);
    })();
    void decoder
        .then(decode => {
            const result = decode(request);
            scope.postMessage(
                { result },
                result.mipmaps.map(mip => mip.data.buffer)
            );
        })
        .catch((error: unknown) => {
            decoder = null;
            scope.postMessage(
                { error: error instanceof Error ? error.message : String(error) },
                []
            );
        });
};
