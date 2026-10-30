import {
    snapshotMeshletAssetManifest,
    validateMeshletGeometryPage,
    type MeshletAssetManifest,
    type MeshletGeometryPage
} from './MeshletAsset';

/** Fixed renderer-local geometry residency and visibility budgets. */
export interface MeshletGeometryOptions {
    /** Bytes reserved for the packed geometry arena, including its page table. Defaults to 16 MiB. */
    readonly maxResidentBytes?: number;
    /** Maximum newly uploaded geometry bytes per submitted frame. Defaults to 4 MiB. */
    readonly maxUploadBytesPerFrame?: number;
    /** Maximum visible clusters across all instances of this bucket. Defaults to 65,536. */
    readonly maxVisibleMeshlets?: number;
    /** Maximum projected simplification error in physical pixels. Defaults to 1. */
    readonly maximumProjectedError?: number;
}

/** Validated, immutable limits shared by each renderer-local residency owner. */
export interface MeshletGeometryLimits {
    readonly maxResidentBytes: number;
    readonly maxUploadBytesPerFrame: number;
    readonly maxVisibleMeshlets: number;
    readonly maximumProjectedError: number;
}

function positiveInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 0x7fff_ffff) {
        throw new RangeError(`${label} must be a positive signed 32-bit integer`);
    }
    return value;
}

/**
 * Versioned rigid geometry pages consumed by a Clustered Forward+ GPU Scene bucket.
 *
 * Page availability describes validated CPU bytes. Renderer-local GPU residency, uploads and
 * page-table publication follow the enclosing frame's submission transaction.
 */
export default class MeshletGeometry {
    readonly manifest: Readonly<MeshletAssetManifest>;
    readonly options: Readonly<MeshletGeometryLimits>;
    readonly #pages = new Map<number, Readonly<MeshletGeometryPage>>();
    #revision = 0;

    constructor(manifest: MeshletAssetManifest, options: Readonly<MeshletGeometryOptions> = {}) {
        this.manifest = snapshotMeshletAssetManifest(manifest);
        const maxResidentBytes = positiveInteger(
            options.maxResidentBytes ?? 16 * 1024 * 1024,
            'maxResidentBytes'
        );
        const maxUploadBytesPerFrame = positiveInteger(
            options.maxUploadBytesPerFrame ?? 4 * 1024 * 1024,
            'maxUploadBytesPerFrame'
        );
        const maxVisibleMeshlets = positiveInteger(
            options.maxVisibleMeshlets ?? 65_536,
            'maxVisibleMeshlets'
        );
        const maximumProjectedError = options.maximumProjectedError ?? 1;
        if (!Number.isFinite(maximumProjectedError) || maximumProjectedError < 0) {
            throw new RangeError('maximumProjectedError must be finite and nonnegative');
        }
        if (maxResidentBytes % 4 !== 0 || maxUploadBytesPerFrame % 4 !== 0) {
            throw new RangeError('Meshlet byte budgets must be four-byte aligned');
        }
        this.options = Object.freeze({
            maxResidentBytes,
            maxUploadBytesPerFrame,
            maxVisibleMeshlets,
            maximumProjectedError
        });
    }

    /** Monotonic CPU page-set revision; unrelated to a GPU submission fence. */
    get revision(): number {
        return this.#revision;
    }

    /** Whether a validated CPU copy of this page is available. */
    hasPage(pageId: number): boolean {
        return this.#pages.has(pageId);
    }

    /** Validate and retain a private copy. The caller may release or modify its input afterwards. */
    setPageData(pageId: number, page: MeshletGeometryPage): void {
        const descriptor = this.manifest.pages.find(candidate => candidate.id === pageId);
        if (descriptor === undefined)
            throw new RangeError(`Unknown meshlet page ${String(pageId)}`);
        validateMeshletGeometryPage(page, descriptor);
        const group = this.manifest.groups.find(candidate =>
            candidate.lods.some(lod => lod.pageId === pageId)
        );
        if (group === undefined) throw new RangeError('Meshlet page has no group');
        const [x, y, z, radius] = group.bounds;
        for (let index = 0; index < page.vertices.length; index += 8) {
            if (
                Math.hypot(
                    (page.vertices[index] ?? 0) - x,
                    (page.vertices[index + 1] ?? 0) - y,
                    (page.vertices[index + 2] ?? 0) - z
                ) > radius
            ) {
                throw new RangeError('Meshlet page vertices exceed their group bounds');
            }
        }
        const retained: Readonly<MeshletGeometryPage> = Object.freeze({
            vertices: page.vertices.slice(),
            indices: page.indices.slice(),
            meshlets: Object.freeze(
                page.meshlets.map(meshlet =>
                    Object.freeze({
                        ...meshlet,
                        bounds: Object.freeze([
                            meshlet.bounds[0],
                            meshlet.bounds[1],
                            meshlet.bounds[2],
                            meshlet.bounds[3]
                        ] as const),
                        coneApex: Object.freeze([
                            meshlet.coneApex[0],
                            meshlet.coneApex[1],
                            meshlet.coneApex[2]
                        ] as const),
                        coneAxis: Object.freeze([
                            meshlet.coneAxis[0],
                            meshlet.coneAxis[1],
                            meshlet.coneAxis[2]
                        ] as const)
                    })
                )
            )
        });
        this.#pages.set(pageId, retained);
        this.#revision++;
    }

    /** Remove the CPU page. Each renderer retires its page mapping on a valid subsequent frame. */
    evictPage(pageId: number): void {
        if (!this.manifest.pages.some(candidate => candidate.id === pageId))
            throw new RangeError(`Unknown meshlet page ${String(pageId)}`);
        if (this.#pages.delete(pageId)) this.#revision++;
    }

    /** @internal Renderer-owned read access; callers must not mutate the returned arrays. */
    getPageData(pageId: number): Readonly<MeshletGeometryPage> | null {
        return this.#pages.get(pageId) ?? null;
    }
}
