import * as Hilo3d from '../../src/Hilo3d';
import { environmentMaterialDefaults } from '../shared/environment';
import type { EnvironmentMaps } from '../shared/init';
import { createCsmToyNight } from './csm-toy-night';
import { createCsmToyWater } from './csm-toy-water';

type Point3 = readonly [number, number, number];
type Point2 = readonly [number, number];
interface ShapeData {
    readonly positions: number[];
    readonly normals: number[];
    readonly uvs: number[];
    readonly indices: number[];
}

function shapeData(): ShapeData {
    return { positions: [], normals: [], uvs: [], indices: [] };
}

function geometryFrom(data: ShapeData): Hilo3d.Geometry {
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(data.positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(data.normals), 3),
        uvs: new Hilo3d.GeometryData(new Float32Array(data.uvs), 2),
        indices: new Hilo3d.GeometryData(new Uint16Array(data.indices), 1)
    });
}

/** The same mould radius is maintained in world units on differently sized toy parts. */
function roundedBox(size: Point3): Hilo3d.Geometry {
    const data = shapeData();
    const half: Point3 = [size[0] / 2, size[1] / 2, size[2] / 2];
    const bevel = Math.min(0.28, Math.min(...size) * 0.28);
    const coordinates = (axis: number): readonly number[] => {
        const extent = half[axis] ?? 0;
        const core = extent - bevel;
        return [
            -extent,
            -core - bevel * 0.58,
            -core - bevel * 0.27,
            -core,
            core,
            core + bevel * 0.27,
            core + bevel * 0.58,
            extent
        ];
    };
    for (const fixed of [0, 1, 2]) {
        const uAxis = (fixed + 1) % 3;
        const vAxis = (fixed + 2) % 3;
        const us = coordinates(uAxis);
        const vs = coordinates(vAxis);
        for (const side of [-1, 1]) {
            const first = data.positions.length / 3;
            for (const v of vs) {
                for (const u of us) {
                    const raw = [0, 0, 0];
                    raw[fixed] = (half[fixed] ?? 0) * side;
                    raw[uAxis] = u;
                    raw[vAxis] = v;
                    const core = raw.map((value, axis) =>
                        Math.max(
                            -(half[axis] ?? 0) + bevel,
                            Math.min((half[axis] ?? 0) - bevel, value)
                        )
                    );
                    const normal = raw.map((value, axis) => value - (core[axis] ?? 0));
                    const length = Math.hypot(...normal);
                    for (let axis = 0; axis < 3; axis += 1) {
                        const component = (normal[axis] ?? 0) / length;
                        data.positions.push((core[axis] ?? 0) + component * bevel);
                        data.normals.push(component);
                    }
                    data.uvs.push(u, v);
                }
            }
            for (let row = 0; row < vs.length - 1; row += 1) {
                for (let column = 0; column < us.length - 1; column += 1) {
                    const a = first + row * us.length + column;
                    const b = a + 1;
                    const d = a + us.length;
                    const c = d + 1;
                    if (side === 1) data.indices.push(a, b, c, a, c, d);
                    else data.indices.push(a, c, b, a, d, c);
                }
            }
        }
    }
    return geometryFrom(data);
}

/** Large corner radii and a rolled top edge give the whole island a single manufactured tray. */
function roundedTray(
    width: number,
    depth: number,
    height: number,
    radius: number,
    bevel: number
): Hilo3d.Geometry {
    const data = shapeData();
    const sections = 12;
    const perimeter = sections * 4;
    const profiles: readonly (readonly [number, number, number, number])[] = [
        [bevel, -height / 2, 0, -1],
        [bevel * 0.2929, -height / 2 + bevel * 0.2929, Math.SQRT1_2, -Math.SQRT1_2],
        [0, -height / 2 + bevel, 1, 0],
        [0, height / 2 - bevel, 1, 0],
        [bevel * 0.2929, height / 2 - bevel * 0.2929, Math.SQRT1_2, Math.SQRT1_2],
        [bevel, height / 2, 0, 1]
    ];
    for (const [inset, y, radial, normalY] of profiles) {
        for (let corner = 0; corner < 4; corner += 1) {
            const centerX = (corner === 0 || corner === 3 ? 1 : -1) * (width / 2 - radius);
            const centerZ = (corner < 2 ? 1 : -1) * (depth / 2 - radius);
            for (let section = 0; section < sections; section += 1) {
                const angle = ((corner + section / (sections - 1)) * Math.PI) / 2;
                const x = centerX + Math.cos(angle) * (radius - inset);
                const z = centerZ + Math.sin(angle) * (radius - inset);
                data.positions.push(x, y, z);
                data.normals.push(Math.cos(angle) * radial, normalY, Math.sin(angle) * radial);
                data.uvs.push(x / width + 0.5, z / depth + 0.5);
            }
        }
    }
    for (let ring = 0; ring < profiles.length - 1; ring += 1) {
        for (let segment = 0; segment < perimeter; segment += 1) {
            const next = (segment + 1) % perimeter;
            const a = ring * perimeter + segment;
            const b = ring * perimeter + next;
            const c = b + perimeter;
            const d = a + perimeter;
            data.indices.push(a, d, c, a, c, b);
        }
    }
    for (const side of [-1, 1]) {
        const center = data.positions.length / 3;
        data.positions.push(0, (height / 2) * side, 0);
        data.normals.push(0, side, 0);
        data.uvs.push(0.5, 0.5);
        const first = side === 1 ? (profiles.length - 1) * perimeter : 0;
        for (let segment = 0; segment < perimeter; segment += 1) {
            const a = first + segment;
            const b = first + ((segment + 1) % perimeter);
            if (side === 1) data.indices.push(center, b, a);
            else data.indices.push(center, a, b);
        }
    }
    return geometryFrom(data);
}

function lathe(profile: readonly Point2[], segments = 40): Hilo3d.Geometry {
    const data = shapeData();
    for (let ring = 0; ring < profile.length; ring += 1) {
        const point = profile[ring];
        if (!point) continue;
        const previous = profile[Math.max(0, ring - 1)] ?? point;
        const next = profile[Math.min(profile.length - 1, ring + 1)] ?? point;
        const radial = next[1] - previous[1];
        const vertical = previous[0] - next[0];
        const length = Math.hypot(radial, vertical) || 1;
        for (let segment = 0; segment <= segments; segment += 1) {
            const angle = (segment / segments) * Math.PI * 2;
            data.positions.push(Math.cos(angle) * point[0], point[1], Math.sin(angle) * point[0]);
            data.normals.push(
                (Math.cos(angle) * radial) / length,
                vertical / length,
                (Math.sin(angle) * radial) / length
            );
            data.uvs.push(segment / segments, ring / (profile.length - 1));
        }
    }
    for (let ring = 0; ring < profile.length - 1; ring += 1) {
        for (let segment = 0; segment < segments; segment += 1) {
            const a = ring * (segments + 1) + segment;
            const b = a + 1;
            const c = b + segments + 1;
            const d = a + segments + 1;
            data.indices.push(a, d, c, a, c, b);
        }
    }
    return geometryFrom(data);
}

function cylinder(radius: number, height: number): Hilo3d.Geometry {
    const edge = Math.min(0.12, radius * 0.22, height * 0.22);
    return lathe([
        [0, -height / 2],
        [radius - edge, -height / 2],
        [radius - edge * 0.2929, -height / 2 + edge * 0.2929],
        [radius, -height / 2 + edge],
        [radius, height / 2 - edge],
        [radius - edge * 0.2929, height / 2 - edge * 0.2929],
        [radius - edge, height / 2],
        [0, height / 2]
    ]);
}

function smoothPath(points: readonly Point2[], steps = 14): Point2[] {
    const result: Point2[] = [];
    for (let segment = 0; segment < points.length - 1; segment += 1) {
        const a = points[Math.max(0, segment - 1)];
        const b = points[segment];
        const c = points[segment + 1];
        const d = points[Math.min(points.length - 1, segment + 2)];
        if (!a || !b || !c || !d) continue;
        for (let step = 0; step < steps; step += 1) {
            const t = step / steps;
            const component = (axis: 0 | 1): number =>
                0.5 *
                (2 * b[axis] +
                    (-a[axis] + c[axis]) * t +
                    (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t * t +
                    (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t * t * t);
            result.push([component(0), component(1)]);
        }
    }
    const last = points[points.length - 1];
    if (last) result.push(last);
    return result;
}

function ribbon(path: readonly Point2[], width: number, y: number): Hilo3d.Geometry {
    const data = shapeData();
    for (let point = 0; point < path.length; point += 1) {
        const current = path[point];
        if (!current) continue;
        const previous = path[Math.max(0, point - 1)] ?? current;
        const next = path[Math.min(path.length - 1, point + 1)] ?? current;
        const dx = next[0] - previous[0];
        const dz = next[1] - previous[1];
        const length = Math.hypot(dx, dz) || 1;
        for (const side of [-1, 1]) {
            data.positions.push(
                current[0] + (((dz / length) * width) / 2) * side,
                y,
                current[1] - (((dx / length) * width) / 2) * side
            );
            data.normals.push(0, 1, 0);
            data.uvs.push((side + 1) / 2, point / path.length);
        }
        if (point > 0) {
            const a = (point - 1) * 2;
            data.indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
    }
    return geometryFrom(data);
}

/** Tube frames follow horizontal curves; used for continuous rails, mould seams and wave strokes. */
function tube(path: readonly Point3[], radius: number, sides = 10): Hilo3d.Geometry {
    const data = shapeData();
    for (let point = 0; point < path.length; point += 1) {
        const current = path[point];
        if (!current) continue;
        const previous = path[Math.max(0, point - 1)] ?? current;
        const next = path[Math.min(path.length - 1, point + 1)] ?? current;
        const dx = next[0] - previous[0];
        const dz = next[2] - previous[2];
        const length = Math.hypot(dx, dz) || 1;
        for (let side = 0; side <= sides; side += 1) {
            const angle = (side / sides) * Math.PI * 2;
            const nx = (dz / length) * Math.cos(angle);
            const nz = (-dx / length) * Math.cos(angle);
            const ny = Math.sin(angle);
            data.positions.push(
                current[0] + nx * radius,
                current[1] + ny * radius,
                current[2] + nz * radius
            );
            data.normals.push(nx, ny, nz);
            data.uvs.push(side / sides, point / path.length);
        }
        if (point > 0) {
            for (let side = 0; side < sides; side += 1) {
                const a = (point - 1) * (sides + 1) + side;
                const b = a + 1;
                const d = a + sides + 1;
                const c = d + 1;
                data.indices.push(a, b, c, a, c, d);
            }
        }
    }
    return geometryFrom(data);
}

/** The train stays still during the equal-budget shadow comparison until motion is explicitly enabled. */
export interface CsmToyDiorama {
    readonly lightsReady: boolean;
    tick(dt: number): void;
    setMotion(enabled: boolean): void;
    setWaterMotion(enabled: boolean): void;
    setNight(enabled: boolean): void;
    setLocalShadows(enabled: boolean): void;
}

/** A single tactile toy landscape, designed around near railings and distant landmark shadows. */
export function createCsmToyDiorama(parent: Hilo3d.Node, maps: EnvironmentMaps): CsmToyDiorama {
    const material = (color: Point3, roughness = 0.43, coat = 0.22): Hilo3d.PBRMaterial =>
        new Hilo3d.PBRMaterial({
            ...environmentMaterialDefaults(maps),
            baseColor: new Hilo3d.Color(...color),
            metallic: 0,
            roughness,
            clearcoatFactor: coat,
            clearcoatRoughnessFactor: 0.28,
            diffuseEnvIntensity: 0.5,
            specularEnvIntensity: 0.4
        });
    const cream = material([0.89, 0.82, 0.64]);
    const porcelain = material([0.96, 0.92, 0.77], 0.35);
    const mint = material([0.34, 0.62, 0.49], 0.92, 0);
    mint.specularEnvIntensity = 0.12;
    const pathMaterial = material([0.89, 0.82, 0.64], 0.9, 0);
    pathMaterial.specularEnvIntensity = 0.12;
    const sage = material([0.18, 0.43, 0.31], 0.5);
    const leafLight = material([0.49, 0.7, 0.39], 0.47);
    const leafYellow = material([0.65, 0.72, 0.34], 0.48);
    const teal = material([0.025, 0.26, 0.27], 0.3);
    const water = material([0.055, 0.47, 0.58], 0.25, 0.45);
    const riverWater = createCsmToyWater();
    const waterRim = material([0.31, 0.68, 0.68], 0.35);
    const coral = material([0.82, 0.22, 0.14], 0.35);
    const orange = material([0.95, 0.43, 0.12], 0.36);
    const yellow = material([0.94, 0.66, 0.22], 0.36);
    const lavender = material([0.46, 0.39, 0.63], 0.41);
    const brown = material([0.41, 0.24, 0.12], 0.5);
    const dark = material([0.035, 0.105, 0.11], 0.42);
    const geometryCache = new Map<string, Hilo3d.Geometry>();
    const sphere = new Hilo3d.SphereGeometry({ radius: 1, widthSegments: 36, heightSegments: 24 });
    const mesh = (
        geometry: Hilo3d.Geometry,
        selected: Hilo3d.MaterialInstance,
        position: Point3,
        scale: Point3 = [1, 1, 1],
        owner = parent,
        casting = true
    ): Hilo3d.Mesh =>
        new Hilo3d.Mesh({
            geometry,
            material: selected,
            x: position[0],
            y: position[1],
            z: position[2],
            scaleX: scale[0],
            scaleY: scale[1],
            scaleZ: scale[2],
            useInstanced: true,
            castShadows: casting,
            receiveShadows: true,
            pointerEnabled: false
        }).addTo(owner);
    const box = (
        selected: Hilo3d.PBRMaterial,
        position: Point3,
        size: Point3,
        owner = parent
    ): Hilo3d.Mesh => {
        const key = `box/${size.join('/')}`;
        let geometry = geometryCache.get(key);
        if (!geometry) {
            geometry = roundedBox(size);
            geometryCache.set(key, geometry);
        }
        return mesh(geometry, selected, position, [1, 1, 1], owner);
    };
    const drum = (
        selected: Hilo3d.PBRMaterial,
        position: Point3,
        radius: number,
        height: number,
        owner = parent
    ): Hilo3d.Mesh => {
        const key = `drum/${String(radius)}/${String(height)}`;
        let geometry = geometryCache.get(key);
        if (!geometry) {
            geometry = cylinder(radius, height);
            geometryCache.set(key, geometry);
        }
        return mesh(geometry, selected, position, [1, 1, 1], owner);
    };
    const ellipsoid = (
        selected: Hilo3d.PBRMaterial,
        position: Point3,
        size: Point3,
        owner = parent
    ): Hilo3d.Mesh => mesh(sphere, selected, position, size, owner);

    mesh(roundedTray(49, 91, 4, 4.6, 0.65), cream, [0, -1.3, -10]);
    mesh(roundedTray(47.9, 89.9, 0.55, 4.4, 0.18), teal, [0, -3.12, -10]);
    mesh(roundedTray(46.2, 88.2, 0.18, 3.4, 0.065), mint, [0, 0.73, -10]);
    box(teal, [0, -1.18, 35.48], [10, 1.35, 0.19]);
    for (let dot = -1; dot <= 1; dot += 1)
        ellipsoid(dot === 0 ? yellow : porcelain, [dot * 1.08, -1.18, 35.6], [0.23, 0.23, 0.08]);

    // The river and paths are continuous ribbons that belong to the same inset landscape.
    const riverPath = smoothPath([
        [4.2, 34],
        [5.4, 21],
        [5, 9],
        [3.5, -3],
        [5.4, -17],
        [2.3, -31],
        [3.7, -45],
        [5, -54]
    ]);
    mesh(ribbon(riverPath, 6.1, 0.844), waterRim, [0, 0, 0], [1, 1, 1], parent, false);
    mesh(
        ribbon(riverPath, 4.85, 0.878),
        riverWater.material,
        [0, 0, 0],
        [1, 1, 1],
        parent,
        false
    ).useInstanced = false;
    const promenade = smoothPath([
        [-11, 22],
        [-6, 17],
        [-3.8, 7],
        [-3.3, -5],
        [-7.2, -17],
        [-10, -23.4]
    ]);
    const lighthousePath = smoothPath([
        [-3.7, -3],
        [3.5, -3],
        [10.5, -4],
        [14.5, -18],
        [13.7, -30],
        [12, -37]
    ]);
    mesh(ribbon(promenade, 3.1, 0.858), pathMaterial, [0, 0, 0], [1, 1, 1], parent, false);
    mesh(ribbon(lighthousePath, 2.9, 0.863), pathMaterial, [0, 0, 0], [1, 1, 1], parent, false);

    // The bridge's close-set posts are the first-cascade detail target.
    const bridgeCenter = 3.5;
    const bridgePoints = Array.from({ length: 45 }, (_, index): Point3 => {
        const t = index / 44;
        return [bridgeCenter - 5.4 + t * 10.8, 1.1 + Math.sin(t * Math.PI) * 0.75, -3];
    });
    for (let plank = 0; plank < 20; plank += 1) {
        const t = (plank + 0.5) / 20;
        box(
            porcelain,
            [bridgeCenter - 5.4 + t * 10.8, 1.05 + Math.sin(t * Math.PI) * 0.75, -3],
            [0.59, 0.34, 3.8]
        );
    }
    for (const side of [-1, 1]) {
        const rail = bridgePoints.map((point): Point3 => [
            point[0],
            point[1] + 1.25,
            point[2] + side * 1.7
        ]);
        mesh(tube(rail, 0.15, 12), coral, [0, 0, 0]);
        for (let post = 0; post < 15; post += 1) {
            const t = post / 14;
            box(
                porcelain,
                [
                    bridgeCenter - 5.4 + t * 10.8,
                    1.6 + Math.sin(t * Math.PI) * 0.75,
                    -3 + side * 1.7
                ],
                [0.19, 1.25, 0.19]
            );
        }
        for (const end of [-1, 1]) {
            box(coral, [bridgeCenter + end * 5.4, 1.6, -3 + side * 1.7], [0.38, 1.65, 0.38]);
            ellipsoid(yellow, [bridgeCenter + end * 5.4, 2.5, -3 + side * 1.7], [0.27, 0.27, 0.27]);
        }
    }

    const trackX = -9.2;
    const trackZ = 15;
    const radiusX = 10.8;
    const radiusZ = 9;
    const railPoint = (angle: number, offset: number): Point3 => [
        trackX + Math.cos(angle) * (radiusX + offset),
        1.04,
        trackZ + Math.sin(angle) * (radiusZ + offset)
    ];
    for (let tie = 0; tie < 58; tie += 1) {
        const angle = (tie / 58) * Math.PI * 2;
        const point = railPoint(angle, 0);
        const sleeper = box(brown, [point[0], 0.9, point[2]], [2.24, 0.15, 0.31]);
        sleeper.rotationY = (-angle * 180) / Math.PI;
    }
    for (const offset of [-0.76, 0.76])
        mesh(
            tube(
                Array.from({ length: 145 }, (_, index) =>
                    railPoint((index / 144) * Math.PI * 2, offset)
                ),
                0.105,
                10
            ),
            dark,
            [0, 0, 0]
        );

    const train: Hilo3d.Node[] = [];
    for (let car = 0; car < 3; car += 1) {
        const node = new Hilo3d.Node({
            name: car === 0 ? 'ToyTrainEngine' : `ToyTrainCar${String(car)}`
        }).addTo(parent);
        train.push(node);
        box(dark, [0, 0.69, 0], [2.06, 0.42, 3.15], node);
        for (const side of [-1, 1]) {
            for (const z of [-1.0, 1.0]) {
                drum(dark, [side * 1.04, 0.62, z], 0.53, 0.22, node).rotationZ = 90;
                drum(
                    car === 0 ? yellow : porcelain,
                    [side * 1.18, 0.62, z],
                    0.26,
                    0.065,
                    node
                ).rotationZ = 90;
            }
        }
        for (const end of [-1, 1]) box(teal, [0, 0.77, end * 1.78], [0.48, 0.2, 0.58], node);
        if (car === 0) {
            drum(orange, [0, 1.55, 0.55], 0.79, 2.18, node).rotationX = 90;
            box(coral, [0, 1.91, -0.88], [1.89, 1.83, 1.43], node);
            box(orange, [0, 2.92, -0.88], [2.25, 0.34, 1.85], node);
            for (const side of [-1, 1])
                box(teal, [side * 0.956, 2.18, -0.84], [0.065, 0.75, 0.83], node);
            box(teal, [0, 2.17, -0.13], [1.22, 0.73, 0.06], node);
            drum(porcelain, [0, 1.56, 1.665], 0.65, 0.11, node).rotationX = 90;
            drum(coral, [0, 2.66, 0.91], 0.27, 0.84, node);
            drum(dark, [0, 3.04, 0.91], 0.38, 0.2, node);
            box(coral, [0, 0.91, 1.59], [2.16, 0.37, 0.43], node);
        } else {
            const color = car === 1 ? yellow : water;
            box(color, [0, 1.26, 0], [2.03, 0.95, 2.92], node);
            box(teal, [0, 1.76, 0], [1.64, 0.07, 2.48], node);
            for (const side of [-1, 1])
                box(color, [side * 0.93, 1.85, 0], [0.19, 0.44, 2.88], node);
            for (const z of [-1.28, 1.28]) box(color, [0, 1.85, z], [1.75, 0.44, 0.18], node);
            if (car === 1) {
                for (const [x, z] of [
                    [-0.43, -0.65],
                    [0.39, 0],
                    [-0.2, 0.76]
                ] as const)
                    ellipsoid(x < 0 ? coral : orange, [x, 2.04, z], [0.58, 0.58, 0.58], node);
            } else {
                box(porcelain, [-0.29, 2.05, -0.61], [0.92, 0.59, 0.98], node).rotationY = -12;
                box(lavender, [0.22, 2.11, 0.59], [1.02, 0.71, 0.88], node).rotationY = 14;
            }
        }
    }
    let motion = false;
    let phase = 1.44;
    const updateTrain = (): void => {
        for (const [index, node] of train.entries()) {
            const angle = phase - index * 0.365;
            node.setPosition(
                trackX + Math.cos(angle) * radiusX,
                0.96,
                trackZ + Math.sin(angle) * radiusZ
            );
            node.rotationY =
                (Math.atan2(-Math.sin(angle) * radiusX, Math.cos(angle) * radiusZ) * 180) / Math.PI;
        }
    };
    updateTrain();
    const engine = train[0];
    if (!engine) throw new Error('Toy railway has no locomotive');
    const night = createCsmToyNight(parent, maps, engine);

    // Three asymmetric tree groups combine broad crowns, forked trunks and smooth toy surfaces.
    const tree = (
        x: number,
        z: number,
        height: number,
        color: Hilo3d.PBRMaterial,
        style: number
    ): void => {
        const trunkHeight = height * 0.47;
        drum(brown, [x, 0.83 + trunkHeight / 2, z], height * 0.058, trunkHeight);
        const crownY = 0.83 + height * 0.69;
        const crownRadius = height * 0.245;
        if (style === 0) {
            ellipsoid(color, [x, crownY, z], [crownRadius, height * 0.36, crownRadius * 0.92]);
        } else {
            for (const side of [-1, 1]) {
                const branch = drum(
                    brown,
                    [x + side * crownRadius * 0.34, 0.83 + trunkHeight * 0.84, z],
                    height * 0.038,
                    height * 0.25
                );
                branch.rotationZ = side * -33;
            }
            ellipsoid(
                color,
                [x - crownRadius * 0.54, crownY - 0.2, z],
                [crownRadius * 0.86, crownRadius, crownRadius * 0.9]
            );
            ellipsoid(
                color,
                [x + crownRadius * 0.56, crownY + crownRadius * 0.15, z - 0.2],
                [crownRadius * 0.9, crownRadius * 1.05, crownRadius * 0.86]
            );
            ellipsoid(
                style === 2 ? leafLight : color,
                [x, crownY + crownRadius * 0.64, z + 0.1],
                [crownRadius * 0.84, crownRadius * 0.92, crownRadius * 0.85]
            );
        }
        drum(mint, [x, 0.91, z], crownRadius * 0.75, 0.2);
    };
    tree(16.5, 17, 8.9, sage, 1);
    tree(19, 7.4, 6.5, leafLight, 0);
    tree(12.9, 23, 5.3, leafYellow, 0);
    tree(-17.6, -7.8, 8.1, leafLight, 2);
    tree(-19.1, -16.7, 5.9, sage, 0);
    tree(17, -18, 7.4, leafYellow, 1);
    tree(-16.2, -44, 6.9, sage, 1);
    tree(-20, -40, 5.1, leafLight, 0);

    // Soft hills stay behind the buildings, with enough silhouette variation to suggest a tiny world.
    ellipsoid(sage, [-16.6, 0.8, -47.1], [6, 4.5, 5.8]);
    ellipsoid(leafLight, [-9.8, 0.69, -47.7], [4.7, 2.3, 4.7]);
    ellipsoid(mint, [-19.5, 0.6, -33.8], [3.3, 2.2, 4.6]);
    ellipsoid(leafLight, [18.8, 0.7, -28.3], [3.9, 2.6, 5.7]);
    for (const [x, z, scale] of [
        [-18.4, 25.8, 0.7],
        [-20.2, 24.9, 0.95],
        [17.5, -31.5, 1.05],
        [18.9, -32.2, 0.68],
        [-15.1, -38.4, 0.66]
    ] as const)
        ellipsoid(cream, [x, 0.8 + scale * 0.3, z], [scale * 1.1, scale * 0.65, scale]);

    const flower = (x: number, z: number, height: number, color: Hilo3d.PBRMaterial): void => {
        drum(sage, [x, 0.84 + height / 2, z], 0.07, height);
        ellipsoid(leafLight, [x - 0.25, 0.84 + height * 0.4, z], [0.32, 0.11, 0.18]).rotationZ =
            -25;
        const centerY = 0.84 + height;
        for (let petal = 0; petal < 5; petal += 1) {
            const angle = (petal / 5) * Math.PI * 2;
            ellipsoid(
                color,
                [x + Math.cos(angle) * 0.32, centerY + Math.sin(angle) * 0.32, z],
                [0.26, 0.26, 0.12]
            );
        }
        ellipsoid(yellow, [x, centerY, z + 0.13], [0.2, 0.2, 0.13]);
    };
    for (const [x, z, h, color] of [
        [11, 27, 1.7, porcelain],
        [12, 26.5, 1.25, coral],
        [13.2, 27.7, 1.95, porcelain],
        [-17.7, 19, 1.5, lavender],
        [-18.8, 18.2, 1.15, porcelain],
        [16.8, -8.1, 1.45, coral],
        [17.8, -8.5, 1.1, porcelain]
    ] as const)
        flower(x, z, h, color);
    for (const [x, z, scale] of [
        [14.7, 25.8, 0.85],
        [-16.9, -5.1, 1.1]
    ] as const) {
        drum(porcelain, [x, 0.83 + scale * 0.6, z], scale * 0.29, scale * 1.2);
        mesh(
            lathe([
                [0, 0],
                [0.76, 0],
                [0.94, 0.07],
                [1, 0.19],
                [0.94, 0.38],
                [0.75, 0.59],
                [0.42, 0.75],
                [0, 0.82]
            ]),
            coral,
            [x, 0.83 + scale * 1.12, z],
            [scale, scale, scale]
        );
        ellipsoid(
            porcelain,
            [x + scale * 0.31, 0.83 + scale * 1.8, z + scale * 0.2],
            [scale * 0.13, scale * 0.04, scale * 0.13]
        );
    }
    const fence = (x: number, z: number, count: number, rotation = 0): void => {
        const owner = new Hilo3d.Node({ x, z, rotationY: rotation }).addTo(parent);
        const width = (count - 1) * 0.83;
        for (let post = 0; post < count; post += 1)
            box(porcelain, [post * 0.83 - width / 2, 1.67, 0], [0.22, 1.66, 0.22], owner);
        for (const y of [1.35, 2.0]) box(cream, [0, y, -0.03], [width + 0.4, 0.14, 0.13], owner);
    };
    fence(-9.8, 27.7, 14);
    fence(15.6, 28.1, 9);
    fence(-15.5, -37.7, 7, -12);
    fence(18.4, -34.7, 6, 80);

    return {
        get lightsReady(): boolean {
            return night.transitionComplete;
        },
        tick(dt: number): void {
            riverWater.tick(dt);
            night.tick(dt, motion);
            if (!motion) return;
            phase += (Math.min(dt, 50) / 1000) * 0.16;
            updateTrain();
        },
        setMotion(enabled: boolean): void {
            motion = enabled;
        },
        setWaterMotion(enabled: boolean): void {
            riverWater.setMotion(enabled);
        },
        setNight(enabled: boolean): void {
            night.setEnabled(enabled);
            riverWater.setDusk(enabled);
        },
        setLocalShadows(enabled: boolean): void {
            night.setShadowEnabled(enabled);
        }
    };
}
