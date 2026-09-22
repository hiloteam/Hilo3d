import { Texture, constants } from 'hilo3d';
import { selectTextureFormat, textureByteLength } from './KTX2.js';
import { WorkerTextureDecoder } from './WorkerDecoder.js';
import type {
    AssetBudgets,
    AssetDiagnostics,
    AssetManagerOptions,
    AssetRenderer,
    AssetStallReason,
    AssetTextureCapabilities,
    DecodedAssetTexture,
    TextureAssetDecoder,
    TextureAssetDemand,
    TextureAssetDiagnostics,
    TextureAssetLease,
    TextureAssetSource
} from './types.js';

const MiB = 1024 * 1024;
const defaults: Required<AssetBudgets> = {
    concurrentRequests: 2,
    queuedAssets: 128,
    sourceBytes: 16 * MiB,
    cpuBytes: 128 * MiB,
    inFlightBytes: 64 * MiB,
    residentBytes: 128 * MiB,
    uploadBytesPerFrame: 8 * MiB,
    uploadsPerFrame: 4,
    workerMemoryBytes: 32 * MiB
};
interface Waiter {
    promise: Promise<void>;
    resolve(): void;
    reject(reason: unknown): void;
}
interface Claim {
    demand: Required<TextureAssetDemand>;
    waiter: Waiter;
    released: boolean;
    detach(): void;
}
interface Entry {
    readonly key: string;
    readonly source: Readonly<TextureAssetSource>;
    readonly texture: Texture<Uint8Array>;
    readonly claims: Set<Claim>;
    generation: number;
    used: number;
    state: TextureAssetDiagnostics['state'];
    stall: AssetStallReason;
    error: Error | null;
    resident: DecodedAssetTexture | null;
    decoded: DecodedAssetTexture | null;
    job: AbortController | null;
    uploading: boolean;
    wantedMip: number;
    wantedVisible: boolean;
}

function abortError(): DOMException {
    return new DOMException('Asset request cancelled or superseded.', 'AbortError');
}
function waiter(): Waiter {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    void promise.catch(() => {
        /* Failure is retained by the owning waiter/diagnostics. */
    });
    return { promise, resolve, reject };
}
function bytes(value: DecodedAssetTexture | null): number {
    return value?.mipmaps.reduce((sum, mip) => sum + mip.data.byteLength, 0) ?? 0;
}
function demand(
    value: Readonly<TextureAssetDemand>,
    source: Readonly<TextureAssetSource>
): Required<TextureAssetDemand> {
    const mipLevel = value.mipLevel ?? 0,
        priority = value.priority ?? 0,
        visible = value.visible ?? true;
    if (!Number.isSafeInteger(mipLevel) || mipLevel < 0 || mipLevel >= source.mipLevelCount)
        throw new RangeError('Texture demand mip is outside the authored chain.');
    if (!Number.isFinite(priority) || typeof visible !== 'boolean')
        throw new TypeError('Invalid texture demand.');
    return { mipLevel, priority, visible };
}
function target(entry: Entry): { mip: number; priority: number; visible: boolean } {
    let mip = entry.source.mipLevelCount - 1,
        priority = -Infinity,
        visible = false;
    for (const claim of entry.claims) {
        if (!claim.demand.visible) continue;
        visible = true;
        mip = Math.min(mip, claim.demand.mipLevel);
        priority = Math.max(priority, claim.demand.priority);
    }
    return { mip, priority, visible };
}
function placeholder(texture: Texture<Uint8Array>): void {
    texture.width = 1;
    texture.height = 1;
    texture.mipmaps = null;
    texture.compressed = false;
    texture.format = constants.RGBA;
    texture.internalFormat = constants.RGBA8;
    texture.minFilter = constants.LINEAR;
    texture.image = new Uint8Array([128, 128, 128, 255]);
    texture.needUpdate = true;
}
function apply(texture: Texture<Uint8Array>, decoded: DecodedAssetTexture): void {
    const first = decoded.mipmaps[0];
    if (!first) throw new RangeError('Decoded asset contains no mipmaps.');
    const srgb = decoded.colorSpace === 'srgb';
    texture.internalFormat =
        decoded.format === 'astc'
            ? srgb
                ? constants.COMPRESSED_SRGB8_ALPHA8_ASTC_4X4_KHR
                : constants.COMPRESSED_RGBA_ASTC_4X4_KHR
            : decoded.format === 'bc3'
              ? srgb
                  ? constants.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT
                  : constants.COMPRESSED_RGBA_S3TC_DXT5_EXT
              : decoded.format === 'etc2'
                ? srgb
                    ? constants.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC
                    : constants.COMPRESSED_RGBA8_ETC2_EAC
                : srgb
                  ? constants.SRGB8_ALPHA8
                  : constants.RGBA8;
    texture.compressed = decoded.format !== 'rgba8';
    texture.format = texture.compressed ? texture.internalFormat : constants.RGBA;
    texture.width = first.width;
    texture.height = first.height;
    texture.mipmaps = decoded.mipmaps.map(mip => ({ ...mip }));
    texture.minFilter =
        decoded.mipmaps.length > 1 ? constants.LINEAR_MIPMAP_LINEAR : constants.LINEAR;
    texture.image = first.data;
    texture.needUpdate = true;
}

/**
 * Bounded, renderer-local KTX2 residency owner. Claims share an identity; visibility and authored
 * mip demand drive priority, coarse-first loading, promotion and hidden-asset eviction.
 * Network/decode may overlap, while uploads are serialized and retire through core submission fences.
 */
export class AssetManager {
    readonly #entries = new Map<string, Entry>();
    readonly #decoder: TextureAssetDecoder;
    readonly #fetch: typeof fetch;
    readonly #baseURL: string;
    readonly #auto: boolean;
    readonly #timeout: number;
    readonly #heapReserve: number;
    readonly #capabilities: Readonly<AssetTextureCapabilities>;
    readonly #budgets: Readonly<Required<AssetBudgets>>;
    #clock = 0;
    #active = 0;
    #inFlight = 0;
    #uploadingBytes = 0;
    #retiringBytes = 0;
    #lastUploadBytes = 0;
    #evictions = 0;
    #cancellations = 0;
    #destroyed = false;
    #recovering = false;
    #epoch = 0;
    #scheduled: number | null = null;
    #updating: Promise<void> | null = null;
    readonly #lost = (): void => {
        this.#recovering = true;
        this.#epoch++;
        for (const entry of this.#entries.values()) {
            this.cancelJob(entry);
            if (entry.uploading) continue;
            entry.decoded = entry.resident ?? entry.decoded;
            entry.resident = null;
            entry.texture.destroy();
            placeholder(entry.texture);
            entry.state = entry.decoded ? 'decoded' : 'queued';
            entry.stall = 'recovering';
        }
    };
    readonly #restored = (): void => {
        this.#recovering = false;
        this.schedule();
    };
    readonly #resourcesReleased = (): void => {
        this.#lost();
        this.#restored();
    };
    readonly #recoveryFailed = (): void => {
        for (const entry of this.#entries.values())
            this.fail(entry, new Error('Asset renderer recovery failed.'));
    };

    constructor(
        readonly renderer: AssetRenderer,
        options: Readonly<AssetManagerOptions> = {}
    ) {
        const budgets = { ...defaults, ...options.budgets };
        for (const [name, value] of Object.entries(budgets)) {
            if (!Number.isSafeInteger(value) || value < 1)
                throw new RangeError(`Asset budget ${name} must be a positive safe integer.`);
        }
        if (budgets.concurrentRequests > 16)
            throw new RangeError('Asset concurrency cannot exceed 16.');
        this.#heapReserve = options.decoder
            ? 0
            : budgets.concurrentRequests * budgets.workerMemoryBytes;
        if (budgets.cpuBytes <= this.#heapReserve)
            throw new RangeError('CPU budget must leave room beyond reserved worker heaps.');
        this.#budgets = Object.freeze(budgets);
        this.#decoder =
            options.decoder ??
            new WorkerTextureDecoder(budgets.concurrentRequests, budgets.workerMemoryBytes);
        this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.#baseURL =
            options.baseURL ??
            (typeof document === 'undefined' ? 'http://localhost/' : document.baseURI);
        this.#auto = options.autoUpdate ?? true;
        this.#timeout = options.requestTimeoutMilliseconds ?? 30000;
        if (!Number.isFinite(this.#timeout) || this.#timeout <= 0)
            throw new RangeError('Asset request deadline must be positive and finite.');
        this.#capabilities = Object.freeze({
            astc: renderer.supportsTextureCompression('astc-4x4'),
            bc: renderer.supportsTextureCompression('bc'),
            etc2: renderer.supportsTextureCompression('etc2')
        });
        renderer.on('rhiDeviceLost', this.#lost);
        renderer.on('rhiDeviceRestored', this.#restored);
        renderer.on('rhiDeviceRecoveryFailed', this.#recoveryFailed);
        renderer.on('rhiResourcesReleased', this.#resourcesReleased);
    }

    /** Acquire a reference, immediately returning a stable placeholder texture and a readiness promise. */
    acquireTexture(
        source: Readonly<TextureAssetSource>,
        initial: Readonly<TextureAssetDemand> = {},
        signal?: AbortSignal
    ): TextureAssetLease {
        this.assertAlive();
        signal?.throwIfAborted();
        const normalized = this.normalizeSource(source);
        const requested = demand(initial, normalized);
        this.validateDemand(normalized, requested.mipLevel);
        const key = JSON.stringify([normalized.id, normalized.version]);
        let entry = this.#entries.get(key);
        if (entry && JSON.stringify(entry.source) !== JSON.stringify(normalized))
            throw new Error('Asset identity already refers to different immutable metadata.');
        if (!entry) {
            if (
                this.cpuBytes() + 4 > this.#budgets.cpuBytes ||
                this.residentBytes() + 4 > this.#budgets.residentBytes
            ) {
                throw new RangeError('Asset placeholder residency budget exhausted.');
            }
            if (this.#entries.size >= this.#budgets.queuedAssets)
                throw new RangeError('Asset queue capacity exceeded.');
            const texture = new Texture<Uint8Array>({
                width: 1,
                height: 1,
                image: new Uint8Array([128, 128, 128, 255]),
                minFilter: constants.LINEAR,
                wrapS: constants.CLAMP_TO_EDGE,
                wrapT: constants.CLAMP_TO_EDGE,
                flipY: false,
                name: `${normalized.id}@${normalized.version}`
            });
            entry = {
                key,
                source: normalized,
                texture,
                claims: new Set(),
                generation: 0,
                used: ++this.#clock,
                state: 'queued',
                stall: 'none',
                error: null,
                resident: null,
                decoded: null,
                job: null,
                uploading: false,
                wantedMip: normalized.mipLevelCount - 1,
                wantedVisible: false
            };
            this.#entries.set(key, entry);
        }
        const owned = entry;
        const claim: Claim = {
            demand: requested,
            waiter: waiter(),
            released: false,
            detach: () => {
                /* No AbortSignal listener has been installed. */
            }
        };
        owned.claims.add(claim);
        const setDemand = (next: Readonly<TextureAssetDemand>): Promise<void> => {
            this.assertAlive();
            if (claim.released) throw new Error('Asset lease is released.');
            const resolved = demand(next, normalized);
            this.validateDemand(normalized, resolved.mipLevel);
            if (
                !owned.error &&
                resolved.mipLevel === claim.demand.mipLevel &&
                resolved.priority === claim.demand.priority &&
                resolved.visible === claim.demand.visible
            )
                return claim.waiter.promise;
            claim.waiter.reject(abortError());
            claim.waiter = waiter();
            claim.demand = resolved;
            owned.used = ++this.#clock;
            owned.error = null;
            this.reconcile(owned);
            return claim.waiter.promise;
        };
        const release = (): void => {
            if (claim.released) return;
            claim.released = true;
            claim.detach();
            claim.waiter.reject(abortError());
            owned.claims.delete(claim);
            if (this.#destroyed) return;
            this.reconcile(owned);
        };
        const onAbort = (): void => {
            release();
        };
        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
            claim.detach = () => {
                signal.removeEventListener('abort', onAbort);
            };
        }
        const ready = claim.waiter.promise;
        this.reconcile(owned);
        return Object.freeze({
            texture: owned.texture,
            ready,
            setDemand,
            retry: () => setDemand(claim.demand),
            release
        });
    }

    /** Admit network/decode work and at most one frame's upload budget. Overlapping calls coalesce. */
    update(): Promise<void> {
        this.assertAlive();
        if (this.#updating) return this.#updating;
        const operation = this.updateFrame().catch((error: unknown) => {
            for (const entry of this.#entries.values()) this.fail(entry, error);
            throw error;
        });
        this.#updating = operation;
        void operation
            .finally(() => {
                this.#updating = null;
                this.schedule();
            })
            .catch(() => {
                /* Failure is retained by the owning waiter/diagnostics. */
            });
        return operation;
    }

    /** Immutable accounting and per-asset stall diagnostics. Includes conservative worker heap reservations. */
    getDiagnostics(): Readonly<AssetDiagnostics> {
        return Object.freeze({
            assets: Object.freeze(
                [...this.#entries.values()].map(entry =>
                    Object.freeze({
                        id: entry.source.id,
                        version: entry.source.version,
                        state: entry.state,
                        requestedMip: target(entry).mip,
                        residentMip: entry.resident?.mipLevel ?? null,
                        residentBytes: bytes(entry.resident),
                        references: entry.claims.size,
                        stall: entry.stall,
                        error: entry.error?.message ?? null
                    })
                )
            ),
            cpuBytes: this.cpuBytes(),
            inFlightBytes: this.#inFlight,
            residentBytes: this.residentBytes(),
            pendingRetirementBytes: this.#retiringBytes,
            activeRequests: this.#active,
            uploadBytesLastFrame: this.#lastUploadBytes,
            evictions: this.#evictions,
            cancellations: this.#cancellations
        });
    }

    /** Cancel all claims, terminate workers and submission-safely release textures. Idempotent. */
    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#epoch++;
        if (this.#scheduled !== null) cancelAnimationFrame(this.#scheduled);
        this.renderer.off('rhiDeviceLost', this.#lost);
        this.renderer.off('rhiDeviceRestored', this.#restored);
        this.renderer.off('rhiDeviceRecoveryFailed', this.#recoveryFailed);
        this.renderer.off('rhiResourcesReleased', this.#resourcesReleased);
        const errors: unknown[] = [];
        for (const entry of this.#entries.values()) {
            this.cancelJob(entry);
            for (const claim of entry.claims) {
                claim.released = true;
                claim.detach();
                claim.waiter.reject(abortError());
            }
            try {
                entry.texture.destroy();
            } catch (error) {
                errors.push(error);
            }
            placeholder(entry.texture);
            entry.resident = null;
            entry.decoded = null;
        }
        this.#entries.clear();
        this.#decoder.destroy();
        if (errors.length) throw new AggregateError(errors, 'Asset cleanup failed.');
    }

    private normalizeSource(value: Readonly<TextureAssetSource>): Readonly<TextureAssetSource> {
        if (
            ![value.id, value.version, value.url].every(
                part => typeof part === 'string' && part.trim().length > 0
            )
        )
            throw new TypeError('Asset id, version and URL must be non-empty.');
        for (const number of [value.width, value.height, value.byteLength, value.mipLevelCount])
            if (!Number.isSafeInteger(number) || number < 1)
                throw new RangeError(
                    'Asset dimensions, size and mip count must be positive integers.'
                );
        if (
            value.width > 16384 ||
            value.height > 16384 ||
            value.mipLevelCount !== Math.floor(Math.log2(Math.max(value.width, value.height))) + 1
        )
            throw new RangeError(
                'Assets require dimensions <= 16384 and a full mip chain through 1x1.'
            );
        if (value.byteLength > this.#budgets.sourceBytes)
            throw new RangeError('Encoded asset exceeds the source byte budget.');
        const url = new URL(value.url, this.#baseURL);
        if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'blob:')
            throw new TypeError('Asset URL must use HTTP(S) or blob.');
        if (url.protocol !== 'blob:') url.searchParams.set('hilo_asset_version', value.version);
        return Object.freeze({
            id: value.id,
            version: value.version,
            url: url.href,
            byteLength: value.byteLength,
            width: value.width,
            height: value.height,
            mipLevelCount: value.mipLevelCount
        });
    }
    private validateDemand(source: Readonly<TextureAssetSource>, mip: number): void {
        const size = textureByteLength(
            source,
            mip,
            selectTextureFormat(this.#capabilities, source, mip)
        );
        const scratch = source.byteLength * 2 + size * 2;
        if (size > this.#budgets.uploadBytesPerFrame || size + 4 > this.#budgets.residentBytes)
            throw new RangeError(
                'Requested mip exceeds an atomic upload/residency budget; request a coarser mip or increase the budget.'
            );
        if (
            scratch > this.#budgets.inFlightBytes ||
            scratch + this.#heapReserve + size > this.#budgets.cpuBytes
        )
            throw new RangeError('Requested asset exceeds decode/in-flight budgets.');
    }
    private reconcile(entry: Entry): void {
        const requested = target(entry);
        entry.used = ++this.#clock;
        const changed =
            entry.wantedMip !== requested.mip || entry.wantedVisible !== requested.visible;
        entry.wantedMip = requested.mip;
        entry.wantedVisible = requested.visible;
        if (changed || entry.claims.size === 0) {
            this.cancelJob(entry);
            if (!entry.uploading) entry.decoded = null;
        }
        if (entry.claims.size === 0) {
            if (!entry.uploading) this.retire(entry, true);
            return;
        }
        if (!requested.visible) {
            entry.stall = 'hidden';
            this.schedule();
            return;
        }
        if (entry.error) {
            this.fail(entry, entry.error);
            return;
        }
        entry.stall = this.#recovering ? 'recovering' : 'none';
        if (!entry.uploading) entry.state = entry.resident ? 'resident' : 'queued';
        this.resolveClaims(entry);
        this.schedule();
    }
    private resolveClaims(entry: Entry): void {
        if (!entry.resident || this.#recovering) return;
        for (const claim of entry.claims)
            if (claim.demand.visible && entry.resident.mipLevel <= claim.demand.mipLevel)
                claim.waiter.resolve();
    }
    private cancelJob(entry: Entry): void {
        entry.generation++;
        if (entry.job) {
            this.#cancellations++;
            entry.job.abort();
            entry.job = null;
        }
    }
    private cpuBytes(): number {
        let count = this.#destroyed ? 0 : this.#heapReserve;
        for (const entry of this.#entries.values())
            count += bytes(entry.resident) + bytes(entry.decoded) + 4;
        return count + this.#inFlight + this.#uploadingBytes;
    }
    private residentBytes(): number {
        let count = this.#retiringBytes + this.#uploadingBytes;
        for (const entry of this.#entries.values())
            count += entry.resident ? bytes(entry.resident) : 4;
        return count;
    }
    private orderedEntries(): Entry[] {
        return [...this.#entries.values()].sort(
            (left, right) =>
                target(right).priority - target(left).priority || left.used - right.used
        );
    }
    private async updateFrame(): Promise<void> {
        this.#lastUploadBytes = 0;
        if (this.#recovering) return;
        let uploaded = 0;
        for (const entry of this.orderedEntries()) {
            if (this.isSuspended()) return;
            const requested = target(entry);
            if (!requested.visible || entry.error || entry.uploading || entry.claims.size === 0)
                continue;
            const pending = entry.decoded;
            if (pending) {
                const size = bytes(pending);
                if (
                    uploaded >= this.#budgets.uploadsPerFrame ||
                    this.#lastUploadBytes + size > this.#budgets.uploadBytesPerFrame
                ) {
                    entry.stall = 'upload-budget';
                    continue;
                }
                if (this.residentBytes() + size > this.#budgets.residentBytes) {
                    this.evictHidden();
                    entry.stall = 'resident-budget';
                    continue;
                }
                this.#lastUploadBytes += size;
                uploaded++;
                await this.upload(entry, pending);
                continue;
            }
            if (
                entry.job ||
                entry.resident?.mipLevel === requested.mip ||
                this.#active >= this.#budgets.concurrentRequests
            )
                continue;
            const mip = entry.resident ? requested.mip : entry.source.mipLevelCount - 1;
            if (
                entry.resident &&
                mip > entry.resident.mipLevel &&
                entry.resident.format === selectTextureFormat(this.#capabilities, entry.source, mip)
            ) {
                entry.decoded = {
                    ...entry.resident,
                    mipLevel: mip,
                    mipmaps: entry.resident.mipmaps.slice(mip - entry.resident.mipLevel)
                };
                entry.state = 'decoded';
                continue;
            }
            const reserve =
                entry.source.byteLength * 2 +
                textureByteLength(
                    entry.source,
                    mip,
                    selectTextureFormat(this.#capabilities, entry.source, mip)
                ) *
                    2;
            if (this.#inFlight + reserve > this.#budgets.inFlightBytes) {
                entry.stall = 'in-flight-budget';
                continue;
            }
            if (this.cpuBytes() + reserve > this.#budgets.cpuBytes) {
                this.evictHidden();
                entry.stall = 'cpu-budget';
                continue;
            }
            this.startJob(entry, mip, reserve);
        }
    }
    private startJob(entry: Entry, mip: number, reserve: number): void {
        const controller = new AbortController(),
            generation = entry.generation;
        entry.job = controller;
        entry.state = 'loading';
        entry.stall = 'none';
        this.#active++;
        this.#inFlight += reserve;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException('Asset request timed out.', 'TimeoutError'));
        }, this.#timeout);
        void (async (): Promise<void> => {
            const data = await this.fetchSource(entry.source, controller.signal);
            controller.signal.throwIfAborted();
            const decoded = await this.#decoder.decode(
                { data, source: entry.source, mipLevel: mip, capabilities: this.#capabilities },
                controller.signal
            );
            controller.signal.throwIfAborted();
            if (this.#destroyed || generation !== entry.generation) return;
            this.validateDecoded(entry.source, mip, decoded);
            entry.decoded = decoded;
            entry.state = 'decoded';
        })()
            .catch((reason: unknown) => {
                if (
                    !this.#destroyed &&
                    generation === entry.generation &&
                    (!controller.signal.aborted || timedOut)
                )
                    this.fail(
                        entry,
                        timedOut
                            ? new DOMException('Asset request timed out.', 'TimeoutError')
                            : reason
                    );
            })
            .finally(() => {
                clearTimeout(timer);
                this.#active--;
                this.#inFlight -= reserve;
                if (entry.job === controller) entry.job = null;
                this.schedule();
            });
    }
    private async fetchSource(
        source: Readonly<TextureAssetSource>,
        signal: AbortSignal
    ): Promise<ArrayBuffer> {
        const response = await this.#fetch(source.url, { signal });
        if (!response.ok)
            throw new Error(`Asset fetch failed (${String(response.status)}): ${source.id}`);
        if (!response.body)
            throw new Error('Asset transport must expose a readable response body.');
        const reader = response.body.getReader(),
            output = new Uint8Array(source.byteLength);
        let offset = 0;
        try {
            for (;;) {
                signal.throwIfAborted();
                const next = await reader.read();
                if (next.done) break;
                if (offset + next.value.byteLength > output.byteLength)
                    throw new RangeError('Asset response exceeds its declared byte length.');
                output.set(next.value, offset);
                offset += next.value.byteLength;
            }
            if (offset !== output.byteLength)
                throw new RangeError('Asset response is shorter than its declared byte length.');
            return output.buffer;
        } finally {
            await reader.cancel().catch(() => {
                /* Failure is retained by the owning waiter/diagnostics. */
            });
            reader.releaseLock();
        }
    }
    private validateDecoded(
        source: Readonly<TextureAssetSource>,
        mip: number,
        decoded: DecodedAssetTexture
    ): void {
        if (
            decoded.format !== selectTextureFormat(this.#capabilities, source, mip) ||
            decoded.mipLevel !== mip ||
            !['linear', 'srgb'].includes(decoded.colorSpace) ||
            decoded.mipmaps.length !== source.mipLevelCount - mip
        )
            throw new TypeError('Decoder returned an incompatible mip chain.');
        for (const [index, level] of decoded.mipmaps.entries()) {
            const width = Math.max(1, Math.floor(source.width / 2 ** (index + mip))),
                height = Math.max(1, Math.floor(source.height / 2 ** (index + mip)));
            const size =
                decoded.format === 'rgba8'
                    ? width * height * 4
                    : Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
            if (
                level.width !== width ||
                level.height !== height ||
                !(level.data instanceof Uint8Array) ||
                level.data.byteLength !== size ||
                !(level.data.buffer instanceof ArrayBuffer) ||
                level.data.byteOffset !== 0 ||
                level.data.buffer.byteLength !== size
            )
                throw new TypeError(
                    'Decoder must return tightly packed, independently owned mip buffers.'
                );
        }
    }
    private async upload(entry: Entry, decoded: DecodedAssetTexture): Promise<void> {
        const previous = entry.resident,
            size = bytes(decoded),
            epoch = this.#epoch;
        entry.decoded = null;
        entry.uploading = true;
        entry.state = 'uploading';
        entry.stall = 'none';
        this.#uploadingBytes += size;
        try {
            apply(entry.texture, decoded);
            await this.renderer.uploadTextures([entry.texture]);
            if (this.#destroyed) return;
            if (epoch !== this.#epoch) {
                entry.resident = null;
                entry.decoded = decoded;
                entry.texture.destroy();
                placeholder(entry.texture);
                entry.state = 'decoded';
                return;
            }
            entry.resident = decoded;
            entry.state = 'resident';
            this.resolveClaims(entry);
        } catch (reason) {
            if (this.#destroyed) return;
            if (epoch !== this.#epoch) {
                entry.resident = null;
                entry.decoded = decoded;
                entry.texture.destroy();
                placeholder(entry.texture);
                entry.state = 'decoded';
            } else {
                if (previous) apply(entry.texture, previous);
                else placeholder(entry.texture);
                this.fail(entry, reason);
            }
        } finally {
            this.#uploadingBytes -= size;
            entry.uploading = false;
            if (!this.#destroyed && entry.claims.size === 0) this.retire(entry, true);
        }
    }
    private retire(entry: Entry, remove: boolean): void {
        this.cancelJob(entry);
        const size = entry.resident ? bytes(entry.resident) : 4;
        entry.texture.destroy();
        placeholder(entry.texture);
        entry.resident = null;
        entry.decoded = null;
        entry.state = 'evicted';
        if (remove) this.#entries.delete(entry.key);
        else {
            this.#evictions++;
            entry.stall = 'hidden';
        }
        this.#retiringBytes += size;
        void this.renderer
            .waitForIdle()
            .catch(() => {
                /* Failure is retained by the owning waiter/diagnostics. */
            })
            .finally(() => {
                this.#retiringBytes -= size;
                this.schedule();
            });
    }
    private evictHidden(): void {
        const candidate = [...this.#entries.values()]
            .filter(entry => !target(entry).visible && entry.resident && !entry.uploading)
            .sort((a, b) => a.used - b.used)[0];
        if (candidate) this.retire(candidate, false);
    }
    private fail(entry: Entry, reason: unknown): void {
        entry.error = reason instanceof Error ? reason : new Error(String(reason));
        entry.state = 'failed';
        for (const claim of entry.claims) claim.waiter.reject(entry.error);
    }
    private schedule(): void {
        if (
            !this.#auto ||
            this.#destroyed ||
            this.#recovering ||
            this.#scheduled !== null ||
            this.#updating
        )
            return;
        const work = [...this.#entries.values()].some(
            entry =>
                target(entry).visible &&
                !entry.error &&
                !entry.job &&
                (entry.decoded !== null || entry.resident?.mipLevel !== target(entry).mip)
        );
        if (!work) return;
        this.#scheduled = requestAnimationFrame(() => {
            this.#scheduled = null;
            void this.update().catch((error: unknown) => {
                for (const entry of this.#entries.values()) this.fail(entry, error);
            });
        });
    }
    private isSuspended(): boolean {
        return this.#destroyed || this.#recovering;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('AssetManager is destroyed.');
    }
}
