import Geometry from '../../../geometry/Geometry';
import GeometryData from '../../../geometry/GeometryData';
import type MeshletGeometry from '../../../geometry/meshlet/MeshletGeometry';
import type { MeshletGeometryPage } from '../../../geometry/meshlet/MeshletAsset';

/** Renderer-local pages staged for the same submission as the DDGI scene. */
export interface MeshletRayPageSource {
    readonly geometry: MeshletGeometry;
    getResidentPage(pageId: number): Readonly<MeshletGeometryPage> | null;
}

/** CPU extraction costs; includes completed CPU copies from frames later discarded by the GPU. */
export interface MeshletRayGeometryDiagnostics {
    /** Currently retained independent position/normal/UV snapshot bytes, excluding source pages. */
    readonly snapshotBytes: number;
    /** Cumulative bytes copied into successfully constructed CPU snapshots. */
    readonly copiedBytes: number;
    /** Number of completed CPU snapshot rebuilds; unchanged resident pages do not increment it. */
    readonly rebuildCount: number;
    /** Cumulative CPU extraction time, including Geometry construction, in milliseconds. */
    readonly copyTimeMs: number;
}

/**
 * Camera-independent transport geometry from the finest resident complete page of every group.
 * The source pages remain weakly referenced; the retained independent triangle soup uses exactly
 * 96 numeric bytes per triangle and is checked against DDGI's remaining triangle budget first.
 * CPU snapshots may be prepared before submission; RayTracingScene/controller revisions retain
 * their existing separate upload transaction and retry policy.
 */
export class MeshletRayGeometry {
    readonly #candidatePages: (Readonly<MeshletGeometryPage> | null)[];
    #pageReferences: readonly WeakRef<Readonly<MeshletGeometryPage>>[] = [];
    #snapshot: Geometry | null = null;
    #snapshotBytes = 0;
    #copiedBytes = 0;
    #rebuildCount = 0;
    #copyTimeMs = 0;

    readDiagnostics(): Readonly<MeshletRayGeometryDiagnostics> {
        return Object.freeze({
            snapshotBytes: this.#snapshotBytes,
            copiedBytes: this.#copiedBytes,
            rebuildCount: this.#rebuildCount,
            copyTimeMs: this.#copyTimeMs
        });
    }

    constructor(readonly source: MeshletRayPageSource) {
        this.#candidatePages = new Array<Readonly<MeshletGeometryPage> | null>(
            source.geometry.manifest.groups.length
        ).fill(null);
    }

    /** Preserve the entire ordinary fallback until every group has at least one resident page. */
    resolve(fallback: Geometry, remainingTriangles: number): Geometry {
        if (!Number.isSafeInteger(remainingTriangles) || remainingTriangles < 0)
            throw new RangeError(
                'DDGI remaining triangle budget must be a nonnegative safe integer'
            );
        let triangles = 0;
        let unchanged = this.#snapshot !== null;
        try {
            for (const [index, group] of this.source.geometry.manifest.groups.entries()) {
                let selected: Readonly<MeshletGeometryPage> | null = null;
                for (const lod of group.lods) {
                    selected = this.source.getResidentPage(lod.pageId);
                    if (selected !== null) break;
                }
                if (selected === null) {
                    this.clear();
                    return fallback;
                }
                this.#candidatePages[index] = selected;
                triangles += selected.indices.length / 3;
                unchanged &&= this.#pageReferences[index]?.deref() === selected;
            }
            if (!Number.isSafeInteger(triangles) || triangles > remainingTriangles)
                throw new RangeError(
                    'DDGI resident meshlet geometry exceeds the scene triangle budget'
                );
            if (unchanged && this.#snapshot !== null) return this.#snapshot;
            const copyStart = performance.now();
            const vertices = new Float32Array(triangles * 3 * 8);
            let output = 0;
            for (const page of this.#candidatePages) {
                if (page === null)
                    throw new Error('DDGI meshlet page set changed during extraction');
                for (const index of page.indices) {
                    for (let component = 0; component < 8; component++) {
                        const value = page.vertices[index * 8 + component];
                        if (value === undefined)
                            throw new RangeError('DDGI meshlet index exceeds its vertex stream');
                        vertices[output++] = value;
                    }
                }
            }
            const positions = new GeometryData(vertices, 3, { stride: 32 });
            const snapshot = new Geometry({
                vertices: positions,
                normals: new GeometryData(vertices, 3, {
                    stride: 32,
                    offset: 12,
                    bufferViewId: positions.bufferViewId
                }),
                uvs: new GeometryData(vertices, 2, {
                    stride: 32,
                    offset: 24,
                    bufferViewId: positions.bufferViewId
                })
            });
            this.#pageReferences = this.#candidatePages.map(page => {
                if (page === null)
                    throw new Error('DDGI meshlet page set changed during publication');
                return new WeakRef(page);
            });
            this.#snapshot = snapshot;
            this.#snapshotBytes = vertices.byteLength;
            this.#copiedBytes += vertices.byteLength;
            this.#rebuildCount++;
            this.#copyTimeMs += performance.now() - copyStart;
            return snapshot;
        } finally {
            this.#candidatePages.fill(null);
        }
    }

    /** Drop renderer-owned CPU extraction snapshots without mutating the original mesh or pages. */
    clear(): void {
        this.#snapshot = null;
        this.#snapshotBytes = 0;
        if (this.#pageReferences.length !== 0) this.#pageReferences = [];
        this.#candidatePages.fill(null);
    }
}
