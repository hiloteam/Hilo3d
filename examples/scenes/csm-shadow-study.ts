import * as Hilo3d from '../../src/Hilo3d';
import { environmentMaterialDefaults } from '../shared/environment';
import type { EnvironmentMaps } from '../shared/init';

type Point3 = readonly [number, number, number];

/** A small moulded edge keeps the sun deck consistent with the surrounding toy parts. */
function bevelledSlab(size: Point3, radius: number): Hilo3d.BoxGeometry {
    const geometry = new Hilo3d.BoxGeometry({
        width: size[0],
        height: size[1],
        depth: size[2],
        widthSegments: 3,
        heightSegments: 3,
        depthSegments: 3
    });
    const positions = geometry.vertices?.data;
    const normals = geometry.normals?.data;
    if (!positions || !normals) throw new Error('Toy sun deck requires position and normal data');
    for (let offset = 0; offset < positions.length; offset += 3) {
        const core: number[] = [];
        const delta: number[] = [];
        for (const [axis, extent] of size.entries()) {
            const value = positions[offset + axis] ?? 0;
            const half = extent / 2;
            const component =
                Math.abs(value) < half * 0.8 ? Math.sign(value) * (half - radius) : value;
            const clamped = Math.max(-half + radius, Math.min(half - radius, component));
            core.push(clamped);
            delta.push(component - clamped);
        }
        const length = Math.hypot(...delta) || 1;
        for (let axis = 0; axis < 3; axis += 1) {
            const normal = (delta[axis] ?? 0) / length;
            positions[offset + axis] = (core[axis] ?? 0) + normal * radius;
            normals[offset + axis] = normal;
        }
    }
    return geometry;
}

/** Fine garden pickets cast an asymmetric line pattern onto a quiet ivory receiver. */
export function createCsmShadowStudy(parent: Hilo3d.Node, maps: EnvironmentMaps): void {
    const owner = new Hilo3d.Node({ name: 'ToySunDeck', x: 16, z: -5 }).addTo(parent);
    const material = (color: Point3): Hilo3d.PBRMaterial =>
        new Hilo3d.PBRMaterial({
            ...environmentMaterialDefaults(maps),
            baseColor: new Hilo3d.Color(...color),
            metallic: 0,
            roughness: 0.58,
            clearcoatFactor: 0.2,
            clearcoatRoughnessFactor: 0.32,
            diffuseEnvIntensity: 0.5,
            specularEnvIntensity: 0.35
        });
    const ivory = material([0.94, 0.9, 0.77]);
    const mint = material([0.68, 0.8, 0.66]);
    const teal = material([0.06, 0.29, 0.28]);
    const box = new Hilo3d.BoxGeometry().setAllRectUV([
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0]
    ]);
    const part = (
        name: string,
        selected: Hilo3d.PBRMaterial,
        position: Point3,
        size: Point3,
        geometry = box,
        castShadows = true
    ): void => {
        new Hilo3d.Mesh({
            name,
            geometry,
            material: selected,
            x: position[0],
            y: position[1],
            z: position[2],
            scaleX: size[0],
            scaleY: size[1],
            scaleZ: size[2],
            useInstanced: true,
            castShadows,
            receiveShadows: true,
            pointerEnabled: false
        }).addTo(owner);
    };
    part(
        'ToySunDeckRim',
        teal,
        [0, 0.875, 0],
        [1, 1, 1],
        bevelledSlab([8.08, 0.12, 9.08], 0.045),
        false
    );
    part(
        'ToySunDeckReceiver',
        ivory,
        [0, 0.96, 0],
        [1, 1, 1],
        bevelledSlab([8, 0.18, 9], 0.055),
        false
    );

    // The sun travels toward -X/-Z, so these front-edge pickets project across the deck.
    for (let index = 0; index < 18; index += 1) {
        const width = index % 5 === 0 ? 0.14 : 0.09;
        part(
            `ToySunDeckPicket${String(index)}`,
            mint,
            [-3.57 + index * 0.42, 2.36, 4],
            [width, 2.62, 0.035]
        );
    }
    for (const x of [-3.82, 3.82]) part('ToySunDeckEndPost', ivory, [x, 2.4, 4], [0.24, 2.7, 0.24]);
    part('ToySunDeckHandrail', mint, [0, 3.67, 4], [7.9, 0.12, 0.19]);
    part('ToySunDeckLowerRail', mint, [0, 1.34, 4], [7.76, 0.1, 0.12]);
}
