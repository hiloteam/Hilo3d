/** Original procedural fixture, authored for Hilo3D under the repository MIT license. */
export interface MeshletFixtureSource {
    readonly positions: Float32Array;
    readonly normals: Float32Array;
    readonly uv0: Float32Array;
    readonly indices: Uint32Array;
}

/** Deterministic 24x24 curved XY surface, +Z winding, analytic normals and asymmetric UVs. */
export function createMeshletFixtureSource(segments = 24): MeshletFixtureSource {
    if (!Number.isInteger(segments) || segments < 2 || segments > 128)
        throw new RangeError('fixture segments must be between 2 and 128');
    const positions: number[] = [],
        normals: number[] = [],
        uv0: number[] = [],
        indices: number[] = [];
    for (let row = 0; row <= segments; row++) {
        for (let column = 0; column <= segments; column++) {
            const u = column / segments,
                v = row / segments;
            const x = u * 8 - 4,
                y = v * 6 - 3;
            const z = 0.6 * Math.sin(x * 0.8) * Math.cos(y * 0.7) + 0.12 * x;
            const dx = 0.48 * Math.cos(x * 0.8) * Math.cos(y * 0.7) + 0.12;
            const dy = -0.42 * Math.sin(x * 0.8) * Math.sin(y * 0.7);
            const length = Math.hypot(dx, dy, 1);
            positions.push(x, y, z);
            normals.push(-dx / length, -dy / length, 1 / length);
            uv0.push(u, 1 - v);
        }
    }
    for (let row = 0; row < segments; row++) {
        for (let column = 0; column < segments; column++) {
            const a = row * (segments + 1) + column;
            indices.push(a, a + 1, a + segments + 1, a + 1, a + segments + 2, a + segments + 1);
        }
    }
    return {
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uv0: new Float32Array(uv0),
        indices: new Uint32Array(indices)
    };
}
