import type { RHICapabilities, RHITextureFormat, RHIViewport } from '../rhi/core';
import {
    MAX_DIRECTIONAL_LIGHTS,
    MAX_DIRECTIONAL_SHADOW_CASCADES,
    MAX_POINT_LIGHTS,
    MAX_SHADOW_ATLAS_SLICES,
    MAX_SPOT_LIGHTS
} from '../ubo/BuiltInUniformBlocks';

export type ShadowAtlasLightKind = 'directional' | 'spot' | 'point';

export interface ShadowAtlasLightRequest<Owner extends object = object> {
    readonly owner: Owner;
    readonly width: number;
    readonly height: number;
    /** Directional requests only. Omitted requests use one compatibility cascade. */
    readonly cascadeCount?: number;
    /** Optional per-slice widths for directional cascades or point faces. */
    readonly sliceWidths?: readonly number[];
    /** Optional per-slice heights for directional cascades or point faces. */
    readonly sliceHeights?: readonly number[];
}

export interface ShadowAtlasRequests<Owner extends object = object> {
    readonly directional: readonly ShadowAtlasLightRequest<Owner>[];
    readonly spot: readonly ShadowAtlasLightRequest<Owner>[];
    readonly point: readonly ShadowAtlasLightRequest<Owner>[];
}

/** Normalized top-left-origin rectangle within the atlas. */
export interface ShadowAtlasUVRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface ShadowAtlasSlice<Owner extends object = object> {
    readonly owner: Owner;
    readonly kind: ShadowAtlasLightKind;
    /** `null` for planar shadows; `0..5` for a point-light cube face. */
    readonly face: number | null;
    /** `0..3` for a directional-light cascade; `null` for spot and point shadows. */
    readonly cascade: number | null;
    /** Stable LightBlock ABI index used by `u_shadowAtlasRects`. */
    readonly sliceIndex: number;
    /** Dense atlas placement index, independent of the sparse ABI index. */
    readonly physicalIndex: number;
    readonly viewport: Readonly<RHIViewport>;
    readonly uvRect: Readonly<ShadowAtlasUVRect>;
}

/**
 * Reusable result whose identity and slice array remain stable across builds. Callers must not
 * retain slice contents after the next `build` invocation.
 */
export interface ShadowAtlasPlan<Owner extends object = object> {
    readonly slices: readonly Readonly<ShadowAtlasSlice<Owner>>[];
    readonly sliceCount: number;
    readonly width: number;
    readonly height: number;
    readonly tileWidth: number;
    readonly tileHeight: number;
    readonly columns: number;
    readonly rows: number;
    /** Number of grid cells allocated by the deterministic square-ish layout. */
    readonly capacity: number;
    readonly format: RHITextureFormat;
}

export interface ShadowAtlasPlannerOptions {
    readonly format?: RHITextureFormat;
    /** May lower, but never exceed, the fixed LightBlock ABI capacity. */
    readonly maxSlices?: number;
}

export interface ShadowAtlasPlannerDiagnostics {
    readonly activeOwnerCount: number;
    readonly activeSliceCount: number;
    /** Number of slice records retained for allocation-free high-water reuse. */
    readonly storageCapacity: number;
}

interface MutableViewport {
    x: number;
    y: number;
    width: number;
    height: number;
    minDepth: number;
    maxDepth: number;
}

interface MutableUVRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface MutableShadowAtlasSlice<Owner extends object> {
    owner: Owner | null;
    kind: ShadowAtlasLightKind;
    face: number | null;
    cascade: number | null;
    sliceIndex: number;
    physicalIndex: number;
    readonly viewport: MutableViewport;
    readonly uvRect: MutableUVRect;
}

interface OwnerPlacement {
    epoch: number;
    kind: ShadowAtlasLightKind;
    sliceIndex: number;
    physicalIndex: number;
    sliceCount: number;
}

interface MutablePlanState {
    sliceCount: number;
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    columns: number;
    rows: number;
    capacity: number;
}

function requirePositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
}

function requireOwner(owner: unknown, kind: ShadowAtlasLightKind, index: number): void {
    if (owner === null || (typeof owner !== 'object' && typeof owner !== 'function')) {
        throw new TypeError(
            `${kind} shadow request ${String(index)} must have a non-null object owner`
        );
    }
}

function isDepthFormat(format: RHITextureFormat): boolean {
    return format.startsWith('depth');
}

/** Validate the portable depth-atlas requirements shared by planning and resource creation. */
export function assertShadowAtlasFormatSupported(
    capabilities: RHICapabilities,
    format: RHITextureFormat
): void {
    if (!isDepthFormat(format)) {
        throw new TypeError(`Shadow atlas format ${format} must be a depth format`);
    }
    const formatCapabilities = capabilities.getTextureFormatCapabilities(format);
    if (!formatCapabilities.renderable) {
        throw new Error(`Shadow atlas format ${format} is not renderable`);
    }
    if (!formatCapabilities.sampled) {
        throw new Error(`Shadow atlas format ${format} is not sampleable`);
    }
    if (!formatCapabilities.sampleCounts.includes(1)) {
        throw new Error(`Shadow atlas format ${format} does not support sample count 1`);
    }
}

function createMutableSlice<Owner extends object>(): MutableShadowAtlasSlice<Owner> {
    return {
        owner: null,
        kind: 'directional',
        face: null,
        cascade: null,
        sliceIndex: 0,
        physicalIndex: 0,
        viewport: { x: 0, y: 0, width: 0, height: 0, minDepth: 0, maxDepth: 1 },
        uvRect: { x: 0, y: 0, width: 0, height: 0 }
    };
}

function clearMutableSlice<Owner extends object>(slice: MutableShadowAtlasSlice<Owner>): void {
    slice.owner = null;
    slice.face = null;
    slice.cascade = null;
    slice.sliceIndex = 0;
    slice.physicalIndex = 0;
    slice.viewport.x = 0;
    slice.viewport.y = 0;
    slice.viewport.width = 0;
    slice.viewport.height = 0;
    slice.uvRect.x = 0;
    slice.uvRect.y = 0;
    slice.uvRect.width = 0;
    slice.uvRect.height = 0;
}

/** Backend-neutral, allocation-bounded shadow-atlas layout planner. */
export class ShadowAtlasPlanner<Owner extends object = object> {
    readonly format: RHITextureFormat;
    readonly maxSlices: number;
    readonly #activeSlices: MutableShadowAtlasSlice<Owner>[] = [];
    readonly #slicePool: MutableShadowAtlasSlice<Owner>[] = [];
    readonly #owners = new Map<Owner, OwnerPlacement>();
    readonly #ownerPool: OwnerPlacement[] = [];
    readonly #seenOwners = new Set<Owner>();
    readonly #state: MutablePlanState = {
        sliceCount: 0,
        width: 0,
        height: 0,
        tileWidth: 0,
        tileHeight: 0,
        columns: 0,
        rows: 0,
        capacity: 0
    };
    readonly #plan: Readonly<ShadowAtlasPlan<Owner>>;
    #epoch = 0;
    #storageCapacity = 0;
    #destroyed = false;

    constructor(options: ShadowAtlasPlannerOptions = {}) {
        this.format = options.format ?? 'depth24plus';
        this.maxSlices = options.maxSlices ?? MAX_SHADOW_ATLAS_SLICES;
        requirePositiveSafeInteger(this.maxSlices, 'Shadow atlas maxSlices');
        if (this.maxSlices > MAX_SHADOW_ATLAS_SLICES) {
            throw new RangeError(
                `Shadow atlas maxSlices ${String(this.maxSlices)} exceeds the LightBlock ABI capacity ${String(MAX_SHADOW_ATLAS_SLICES)}`
            );
        }
        const state = this.#state;
        const slices = this.#activeSlices as readonly Readonly<ShadowAtlasSlice<Owner>>[];
        const format = this.format;
        this.#plan = Object.freeze({
            slices,
            get sliceCount() {
                return state.sliceCount;
            },
            get width() {
                return state.width;
            },
            get height() {
                return state.height;
            },
            get tileWidth() {
                return state.tileWidth;
            },
            get tileHeight() {
                return state.tileHeight;
            },
            get columns() {
                return state.columns;
            },
            get rows() {
                return state.rows;
            },
            get capacity() {
                return state.capacity;
            },
            format
        });
    }

    build(
        requests: Readonly<ShadowAtlasRequests<Owner>>,
        capabilities: RHICapabilities
    ): Readonly<ShadowAtlasPlan<Owner>> {
        this.assertAlive();
        assertShadowAtlasFormatSupported(capabilities, this.format);
        const maximumDimension = capabilities.limits.maxTextureDimension2D;
        requirePositiveSafeInteger(maximumDimension, 'RHI maxTextureDimension2D');

        const directionalCount = requests.directional.length;
        const spotCount = requests.spot.length;
        const pointCount = requests.point.length;
        if (directionalCount > MAX_DIRECTIONAL_LIGHTS) {
            throw new RangeError(
                `Directional shadow count ${String(directionalCount)} exceeds the LightBlock limit ${String(MAX_DIRECTIONAL_LIGHTS)}`
            );
        }
        if (spotCount > MAX_SPOT_LIGHTS) {
            throw new RangeError(
                `Spot shadow count ${String(spotCount)} exceeds the LightBlock limit ${String(MAX_SPOT_LIGHTS)}`
            );
        }
        if (pointCount > MAX_POINT_LIGHTS) {
            throw new RangeError(
                `Point shadow count ${String(pointCount)} exceeds the LightBlock limit ${String(MAX_POINT_LIGHTS)}`
            );
        }
        const directionalSliceCount = this.directionalSliceCount(requests.directional);
        const sliceCount = directionalSliceCount + spotCount + pointCount * 6;
        if (sliceCount > this.maxSlices) {
            throw new RangeError(
                `Shadow atlas requires ${String(sliceCount)} slices, exceeding maxSlices ${String(this.maxSlices)}`
            );
        }

        let tileWidth = 0;
        let tileHeight = 0;
        this.#seenOwners.clear();
        try {
            tileWidth = this.validateRequests(requests.directional, 'directional', tileWidth);
            tileHeight = this.maximumHeight(requests.directional, tileHeight);
            tileWidth = this.validateRequests(requests.spot, 'spot', tileWidth);
            tileHeight = this.maximumHeight(requests.spot, tileHeight);
            tileWidth = this.validateRequests(requests.point, 'point', tileWidth);
            tileHeight = this.maximumHeight(requests.point, tileHeight);
        } finally {
            this.#seenOwners.clear();
        }

        const columns = sliceCount === 0 ? 0 : Math.ceil(Math.sqrt(sliceCount));
        const rows = sliceCount === 0 ? 0 : Math.ceil(sliceCount / columns);
        const width = columns * tileWidth;
        const height = rows * tileHeight;
        if (width > maximumDimension || height > maximumDimension) {
            throw new RangeError(
                `Shadow atlas ${String(width)}x${String(height)} exceeds maxTextureDimension2D ${String(maximumDimension)}`
            );
        }

        this.advanceEpoch();
        this.resizeActiveSlices(sliceCount);
        let physicalIndex = 0;
        physicalIndex = this.writeRequests(
            requests.directional,
            'directional',
            0,
            MAX_DIRECTIONAL_SHADOW_CASCADES,
            1,
            physicalIndex,
            columns,
            tileWidth,
            tileHeight,
            width,
            height
        );
        physicalIndex = this.writeRequests(
            requests.spot,
            'spot',
            MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES,
            1,
            1,
            physicalIndex,
            columns,
            tileWidth,
            tileHeight,
            width,
            height
        );
        this.writeRequests(
            requests.point,
            'point',
            MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES + MAX_SPOT_LIGHTS,
            6,
            6,
            physicalIndex,
            columns,
            tileWidth,
            tileHeight,
            width,
            height
        );
        this.removeStaleOwners();

        this.#state.sliceCount = sliceCount;
        this.#state.width = width;
        this.#state.height = height;
        this.#state.tileWidth = tileWidth;
        this.#state.tileHeight = tileHeight;
        this.#state.columns = columns;
        this.#state.rows = rows;
        this.#state.capacity = columns * rows;
        return this.#plan;
    }

    hasOwner(owner: Owner): boolean {
        this.assertAlive();
        return this.#owners.has(owner);
    }

    diagnostics(): Readonly<ShadowAtlasPlannerDiagnostics> {
        return Object.freeze({
            activeOwnerCount: this.#owners.size,
            activeSliceCount: this.#activeSlices.length,
            storageCapacity: this.#storageCapacity
        });
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const slice of this.#activeSlices) clearMutableSlice(slice);
        for (const slice of this.#slicePool) clearMutableSlice(slice);
        this.#activeSlices.length = 0;
        this.#slicePool.length = 0;
        this.#owners.clear();
        this.#ownerPool.length = 0;
        this.#seenOwners.clear();
        this.#state.sliceCount = 0;
        this.#state.width = 0;
        this.#state.height = 0;
        this.#state.tileWidth = 0;
        this.#state.tileHeight = 0;
        this.#state.columns = 0;
        this.#state.rows = 0;
        this.#state.capacity = 0;
        this.#storageCapacity = 0;
        this.#destroyed = true;
    }

    private validateRequests(
        requests: readonly ShadowAtlasLightRequest<Owner>[],
        kind: ShadowAtlasLightKind,
        currentMaximumWidth: number
    ): number {
        let maximumWidth = currentMaximumWidth;
        for (let index = 0; index < requests.length; index += 1) {
            const request = requests[index];
            if (request === undefined) {
                throw new TypeError(`${kind} shadow requests must not contain sparse entries`);
            }
            requirePositiveSafeInteger(request.width, `${kind} shadow width`);
            requirePositiveSafeInteger(request.height, `${kind} shadow height`);
            if (kind === 'directional') {
                const count = this.directionalRequestCascadeCount(request);
                this.validateSliceDimensions(request, count, kind);
            } else if (request.cascadeCount !== undefined) {
                throw new TypeError('Only directional shadow requests may specify cascadeCount');
            } else {
                this.validateSliceDimensions(request, kind === 'point' ? 6 : 1, kind);
            }
            requireOwner(request.owner, kind, index);
            if (this.#seenOwners.has(request.owner)) {
                throw new TypeError('A shadow atlas owner may appear only once per plan');
            }
            this.#seenOwners.add(request.owner);
            if (request.width > maximumWidth) maximumWidth = request.width;
        }
        return maximumWidth;
    }

    private maximumHeight(
        requests: readonly ShadowAtlasLightRequest<Owner>[],
        currentMaximum: number
    ): number {
        let maximum = currentMaximum;
        for (const request of requests as readonly (ShadowAtlasLightRequest<Owner> | undefined)[]) {
            if (request === undefined) {
                throw new TypeError('Shadow requests must not contain sparse entries');
            }
            if (request.height > maximum) maximum = request.height;
        }
        return maximum;
    }

    private resizeActiveSlices(sliceCount: number): void {
        while (this.#activeSlices.length > sliceCount) {
            const slice = this.#activeSlices.pop();
            if (slice === undefined) break;
            clearMutableSlice(slice);
            this.#slicePool.push(slice);
        }
        while (this.#activeSlices.length < sliceCount) {
            const slice = this.#slicePool.pop() ?? createMutableSlice<Owner>();
            this.#activeSlices.push(slice);
            if (this.#activeSlices.length > this.#storageCapacity) {
                this.#storageCapacity = this.#activeSlices.length;
            }
        }
    }

    private writeRequests(
        requests: readonly ShadowAtlasLightRequest<Owner>[],
        kind: ShadowAtlasLightKind,
        logicalBase: number,
        logicalStride: number,
        defaultSliceCount: number,
        initialPhysicalIndex: number,
        columns: number,
        tileWidth: number,
        tileHeight: number,
        atlasWidth: number,
        atlasHeight: number
    ): number {
        let physicalIndex = initialPhysicalIndex;
        for (let ownerIndex = 0; ownerIndex < requests.length; ownerIndex += 1) {
            const request = requests[ownerIndex];
            if (request === undefined) {
                throw new TypeError(`${kind} shadow requests must not contain sparse entries`);
            }
            const ownerSliceCount =
                kind === 'directional'
                    ? this.directionalRequestCascadeCount(request)
                    : defaultSliceCount;
            const ownerSliceIndex = logicalBase + ownerIndex * logicalStride;
            this.recordOwner(request.owner, kind, ownerSliceIndex, physicalIndex, ownerSliceCount);
            for (let subIndex = 0; subIndex < ownerSliceCount; subIndex += 1) {
                const slice = this.#activeSlices[physicalIndex];
                if (slice === undefined) {
                    throw new Error('Shadow atlas slice storage is incomplete');
                }
                const column = physicalIndex % columns;
                const row = Math.floor(physicalIndex / columns);
                const x = column * tileWidth;
                const y = row * tileHeight;
                slice.owner = request.owner;
                slice.kind = kind;
                slice.face = kind === 'point' ? subIndex : null;
                slice.cascade = kind === 'directional' ? subIndex : null;
                slice.sliceIndex = ownerSliceIndex + subIndex;
                slice.physicalIndex = physicalIndex;
                slice.viewport.x = x;
                slice.viewport.y = y;
                const sliceWidth = request.sliceWidths?.[subIndex] ?? tileWidth;
                const sliceHeight = request.sliceHeights?.[subIndex] ?? tileHeight;
                slice.viewport.width = sliceWidth;
                slice.viewport.height = sliceHeight;
                slice.viewport.minDepth = 0;
                slice.viewport.maxDepth = 1;
                slice.uvRect.x = x / atlasWidth;
                slice.uvRect.y = y / atlasHeight;
                slice.uvRect.width = sliceWidth / atlasWidth;
                slice.uvRect.height = sliceHeight / atlasHeight;
                physicalIndex++;
            }
        }
        return physicalIndex;
    }

    private directionalSliceCount(requests: readonly ShadowAtlasLightRequest<Owner>[]): number {
        let count = 0;
        for (const request of requests as readonly (ShadowAtlasLightRequest<Owner> | undefined)[]) {
            if (request === undefined) {
                throw new TypeError('directional shadow requests must not contain sparse entries');
            }
            count += this.directionalRequestCascadeCount(request);
        }
        return count;
    }

    private directionalRequestCascadeCount(request: ShadowAtlasLightRequest<Owner>): number {
        const count = request.cascadeCount ?? 1;
        requirePositiveSafeInteger(count, 'Directional shadow cascadeCount');
        if (count > MAX_DIRECTIONAL_SHADOW_CASCADES) {
            throw new RangeError(
                `Directional shadow cascadeCount ${String(count)} exceeds ${String(MAX_DIRECTIONAL_SHADOW_CASCADES)}`
            );
        }
        return count;
    }

    private validateSliceDimensions(
        request: ShadowAtlasLightRequest<Owner>,
        count: number,
        kind: ShadowAtlasLightKind
    ): void {
        for (const [name, values] of [
            ['sliceWidths', request.sliceWidths],
            ['sliceHeights', request.sliceHeights]
        ] as const) {
            if (values === undefined) continue;
            if (values.length !== count) {
                throw new RangeError(
                    `${kind} shadow ${name} must contain exactly ${String(count)} values`
                );
            }
            for (let index = 0; index < values.length; index += 1) {
                const value = values[index];
                requirePositiveSafeInteger(value ?? 0, `${kind} shadow ${name}[${String(index)}]`);
                const maximum = name === 'sliceWidths' ? request.width : request.height;
                if ((value ?? 0) > maximum) {
                    throw new RangeError(`${kind} shadow ${name} cannot exceed its request size`);
                }
            }
        }
    }

    private recordOwner(
        owner: Owner,
        kind: ShadowAtlasLightKind,
        sliceIndex: number,
        physicalIndex: number,
        sliceCount: number
    ): void {
        let placement = this.#owners.get(owner);
        if (placement === undefined) {
            placement = this.#ownerPool.pop() ?? {
                epoch: this.#epoch,
                kind,
                sliceIndex,
                physicalIndex,
                sliceCount
            };
            this.#owners.set(owner, placement);
        }
        placement.epoch = this.#epoch;
        placement.kind = kind;
        placement.sliceIndex = sliceIndex;
        placement.physicalIndex = physicalIndex;
        placement.sliceCount = sliceCount;
    }

    private removeStaleOwners(): void {
        for (const [owner, placement] of this.#owners) {
            if (placement.epoch === this.#epoch) continue;
            this.#owners.delete(owner);
            placement.epoch = 0;
            placement.sliceIndex = 0;
            placement.physicalIndex = 0;
            placement.sliceCount = 0;
            this.#ownerPool.push(placement);
        }
    }

    private advanceEpoch(): void {
        if (this.#epoch === Number.MAX_SAFE_INTEGER) {
            for (const placement of this.#owners.values()) placement.epoch = 0;
            this.#epoch = 1;
            return;
        }
        this.#epoch++;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Shadow atlas planner is destroyed');
    }
}
