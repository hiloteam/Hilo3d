import { AudioClip, clipPins, releaseClip, retainClip } from './AudioClip.js';
import { integer } from './internal.js';
import type { AudioClipCacheDiagnostics, AudioClipCacheOptions, AudioClipLease } from './types.js';

interface Waiter {
    resolve(lease: AudioClipLease): void;
    reject(error: unknown): void;
    detach(): void;
}

interface Entry {
    readonly url: string;
    readonly controller: AbortController;
    readonly waiters: Set<Waiter>;
    state: 'queued' | 'loading' | 'ready';
    clip?: AudioClip;
    used: number;
}

function abortError(signal?: AbortSignal): Error {
    const reason: unknown = signal?.reason;
    return reason instanceof Error ? reason : new DOMException('Audio load aborted', 'AbortError');
}

/** Deduplicated, bounded fetch/decode cache. Leases and active voices pin decoded PCM. */
export class AudioClipCache {
    private readonly entries = new Map<string, Entry>();
    private readonly fetcher: typeof globalThis.fetch;
    private readonly maxBytes: number;
    private readonly maxEntries: number;
    private readonly maxConcurrent: number;
    private readonly maxPending: number;
    private readonly maxEncoded: number;
    private bytes = 0;
    private active = 0;
    private serial = 0;
    private hits = 0;
    private evictions = 0;
    private destroyed = false;

    constructor(
        private readonly context: BaseAudioContext,
        options: AudioClipCacheOptions = {}
    ) {
        this.maxBytes = integer(
            options.maxBytes ?? 64 * 1024 * 1024,
            'maxBytes',
            1,
            Number.MAX_SAFE_INTEGER
        );
        this.maxEntries = integer(options.maxEntries ?? 256, 'maxEntries');
        this.maxConcurrent = integer(options.maxConcurrentLoads ?? 4, 'maxConcurrentLoads', 1, 32);
        this.maxPending = integer(options.maxPendingLoads ?? 64, 'maxPendingLoads');
        this.maxEncoded = integer(
            options.maxEncodedBytes ?? 16 * 1024 * 1024,
            'maxEncodedBytes',
            1,
            Number.MAX_SAFE_INTEGER
        );
        this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    }

    /** Each caller owns its abort signal and lease. One cancelled waiter never cancels its siblings. */
    load(url: string, options: { readonly signal?: AbortSignal } = {}): Promise<AudioClipLease> {
        if (this.destroyed) return Promise.reject(new Error('Audio clip cache is destroyed.'));
        if (!url.trim()) return Promise.reject(new TypeError('Audio URL must not be empty.'));
        const signal = options.signal;
        if (signal?.aborted) return Promise.reject(abortError(signal));
        let entry = this.entries.get(url);
        if (entry?.clip) {
            this.hits++;
            entry.used = ++this.serial;
            return Promise.resolve(this.lease(entry.clip));
        }
        if (!entry) {
            let pending = 0;
            for (const candidate of this.entries.values())
                if (candidate.state !== 'ready') pending++;
            if (pending >= this.maxPending)
                return Promise.reject(new Error('Audio load queue is full.'));
            entry = {
                url,
                controller: new AbortController(),
                waiters: new Set(),
                state: 'queued',
                used: ++this.serial
            };
            this.entries.set(url, entry);
        } else this.hits++;
        const target = entry;
        const result = new Promise<AudioClipLease>((resolve, reject) => {
            const abort = (): void => {
                target.waiters.delete(waiter);
                waiter.detach();
                reject(abortError(signal));
                if (target.waiters.size === 0 && !target.clip) {
                    if (this.entries.get(url) === target) this.entries.delete(url);
                    target.controller.abort();
                    this.pump();
                }
            };
            const waiter: Waiter = {
                resolve,
                reject,
                detach: (): void => {
                    signal?.removeEventListener('abort', abort);
                }
            };
            target.waiters.add(waiter);
            signal?.addEventListener('abort', abort, { once: true });
        });
        this.pump();
        return result;
    }

    /** Evict all unpinned resident clips; pending loads and live leases remain intact. */
    clearUnused(): void {
        for (const entry of this.entries.values()) {
            if (entry.clip && clipPins(entry.clip) === 0) this.evict(entry);
        }
    }

    getDiagnostics(): AudioClipCacheDiagnostics {
        let pinnedEntries = 0;
        let entries = 0;
        let pendingLoads = 0;
        for (const entry of this.entries.values()) {
            if (entry.clip) {
                entries++;
                if (clipPins(entry.clip) > 0) pinnedEntries++;
            } else pendingLoads++;
        }
        return {
            bytes: this.bytes,
            entries,
            pinnedEntries,
            activeLoads: this.active,
            pendingLoads,
            hits: this.hits,
            evictions: this.evictions
        };
    }

    /** Abort fetches and reject waiters immediately. Uncancelable decodes cannot repopulate the cache. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        const error = new DOMException('Audio cache destroyed', 'AbortError');
        for (const entry of this.entries.values()) {
            entry.controller.abort(error);
            for (const waiter of entry.waiters) {
                waiter.detach();
                waiter.reject(error);
            }
            entry.waiters.clear();
        }
        this.entries.clear();
        this.bytes = 0;
    }

    private lease(clip: AudioClip): AudioClipLease {
        retainClip(clip);
        let released = false;
        return {
            clip,
            release(): void {
                if (!released) {
                    released = true;
                    releaseClip(clip);
                }
            }
        };
    }

    private evict(entry: Entry): void {
        if (!entry.clip) return;
        this.bytes -= entry.clip.byteLength;
        this.entries.delete(entry.url);
        this.evictions++;
    }

    private admit(clip: AudioClip): void {
        if (clip.byteLength > this.maxBytes)
            throw new Error('Decoded audio clip exceeds the cache byte budget.');
        for (;;) {
            let count = 0;
            let oldest: Entry | undefined;
            for (const entry of this.entries.values()) {
                if (!entry.clip) continue;
                count++;
                if (clipPins(entry.clip) === 0 && (!oldest || entry.used < oldest.used))
                    oldest = entry;
            }
            if (this.bytes + clip.byteLength <= this.maxBytes && count < this.maxEntries) return;
            if (!oldest)
                throw new Error(
                    'Audio cache is full of pinned clips. Release leases or increase the budget.'
                );
            this.evict(oldest);
        }
    }

    private pump(): void {
        if (this.destroyed) return;
        for (const entry of this.entries.values()) {
            if (this.active >= this.maxConcurrent) break;
            if (entry.state !== 'queued') continue;
            entry.state = 'loading';
            this.active++;
            void this.decode(entry);
        }
    }

    private async read(entry: Entry): Promise<ArrayBuffer> {
        const response = await this.fetcher(entry.url, { signal: entry.controller.signal });
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Audio fetch failed (${String(response.status)}): ${entry.url}`);
        }
        const length = Number(response.headers.get('content-length'));
        if (length > this.maxEncoded) {
            await response.body?.cancel();
            throw new Error('Encoded audio exceeds maxEncodedBytes.');
        }
        if (!response.body) throw new Error('Audio response has no body.');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
            for (;;) {
                const chunk = await reader.read();
                entry.controller.signal.throwIfAborted();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > this.maxEncoded)
                    throw new Error('Encoded audio exceeds maxEncodedBytes.');
                chunks.push(chunk.value);
            }
        } catch (error) {
            await reader.cancel().catch(() => {
                /* Original read/abort error is authoritative. */
            });
            throw error;
        } finally {
            reader.releaseLock();
        }
        const data = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return data.buffer;
    }

    private async decode(entry: Entry): Promise<void> {
        try {
            const data = await this.read(entry);
            entry.controller.signal.throwIfAborted();
            const buffer = await this.context.decodeAudioData(data);
            entry.controller.signal.throwIfAborted();
            if (this.destroyed || this.entries.get(entry.url) !== entry) return;
            const clip = new AudioClip(buffer, entry.url);
            this.admit(clip);
            entry.clip = clip;
            entry.state = 'ready';
            this.bytes += clip.byteLength;
            for (const waiter of entry.waiters) {
                waiter.detach();
                waiter.resolve(this.lease(clip));
            }
        } catch (error) {
            if (this.entries.get(entry.url) === entry) this.entries.delete(entry.url);
            for (const waiter of entry.waiters) {
                waiter.detach();
                waiter.reject(error);
            }
        } finally {
            entry.waiters.clear();
            this.active--;
            this.pump();
        }
    }
}
