import {
    decodeMeshletGeometryPage,
    type MeshletGeometry,
    type MeshletPageDescriptor
} from 'hilo3d';
import type {
    GeometryAssetSource,
    GeometryPageBudgets,
    GeometryPageDemand,
    GeometryPageDiagnostics,
    GeometryPageLease,
    GeometryPageManagerOptions,
    GeometryStreamingDiagnostics
} from './GeometryPageTypes.js';

const MiB = 1024 * 1024;
const ownedGeometries = new WeakSet<MeshletGeometry>();
const defaults: Required<GeometryPageBudgets> = {
    concurrentRequests: 2,
    queuedPages: 128,
    sourceBytes: 16 * MiB,
    cpuBytes: 128 * MiB,
    inFlightBytes: 64 * MiB,
    decodesPerUpdate: 2,
    decodeBytesPerUpdate: 8 * MiB
};

interface Waiter {
    readonly promise: Promise<void>;
    resolve(): void;
    reject(reason: unknown): void;
}
interface Claim {
    demand: Required<GeometryPageDemand>;
    waiter: Waiter;
    released: boolean;
    detach(): void;
}
interface PageSource {
    readonly descriptor: MeshletPageDescriptor;
    readonly url: string;
    readonly basePageId: number;
}
interface Entry {
    readonly source: PageSource;
    readonly claims: Set<Claim>;
    readonly order: number;
    used: number;
    generation: number;
    job: AbortController | null;
    pending: Uint8Array<ArrayBuffer> | null;
    pendingReservation: number;
    available: boolean;
    error: Error | null;
    state: GeometryPageDiagnostics['state'];
    stall: GeometryPageDiagnostics['stall'];
}
interface Target {
    visible: boolean;
    priority: number;
    references: number;
    coarseFallback: boolean;
}

function aborted(): DOMException {
    return new DOMException('Geometry page request cancelled or superseded.', 'AbortError');
}
function createWaiter(): Waiter {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    void promise.catch(() => {
        /* Failure remains observable through the lease and manager diagnostics. */
    });
    return { promise, resolve, reject };
}
function normalizeDemand(value: Readonly<GeometryPageDemand>): Required<GeometryPageDemand> {
    const priority = value.priority ?? 0;
    const visible = value.visible ?? true;
    if (!Number.isFinite(priority) || typeof visible !== 'boolean')
        throw new TypeError('Invalid geometry page demand.');
    return { priority, visible };
}

/**
 * Bounded CPU page streaming for one stable MeshletGeometry. Visible fine-page claims also pin
 * their coarsest group LOD. Availability means decoded CPU data, never GPU residency or a fence.
 * The manager exclusively owns page installation/eviction; do not mutate its geometry's pages.
 */
export class GeometryPageManager {
    readonly #sources = new Map<number, PageSource>();
    readonly #entries = new Map<number, Entry>();
    readonly #budgets: Readonly<Required<GeometryPageBudgets>>;
    readonly #fetch: typeof fetch;
    readonly #auto: boolean;
    readonly #timeout: number;
    readonly #id: string;
    readonly #version: string;
    #clock = 0;
    #active = 0;
    #inFlight = 0;
    #reservedCPU = 0;
    #lastDecodedBytes = 0;
    #evictions = 0;
    #cancellations = 0;
    #destroyed = false;
    #scheduled: number | null = null;

    constructor(
        readonly geometry: MeshletGeometry,
        source: Readonly<GeometryAssetSource>,
        options: Readonly<GeometryPageManagerOptions> = {}
    ) {
        if (![source.id, source.version].every(value => typeof value === 'string' && value.trim()))
            throw new TypeError('Geometry asset id and content version must be non-empty.');
        const budgets = { ...defaults, ...options.budgets };
        for (const [name, value] of Object.entries(budgets))
            if (!Number.isSafeInteger(value) || value < 1)
                throw new RangeError(`Geometry budget ${name} must be a positive safe integer.`);
        if (budgets.concurrentRequests > 16)
            throw new RangeError('Geometry request concurrency cannot exceed sixteen.');
        this.#budgets = Object.freeze(budgets);
        this.#id = source.id;
        this.#version = source.version;
        this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.#auto = options.autoUpdate ?? true;
        this.#timeout = options.requestTimeoutMilliseconds ?? 30000;
        if (!Number.isFinite(this.#timeout) || this.#timeout <= 0)
            throw new RangeError('Geometry request deadline must be positive and finite.');
        const baseURL =
            options.baseURL ??
            (typeof document === 'undefined' ? 'http://localhost/' : document.baseURI);
        const basePages = new Map<number, number>();
        for (const group of geometry.manifest.groups) {
            const base = group.lods.at(-1);
            if (!base) throw new TypeError('Geometry groups require a coarse LOD.');
            for (const lod of group.lods) basePages.set(lod.pageId, base.pageId);
        }
        if (source.pages.length !== geometry.manifest.pages.length)
            throw new RangeError('Geometry source must declare every manifest page exactly once.');
        const descriptors = new Map(geometry.manifest.pages.map(page => [page.id, page]));
        for (const page of source.pages) {
            const descriptor = descriptors.get(page.pageId);
            const basePageId = basePages.get(page.pageId);
            if (!descriptor || basePageId === undefined || this.#sources.has(page.pageId))
                throw new RangeError('Geometry source contains a duplicate or unknown page.');
            if (typeof page.url !== 'string' || !page.url.trim())
                throw new TypeError('Geometry page URL must be non-empty.');
            const url = new URL(page.url, baseURL);
            if (!['https:', 'http:', 'blob:'].includes(url.protocol))
                throw new TypeError('Geometry page URL must use HTTP(S) or blob.');
            if (url.protocol !== 'blob:')
                url.searchParams.set('hilo_asset_version', source.version);
            if (geometry.hasPage(page.pageId))
                throw new Error(
                    'Geometry page manager requires exclusive ownership of initially empty pages.'
                );
            this.#sources.set(page.pageId, { descriptor, basePageId, url: url.href });
        }
        if (ownedGeometries.has(geometry))
            throw new Error('Geometry already has an exclusive page manager.');
        ownedGeometries.add(geometry);
    }

    /** Acquire a CPU page and its coarse fallback, sharing work with other claims. */
    acquirePage(
        pageId: number,
        initial: Readonly<GeometryPageDemand> = {},
        signal?: AbortSignal
    ): GeometryPageLease {
        this.assertAlive();
        signal?.throwIfAborted();
        const source = this.source(pageId);
        const requested = normalizeDemand(initial);
        this.validateWorkingSet(source);
        this.ensureEntries(source, requested.visible);
        const entry = this.entry(pageId);
        const claim: Claim = {
            demand: requested,
            waiter: createWaiter(),
            released: false,
            detach(): void {
                /* No abort listener installed. */
            }
        };
        entry.claims.add(claim);
        const replace = (next: Readonly<GeometryPageDemand>, retry: boolean): Promise<void> => {
            this.assertAlive();
            if (claim.released) throw new Error('Geometry page lease is released.');
            const demand = normalizeDemand(next);
            if (
                !retry &&
                demand.priority === claim.demand.priority &&
                demand.visible === claim.demand.visible
            )
                return claim.waiter.promise;
            this.ensureEntries(source, demand.visible);
            claim.waiter.reject(aborted());
            claim.waiter = createWaiter();
            claim.demand = demand;
            entry.used = ++this.#clock;
            if (retry || demand.visible) {
                entry.error = null;
                const base = this.#entries.get(source.basePageId);
                if (base) base.error = null;
            }
            this.reconcile();
            return claim.waiter.promise;
        };
        const release = (): void => {
            if (claim.released) return;
            claim.released = true;
            claim.detach();
            claim.waiter.reject(aborted());
            entry.claims.delete(claim);
            if (!this.#destroyed) this.reconcile();
        };
        if (signal) {
            signal.addEventListener('abort', release, { once: true });
            claim.detach = () => {
                signal.removeEventListener('abort', release);
            };
        }
        this.reconcile();
        return Object.freeze({
            geometry: this.geometry,
            pageId,
            ready: claim.waiter.promise,
            setDemand: (demand: Readonly<GeometryPageDemand>) => replace(demand, false),
            retry: () => replace(claim.demand, true),
            release
        });
    }

    /** Decode bounded completed responses, then admit HTTP work; HTTP completion is asynchronous. */
    update(): void {
        this.assertAlive();
        this.#lastDecodedBytes = 0;
        let decoded = 0;
        const targets = this.targets();
        const entries = [...this.#entries.values()].sort((left, right) => {
            const a = targets.get(left.source.descriptor.id);
            const b = targets.get(right.source.descriptor.id);
            return (
                Number(b?.coarseFallback) - Number(a?.coarseFallback) ||
                (b?.priority ?? -Infinity) - (a?.priority ?? -Infinity) ||
                left.order - right.order
            );
        });
        for (const entry of entries) {
            if (!targets.get(entry.source.descriptor.id)?.visible || entry.error || entry.available)
                continue;
            entry.stall = 'none';
            const size = entry.source.descriptor.byteLength;
            if (entry.pending) {
                if (
                    decoded >= this.#budgets.decodesPerUpdate ||
                    this.#lastDecodedBytes + size > this.#budgets.decodeBytesPerUpdate
                ) {
                    entry.stall = 'decode-budget';
                    continue;
                }
                // Admission retains wire + decoded + defensive-copy capacity through this phase.
                decoded++;
                this.#lastDecodedBytes += size;
                try {
                    const page = decodeMeshletGeometryPage(entry.pending, entry.source.descriptor);
                    this.geometry.setPageData(entry.source.descriptor.id, page);
                    this.releasePending(entry);
                    entry.available = true;
                    entry.state = 'available';
                    entry.used = ++this.#clock;
                    this.resolveClaims();
                } catch (error) {
                    this.fail(entry, error);
                }
                continue;
            }
            if (entry.job || this.#active >= this.#budgets.concurrentRequests) continue;
            if (this.#inFlight + size * 2 > this.#budgets.inFlightBytes) {
                entry.stall = 'in-flight-budget';
                continue;
            }
            if (!this.makeRoom(size * 3, targets)) {
                entry.stall = 'cpu-budget';
                continue;
            }
            this.startJob(entry);
        }
        this.schedule();
    }

    /** Snapshot CPU/network accounting. GPU residency remains renderer diagnostics. */
    getDiagnostics(): Readonly<GeometryStreamingDiagnostics> {
        const targets = this.targets();
        return Object.freeze({
            id: this.#id,
            version: this.#version,
            pages: Object.freeze(
                [...this.#entries.values()].map(entry => {
                    const target = targets.get(entry.source.descriptor.id);
                    return Object.freeze({
                        pageId: entry.source.descriptor.id,
                        state: entry.state,
                        references: target?.references ?? 0,
                        visible: target?.visible ?? false,
                        coarseFallback: target?.coarseFallback ?? false,
                        cpuBytes: this.entryBytes(entry),
                        stall: entry.stall,
                        error: entry.error?.message ?? null
                    });
                })
            ),
            cpuBytes: this.cpuBytes(),
            inFlightBytes: this.#inFlight,
            activeRequests: this.#active,
            decodedBytesLastUpdate: this.#lastDecodedBytes,
            evictions: this.#evictions,
            cancellations: this.#cancellations
        });
    }

    /** Cancel work and evict this owner's CPU pages. The stable geometry itself is not destroyed. */
    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        if (this.#scheduled !== null) cancelAnimationFrame(this.#scheduled);
        for (const entry of this.#entries.values()) {
            this.cancelJob(entry);
            for (const claim of entry.claims) {
                claim.released = true;
                claim.detach();
                claim.waiter.reject(aborted());
            }
            if (entry.available) this.geometry.evictPage(entry.source.descriptor.id);
            this.releasePending(entry);
        }
        this.#entries.clear();
        ownedGeometries.delete(this.geometry);
    }

    private source(pageId: number): PageSource {
        const source = this.#sources.get(pageId);
        if (!source) throw new RangeError('Unknown geometry page id.');
        return source;
    }
    private entry(pageId: number): Entry {
        const entry = this.#entries.get(pageId);
        if (!entry) throw new Error('Geometry page has no live entry.');
        return entry;
    }
    private validateWorkingSet(source: PageSource): void {
        const base = this.source(source.basePageId);
        const pages = base === source ? [source] : [base, source];
        const sizes = pages.map(page => page.descriptor.byteLength);
        for (const size of sizes) {
            if (size > this.#budgets.sourceBytes || size > this.#budgets.decodeBytesPerUpdate)
                throw new RangeError('Geometry page exceeds an atomic source/decode budget.');
            if (size * 2 > this.#budgets.inFlightBytes)
                throw new RangeError('Geometry page exceeds the in-flight byte budget.');
        }
        if (
            sizes.reduce((sum, size) => sum + size, 0) + Math.max(...sizes) * 2 >
            this.#budgets.cpuBytes
        )
            throw new RangeError(
                'Geometry page and coarse fallback exceed the CPU working-set budget.'
            );
    }
    private ensureEntries(source: PageSource, visible: boolean): void {
        const ids = new Set([source.descriptor.id]);
        if (visible) ids.add(source.basePageId);
        const missing = [...ids].filter(id => !this.#entries.has(id));
        if (this.#entries.size + missing.length > this.#budgets.queuedPages)
            throw new RangeError('Geometry page queue capacity exceeded.');
        for (const id of missing)
            this.#entries.set(id, {
                source: this.source(id),
                claims: new Set(),
                order: ++this.#clock,
                used: this.#clock,
                generation: 0,
                job: null,
                pending: null,
                pendingReservation: 0,
                available: false,
                error: null,
                state: 'queued',
                stall: 'none'
            });
    }
    private targets(): Map<number, Target> {
        const targets = new Map<number, Target>();
        for (const entry of this.#entries.values())
            targets.set(entry.source.descriptor.id, {
                visible: false,
                priority: -Infinity,
                references: entry.claims.size,
                coarseFallback: false
            });
        for (const entry of this.#entries.values())
            for (const claim of entry.claims) {
                if (!claim.demand.visible) continue;
                const page = targets.get(entry.source.descriptor.id);
                if (page) {
                    page.visible = true;
                    page.priority = Math.max(page.priority, claim.demand.priority);
                }
                const base = targets.get(entry.source.basePageId);
                if (base) {
                    base.visible = true;
                    base.coarseFallback = true;
                    base.priority = Math.max(base.priority, claim.demand.priority);
                    if (base !== page) base.references++;
                }
            }
        return targets;
    }
    private reconcile(): void {
        const targets = this.targets();
        for (const [id, entry] of this.#entries) {
            const target = targets.get(id);
            if (!target?.visible) {
                this.cancelJob(entry);
                this.releasePending(entry);
                entry.stall = 'hidden';
                if (!entry.available && !entry.error) entry.state = 'queued';
                if (!target?.references) {
                    this.evict(entry, false);
                    this.#entries.delete(id);
                }
            } else if (!entry.error) {
                entry.stall = 'none';
                if (!entry.available && !entry.pending && !entry.job) entry.state = 'queued';
            }
        }
        this.resolveClaims();
        this.schedule();
    }
    private resolveClaims(): void {
        for (const entry of this.#entries.values()) {
            const base = this.#entries.get(entry.source.basePageId);
            for (const claim of entry.claims) {
                if (!claim.demand.visible) continue;
                const error = entry.error ?? base?.error;
                if (error) claim.waiter.reject(error);
                else if (entry.available && base?.available) claim.waiter.resolve();
            }
        }
    }
    private entryBytes(entry: Entry): number {
        return (
            (entry.available ? entry.source.descriptor.byteLength : 0) +
            (entry.pending?.byteLength ?? 0)
        );
    }
    private cpuBytes(): number {
        let size = this.#reservedCPU;
        for (const entry of this.#entries.values())
            if (entry.available) size += entry.source.descriptor.byteLength;
        return size;
    }
    private makeRoom(additional: number, targets: ReadonlyMap<number, Target>): boolean {
        const hidden = [...this.#entries.values()]
            .filter(entry => entry.available && !targets.get(entry.source.descriptor.id)?.visible)
            .sort((a, b) => a.used - b.used);
        while (this.cpuBytes() + additional > this.#budgets.cpuBytes) {
            const entry = hidden.shift();
            if (!entry) return false;
            this.evict(entry, true);
        }
        return true;
    }
    private evict(entry: Entry, pressure: boolean): void {
        if (entry.available) {
            this.geometry.evictPage(entry.source.descriptor.id);
            if (pressure) this.#evictions++;
        }
        entry.available = false;
        this.releasePending(entry);
        entry.state = 'evicted';
        entry.stall = 'hidden';
    }
    private cancelJob(entry: Entry): void {
        entry.generation++;
        if (!entry.job) return;
        this.#cancellations++;
        entry.job.abort();
        entry.job = null;
    }
    private releasePending(entry: Entry): void {
        entry.pending = null;
        this.#reservedCPU -= entry.pendingReservation;
        entry.pendingReservation = 0;
    }
    private startJob(entry: Entry): void {
        const controller = new AbortController();
        const generation = entry.generation;
        entry.job = controller;
        entry.state = 'loading';
        this.#active++;
        const networkReservation = entry.source.descriptor.byteLength * 2;
        const cpuReservation = entry.source.descriptor.byteLength * 3;
        this.#inFlight += networkReservation;
        this.#reservedCPU += cpuReservation;
        let transferred = false;
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new DOMException('Geometry request timed out.', 'TimeoutError'));
        }, this.#timeout);
        void this.readPage(entry.source, controller.signal)
            .then(data => {
                controller.signal.throwIfAborted();
                if (this.#destroyed || generation !== entry.generation) return;
                entry.pending = data;
                entry.pendingReservation = cpuReservation;
                transferred = true;
                entry.state = 'fetched';
            })
            .catch((reason: unknown) => {
                if (
                    !this.#destroyed &&
                    generation === entry.generation &&
                    (!controller.signal.aborted || timedOut)
                )
                    this.fail(
                        entry,
                        timedOut
                            ? new DOMException('Geometry request timed out.', 'TimeoutError')
                            : reason
                    );
            })
            .finally(() => {
                clearTimeout(timer);
                this.#active--;
                this.#inFlight -= networkReservation;
                if (!transferred) this.#reservedCPU -= cpuReservation;
                if (entry.job === controller) entry.job = null;
                this.schedule();
            });
    }
    private async readPage(
        source: PageSource,
        signal: AbortSignal
    ): Promise<Uint8Array<ArrayBuffer>> {
        const response = await this.#fetch(source.url, { signal });
        if (!response.body)
            throw new Error('Geometry transport must expose a readable response body.');
        const reader = response.body.getReader();
        const cancelRead = (): void => {
            void reader.cancel(signal.reason).catch(() => {
                /* The owning job observes cancellation. */
            });
        };
        signal.addEventListener('abort', cancelRead, { once: true });
        try {
            signal.throwIfAborted();
            if (!response.ok)
                throw new Error(`Geometry fetch failed (${String(response.status)}).`);
            const contentLength = response.headers.get('content-length');
            const contentEncoding = response.headers.get('content-encoding');
            if (
                contentLength !== null &&
                (contentEncoding === 'identity' ||
                    (!contentEncoding && response.type !== 'cors')) &&
                (!/^\d+$/.test(contentLength) ||
                    Number(contentLength) !== source.descriptor.byteLength)
            )
                throw new RangeError(
                    'Geometry Content-Length differs from its declared byte length.'
                );
            const output = new Uint8Array(source.descriptor.byteLength);
            let offset = 0;
            for (;;) {
                signal.throwIfAborted();
                const next = await reader.read();
                signal.throwIfAborted();
                if (next.done) break;
                if (offset + next.value.byteLength > output.byteLength)
                    throw new RangeError('Geometry response exceeds its declared byte length.');
                output.set(next.value, offset);
                offset += next.value.byteLength;
            }
            if (offset !== output.byteLength)
                throw new RangeError('Geometry response is shorter than its declared byte length.');
            return output;
        } finally {
            signal.removeEventListener('abort', cancelRead);
            await reader.cancel().catch(() => {
                /* The original read failure remains observable. */
            });
            reader.releaseLock();
        }
    }
    private fail(entry: Entry, reason: unknown): void {
        entry.error = reason instanceof Error ? reason : new Error(String(reason));
        this.releasePending(entry);
        entry.state = 'failed';
        this.resolveClaims();
    }
    private schedule(): void {
        if (!this.#auto || this.#destroyed || this.#scheduled !== null) return;
        const targets = this.targets();
        if (
            ![...this.#entries.values()].some(
                entry =>
                    targets.get(entry.source.descriptor.id)?.visible &&
                    !entry.error &&
                    !entry.available &&
                    !entry.job
            )
        )
            return;
        this.#scheduled = requestAnimationFrame(() => {
            this.#scheduled = null;
            this.update();
        });
    }
    private assertAlive(): void {
        if (this.#destroyed) throw new Error('GeometryPageManager is destroyed.');
    }
}
