import * as H from '../../src/Hilo3d';
import { createLumenRoundedBox } from './lumenGeometry';
import { loadDefaultEnvironmentMaps } from './defaultEnvironment';
import { createPianoMagicEffects } from './pianoMagicEffects';
import { createPianoNebula } from './pianoNebula';

const WHITE_PITCHES = new Set([0, 2, 4, 5, 7, 9, 11]);
export const pianoNotes = Array.from({ length: 37 }, (_, index) => index + 48);
export function isWhiteNote(midi: number): boolean {
    return WHITE_PITCHES.has(midi % 12);
}
export function noteName(midi: number): string {
    return `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12] ?? 'C'}${String(Math.floor(midi / 12) - 1)}`;
}

/** Smooth closed grand-piano outline, extruded with independent side normals. */
function pianoBodyGeometry(thickness: number): H.Geometry {
    const outline: [number, number][] = [
        [-2.85, 1.38],
        [2.85, 1.38],
        [2.85, 0.1]
    ];
    const curve = (
        a: readonly [number, number],
        b: readonly [number, number],
        c: readonly [number, number],
        d: readonly [number, number]
    ): void => {
        for (let step = 1; step <= 20; step++) {
            const t = step / 20,
                s = 1 - t;
            outline.push([
                s ** 3 * a[0] + 3 * s * s * t * b[0] + 3 * s * t * t * c[0] + t ** 3 * d[0],
                s ** 3 * a[1] + 3 * s * s * t * b[1] + 3 * s * t * t * c[1] + t ** 3 * d[1]
            ]);
        }
    };
    curve([2.85, 0.1], [2.9, -1.4], [0.7, -1.9], [0.4, -3.2]);
    curve([0.4, -3.2], [-0.3, -4.8], [-2.85, -4.5], [-2.85, -2.8]);
    const vertices: number[] = [],
        normals: number[] = [],
        indices: number[] = [];
    const triangle = (a: number[], b: number[], c: number[], normal: readonly number[]): void => {
        const base = vertices.length / 3;
        vertices.push(...a, ...b, ...c);
        normals.push(...normal, ...normal, ...normal);
        indices.push(base, base + 1, base + 2);
    };
    const bevel = Math.min(0.04, thickness * 0.24);
    const profiles: readonly (readonly [number, number])[] = [
        [0.992, thickness / 2],
        [1, thickness / 2 - bevel],
        [1, -thickness / 2 + bevel],
        [0.992, -thickness / 2]
    ];
    for (const [index, a] of outline.entries()) {
        const b = outline[(index + 1) % outline.length];
        if (!b) continue;
        triangle(
            [-1, thickness / 2, -1],
            [a[0] * 0.992, thickness / 2, a[1] * 0.992],
            [b[0] * 0.992, thickness / 2, b[1] * 0.992],
            [0, 1, 0]
        );
        triangle(
            [-1, -thickness / 2, -1],
            [b[0] * 0.992, -thickness / 2, b[1] * 0.992],
            [a[0] * 0.992, -thickness / 2, a[1] * 0.992],
            [0, -1, 0]
        );
        const dx = b[0] - a[0],
            dz = b[1] - a[1],
            length = Math.hypot(dx, dz);
        for (let segment = 0; segment < profiles.length - 1; segment++) {
            const upper = profiles[segment],
                lower = profiles[segment + 1];
            if (!upper || !lower) continue;
            const yNormal = segment === 0 ? 0.707 : segment === 2 ? -0.707 : 0;
            const side = segment === 1 ? 1 : 0.707;
            const normal = [(-dz / length) * side, yNormal, (dx / length) * side];
            const au = [a[0] * upper[0], upper[1], a[1] * upper[0]];
            const al = [a[0] * lower[0], lower[1], a[1] * lower[0]];
            const bu = [b[0] * upper[0], upper[1], b[1] * upper[0]];
            const bl = [b[0] * lower[0], lower[1], b[1] * lower[0]];
            triangle(au, al, bu, normal);
            triangle(al, bl, bu, normal);
        }
    }
    return new H.Geometry({
        vertices: new H.GeometryData(new Float32Array(vertices), 3),
        normals: new H.GeometryData(new Float32Array(normals), 3),
        indices: new H.GeometryData(new Uint16Array(indices), 1)
    });
}

interface PianoKey {
    readonly mesh: H.Mesh;
    readonly light: H.Mesh;
    readonly restY: number;
    readonly material: H.PBRMaterial;
    readonly glow: H.Color;
    level: number;
    energy: number;
    held: boolean;
}
export interface PianoScene {
    press(midi: number, velocity: number): void;
    release(midi: number): void;
    update(seconds: number, dt: number): void;
    setEffects(enabled: boolean): void;
    pick(x: number, y: number): number | null;
    dispose(): void;
}

export async function createPianoScene(
    stage: H.Stage,
    camera: H.PerspectiveCamera,
    signal: AbortSignal
): Promise<PianoScene> {
    const maps = await loadDefaultEnvironmentMaps();
    const textures: H.Texture<unknown>[] = [maps.diffuseEnvMap, maps.specularEnvMap];
    let brdfLUT: H.Texture;
    try {
        signal.throwIfAborted();
        brdfLUT = await new H.TextureLoader().load({
            src: new URL('../image/brdfLUT.png', import.meta.url).href
        });
        textures.push(brdfLUT);
        signal.throwIfAborted();
    } catch (error) {
        for (const texture of textures) texture.destroy();
        throw error;
    }
    const environment = {
        brdfLUT,
        diffuseEnvMap: { texture: maps.diffuseEnvMap, encoding: 'srgb' as const },
        specularEnvMap: { texture: maps.specularEnvMap, encoding: 'srgb' as const },
        diffuseEnvIntensity: 0.055,
        specularEnvIntensity: 0.16
    };
    const rounded = createLumenRoundedBox();
    const unitBox = new H.BoxGeometry();
    const sphere = new H.SphereGeometry({ radius: 1, widthSegments: 8, heightSegments: 6 });
    const root = new H.Node({ x: 1.1, rotationY: -4 });
    root.addTo(stage);
    const material = (color: number, metallic: number, roughness: number): H.PBRMaterial =>
        new H.PBRMaterial({
            baseColor: new H.Color().fromHEX(color),
            metallic,
            roughness,
            ...environment
        });
    const lacquer = material(0x05090e, 0.45, 0.19);
    lacquer.specularEnvIntensity = 0.2;
    const nickel = material(0x26313b, 0.78, 0.3);
    const darkNickel = material(0x1a354a, 0.65, 0.38);
    const wood = material(0x0b1117, 0.18, 0.47);
    function box(
        parent: H.Node,
        x: number,
        y: number,
        z: number,
        w: number,
        h: number,
        d: number,
        surface: H.MaterialInstance,
        bevel = true
    ): H.Mesh {
        return new H.Mesh({
            geometry: bevel ? rounded : unitBox,
            material: surface,
            x,
            y,
            z,
            scaleX: w,
            scaleY: h,
            scaleZ: d
        }).addTo(parent);
    }
    const nebula = createPianoNebula(stage, camera);
    const magic = createPianoMagicEffects(stage, camera);
    // The instrument floats in darkness; no disc, luminous rim, dial marks or expanding rings.
    // The soundboard, raised wing, triple castered legs and lyre are modeled independently.
    new H.Mesh({ geometry: pianoBodyGeometry(0.48), material: lacquer, y: 2.25 }).addTo(root);
    new H.Mesh({
        geometry: pianoBodyGeometry(0.035),
        material: nickel,
        y: 2.51,
        scaleX: 1.008,
        scaleZ: 1.008
    }).addTo(root);
    new H.Mesh({
        geometry: pianoBodyGeometry(0.045),
        material: wood,
        y: 2.54,
        scaleX: 0.985,
        scaleZ: 0.985
    }).addTo(root);
    const lid = new H.Node({ x: -2.85, y: 2.67, rotationZ: 28 });
    lid.addTo(root);
    new H.Mesh({ geometry: pianoBodyGeometry(0.13), material: lacquer, x: 2.85 }).addTo(lid);
    new H.Mesh({
        geometry: pianoBodyGeometry(0.025),
        material: nickel,
        x: 2.85,
        y: -0.081,
        scaleX: 0.995,
        scaleZ: 0.995
    }).addTo(lid);
    box(root, 1.66, 3.72, -0.4, 0.055, 2.5, 0.055, nickel).rotationZ = -18;
    for (const [x, z] of [
        [-2.45, 0.95],
        [2.45, 0.95],
        [-1.7, -3.3]
    ]) {
        if (x === undefined || z === undefined) continue;
        box(root, x, 1.11, z, 0.27, 2.1, 0.28, lacquer);
        box(root, x, 0.22, z, 0.29, 0.29, 0.31, nickel);
        new H.Mesh({
            geometry: sphere,
            material: nickel,
            x,
            y: 0.1,
            z,
            scaleX: 0.16,
            scaleY: 0.12,
            scaleZ: 0.16
        }).addTo(root);
    }
    box(root, 0, 1.22, 1, 0.16, 1.48, 0.15, nickel);
    box(root, 0, 0.48, 1.2, 0.95, 0.11, 0.45, lacquer);
    for (const x of [-0.29, 0, 0.29]) box(root, x, 0.38, 1.52, 0.18, 0.09, 0.67, nickel);
    // Tension strings and soundboard braces remain visible beneath the lifted lid.
    for (let index = 0; index < 32; index++) {
        const x = -2.5 + index * 0.155;
        const length = 3.8 - index * 0.081;
        box(
            root,
            x,
            2.595,
            0.84 - length / 2,
            0.011,
            0.011,
            length,
            index % 3 === 0 ? nickel : darkNickel,
            false
        );
    }
    for (const x of [-2.0, -0.75, 0.6])
        box(root, x, 2.61, -0.72, 0.09, 0.09, 3.15, nickel).rotationY = 8;
    box(root, 0, 2.14, 1.97, 5.72, 0.27, 1.35, lacquer);
    box(root, 0, 2.33, 1.42, 5.28, 0.05, 0.13, material(0x741b27, 0.05, 0.8));
    box(root, 0, 2.14, 2.63, 5.73, 0.035, 0.04, nickel, false);
    box(root, -2.78, 2.36, 2, 0.23, 0.22, 1.35, lacquer);
    box(root, 2.78, 2.36, 2, 0.23, 0.22, 1.35, lacquer);
    const keys = new Map<number, PianoKey>();
    let whiteIndex = 0;
    for (const midi of pianoNotes) {
        const black = !isWhiteNote(midi);
        const x = black ? -2.52 + (whiteIndex - 0.5) * 0.24 : -2.52 + whiteIndex * 0.24;
        if (!black) whiteIndex++;
        const keyMaterial = new H.PBRMaterial({
            baseColor: new H.Color().fromHEX(black ? 0x10181c : 0xede8d5),
            metallic: 0.12,
            roughness: 0.27,
            ...environment
        });
        const y = black ? 2.48 : 2.36;
        const mesh = box(
            root,
            x,
            y,
            black ? 1.78 : 2,
            black ? 0.14 : 0.224,
            black ? 0.19 : 0.14,
            black ? 0.73 : 1.17,
            keyMaterial
        );
        const glow = new H.Color(0, 0, 0);
        const light = box(
            root,
            x,
            2.31,
            2.62,
            0.18,
            0.022,
            0.024,
            new H.BasicMaterial({ lightType: 'NONE', diffuse: glow }),
            false
        );
        light.visible = false;
        keys.set(midi, {
            mesh,
            light,
            restY: y,
            material: keyMaterial,
            glow,
            level: 0,
            energy: 0,
            held: false
        });
    }
    // Raised maker's medallion on the front rail, using the engine's managed image texture path.
    const plaque = document.createElement('canvas');
    plaque.width = 1024;
    plaque.height = 128;
    const ctx = plaque.getContext('2d');
    if (ctx) {
        ctx.fillStyle = '#101d20';
        ctx.fillRect(0, 0, 1024, 128);
        ctx.fillStyle = '#78bddc';
        ctx.textAlign = 'center';
        ctx.font = '42px Georgia';
        ctx.fillText('N O C T U R N E', 512, 61);
        ctx.font = '15px sans-serif';
        ctx.fillText('H I L O   ·   S O U N D   A T E L I E R', 512, 96);
        const plaqueTexture = new H.Texture({ image: plaque });
        textures.push(plaqueTexture);
        new H.Mesh({
            geometry: new H.PlaneGeometry({ width: 1.85, height: 0.23 }),
            material: new H.PBRMaterial({
                baseColorMap: { texture: plaqueTexture, encoding: 'srgb' },
                metallic: 0.2,
                roughness: 0.45,
                ...environment
            }),
            castShadows: false,
            y: 2.67,
            z: 1.4
        }).addTo(root);
    }
    box(root, 0, 1.07, 3.86, 2.14, 0.25, 1.05, lacquer);
    box(root, 0, 1.22, 3.86, 2.03, 0.17, 0.96, material(0x101821, 0.05, 0.7));
    for (const x of [-0.83, 0.83])
        for (const z of [3.52, 4.2]) {
            box(root, x, 0.54, z, 0.12, 1.04, 0.12, lacquer);
            box(root, x, 0.12, z, 0.125, 0.15, 0.125, nickel);
        }
    let enabled = true,
        energy = 0,
        illumination = 0;
    // Decorative light emitters do not cast shadows.
    stage.traverse(node => {
        if (node instanceof H.Mesh && node.material instanceof H.BasicMaterial)
            node.castShadows = false;
    });
    const ray = new H.Ray();
    const burstPosition = new H.Vector3();
    return {
        dispose(): void {
            magic.dispose();
            nebula.dispose();
            for (const texture of textures) texture.destroy();
            textures.length = 0;
        },
        press(midi, velocity): void {
            while (midi < 48) midi += 12;
            while (midi > 84) midi -= 12;
            const key = keys.get(midi);
            if (!key) return;
            burstPosition
                .set(key.mesh.x, key.restY + 0.2, key.mesh.z)
                .transformMat4(root.worldMatrix);
            magic.press(midi, burstPosition, velocity);
            key.held = true;
            key.energy = velocity;
            key.level = velocity;
            energy = Math.max(energy, velocity);
        },
        release(midi): void {
            while (midi < 48) midi += 12;
            while (midi > 84) midi -= 12;
            const key = keys.get(midi);
            if (key) key.held = false;
            magic.release(midi);
        },
        setEffects(value): void {
            enabled = value;
            nebula.setEnabled(value);
            magic.setEnabled(value);
        },
        update(seconds, dt): void {
            energy *= Math.exp(-dt * 2.2);
            let heldEnergy = 0;
            for (const key of keys.values()) {
                if (key.held) heldEnergy += key.level * 0.9;
            }
            const target = Math.min(1, Math.max(energy, heldEnergy));
            const response = target > illumination ? 12 : 1.9;
            illumination += (target - illumination) * (1 - Math.exp(-dt * response));
            magic.update(seconds, dt, illumination);
            nebula.update(seconds, illumination * 0.75);
            for (const key of keys.values()) {
                key.energy = Math.max(
                    key.held ? key.level * 0.68 : 0,
                    key.energy * Math.exp(-dt * 4)
                );
                key.mesh.y +=
                    (key.restY - (key.held ? 0.065 : 0) - key.mesh.y) * Math.min(1, dt * 22);
                key.light.visible = enabled && key.energy > 0.015;
                key.glow.set(key.energy * 0.12, key.energy * 1.4, key.energy * 3.2, 1);
                key.material.emissionFactor.set(
                    enabled ? key.energy * 0.035 : 0,
                    enabled ? key.energy * 0.28 : 0,
                    enabled ? key.energy * 0.7 : 0,
                    1
                );
            }
        },
        pick(x, y): number | null {
            ray.fromCamera(camera, x, y, stage.width, stage.height);
            let selected: number | null = null,
                distance = Infinity;
            for (const [midi, key] of keys) {
                const hit = key.mesh.raycast(ray)?.[0];
                if (hit) {
                    const next = hit.distance(camera.position);
                    if (next < distance) {
                        distance = next;
                        selected = midi;
                    }
                }
            }
            return selected;
        }
    };
}
