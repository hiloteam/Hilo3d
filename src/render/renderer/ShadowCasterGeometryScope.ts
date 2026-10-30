import type Mesh from '../../core/Mesh';

/** @internal Exact identity and conservative local bounds for GPU-owned caster geometry. */
export interface ShadowCasterGeometryOverride {
    readonly xMin: number;
    readonly xMax: number;
    readonly yMin: number;
    readonly yMax: number;
    readonly zMin: number;
    readonly zMax: number;
}

let active: ReadonlyMap<Mesh, Readonly<ShadowCasterGeometryOverride>> | null = null;

/** @internal Synchronous shadow planning scope; the override identity is the content revision. */
export function withShadowCasterGeometry<T>(
    overrides: ReadonlyMap<Mesh, Readonly<ShadowCasterGeometryOverride>>,
    record: () => T
): T {
    const previous = active;
    active = overrides;
    try {
        return record();
    } finally {
        active = previous;
    }
}

/** @internal Read only during shared shadow planning. */
export function shadowCasterGeometry(mesh: Mesh): Readonly<ShadowCasterGeometryOverride> | null {
    return active?.get(mesh) ?? null;
}
