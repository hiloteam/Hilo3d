import Geometry from '../../src/geometry/Geometry';
import GeometryData from '../../src/geometry/GeometryData';

type Triple = readonly [number, number, number];

interface FaceBasis {
    readonly normal: Triple;
    readonly horizontal: Triple;
    readonly vertical: Triple;
}

/** A centered unit box with smooth, 0.12-radius edges for the Lumen toy fixtures. */
export function createLumenRoundedBox(): Geometry {
    const radius = 0.12;
    const innerExtent = 0.5 - radius;
    const bevelSegments = 5;
    const coordinates: number[] = [];
    // Equal angular steps concentrate vertices on the bevel, leaving broad faces flat.
    for (let step = bevelSegments; step >= 0; step--) {
        coordinates.push(-innerExtent - radius * Math.tan((step / bevelSegments) * Math.PI * 0.25));
    }
    coordinates.push(0);
    for (let step = 0; step <= bevelSegments; step++) {
        coordinates.push(innerExtent + radius * Math.tan((step / bevelSegments) * Math.PI * 0.25));
    }
    // Each horizontal × vertical basis points outward, matching the triangle winding below.
    const faces: readonly FaceBasis[] = [
        { normal: [1, 0, 0], horizontal: [0, 0, -1], vertical: [0, 1, 0] },
        { normal: [-1, 0, 0], horizontal: [0, 0, 1], vertical: [0, 1, 0] },
        { normal: [0, 1, 0], horizontal: [1, 0, 0], vertical: [0, 0, -1] },
        { normal: [0, -1, 0], horizontal: [1, 0, 0], vertical: [0, 0, 1] },
        { normal: [0, 0, 1], horizontal: [1, 0, 0], vertical: [0, 1, 0] },
        { normal: [0, 0, -1], horizontal: [-1, 0, 0], vertical: [0, 1, 0] }
    ];
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const stride = coordinates.length;
    for (const { normal, horizontal, vertical } of faces) {
        const firstVertex = positions.length / 3;
        for (const [row, v] of coordinates.entries()) {
            for (const [column, u] of coordinates.entries()) {
                const x = normal[0] * 0.5 + horizontal[0] * u + vertical[0] * v;
                const y = normal[1] * 0.5 + horizontal[1] * u + vertical[1] * v;
                const z = normal[2] * 0.5 + horizontal[2] * u + vertical[2] * v;
                const centerX = Math.max(-innerExtent, Math.min(innerExtent, x));
                const centerY = Math.max(-innerExtent, Math.min(innerExtent, y));
                const centerZ = Math.max(-innerExtent, Math.min(innerExtent, z));
                const dx = x - centerX;
                const dy = y - centerY;
                const dz = z - centerZ;
                const length = Math.hypot(dx, dy, dz);
                const nx = dx / length;
                const ny = dy / length;
                const nz = dz / length;
                positions.push(centerX + radius * nx, centerY + radius * ny, centerZ + radius * nz);
                normals.push(nx, ny, nz);
                if (row < stride - 1 && column < stride - 1) {
                    const a = firstVertex + row * stride + column;
                    const b = a + stride;
                    indices.push(a, a + 1, b, a + 1, b + 1, b);
                }
            }
        }
    }
    return new Geometry({
        vertices: new GeometryData(new Float32Array(positions), 3),
        normals: new GeometryData(new Float32Array(normals), 3),
        indices: new GeometryData(new Uint16Array(indices), 1)
    });
}
