import type { DecodedAssetTexture, TextureAssetDecoder, TextureDecodeRequest } from './types.js';

/** Dedicated module-worker transcoder pool. Aborting a synchronous WASM job terminates its worker. */
export class WorkerTextureDecoder implements TextureAssetDecoder {
    readonly #idle: Worker[] = [];
    readonly #active = new Map<Worker, (reason: Error) => void>();
    #destroyed = false;
    constructor(
        readonly maxWorkers = 2,
        readonly memoryBytes = 32 * 1024 * 1024
    ) {
        if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 16)
            throw new RangeError('Worker count must be in [1, 16].');
        if (
            !Number.isSafeInteger(memoryBytes) ||
            memoryBytes < 16 * 1024 * 1024 ||
            memoryBytes % 65536 !== 0
        )
            throw new RangeError('Worker memory must be page-aligned and at least 16 MiB.');
    }

    decode(
        request: Readonly<TextureDecodeRequest>,
        signal: AbortSignal
    ): Promise<DecodedAssetTexture> {
        if (this.#destroyed) return Promise.reject(new Error('Texture decoder is destroyed.'));
        signal.throwIfAborted();
        if (this.#active.size >= this.maxWorkers)
            return Promise.reject(new RangeError('Texture worker pool is full.'));
        const worker =
            this.#idle.pop() ??
            new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        return new Promise((resolve, reject) => {
            const finish = (error: Error | null, result?: DecodedAssetTexture): void => {
                if (!this.#active.delete(worker)) return;
                signal.removeEventListener('abort', abort);
                worker.onmessage = null;
                worker.onerror = null;
                worker.onmessageerror = null;
                if (error || this.#destroyed) worker.terminate();
                else this.#idle.push(worker);
                if (error) reject(error);
                else if (result) resolve(result);
                else reject(new Error('Texture worker returned no result.'));
            };
            const abort = (): void => {
                finish(new DOMException('Texture decoding cancelled.', 'AbortError'));
            };
            this.#active.set(worker, reason => {
                finish(reason);
            });
            signal.addEventListener('abort', abort, { once: true });
            worker.onerror = event => {
                event.preventDefault();
                finish(new Error(event.message || 'Texture worker failed.'));
            };
            worker.onmessageerror = () => {
                finish(new Error('Texture worker returned an invalid message.'));
            };
            worker.onmessage = (
                event: MessageEvent<{ error?: string; result?: DecodedAssetTexture }>
            ) => {
                finish(event.data.error ? new Error(event.data.error) : null, event.data.result);
            };
            try {
                worker.postMessage({ request, memoryBytes: this.memoryBytes }, [request.data]);
            } catch (error) {
                finish(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        for (const reject of [...this.#active.values()])
            reject(new DOMException('Texture decoder destroyed.', 'AbortError'));
        for (const worker of this.#idle) worker.terminate();
        this.#idle.length = 0;
    }
}
