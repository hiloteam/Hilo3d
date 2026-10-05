import * as H from '../../src/Hilo3d';
import { createMagicPlumeMaterial } from './pianoMagicShader';

const TAU = Math.PI * 2;
const PARTICLE_CAPACITY = 3840;
const MIDI_CAPACITY = 128;
const LIGHT_COUNT = 4;
const MAX_EMISSION_RATE = 1180;

export interface PianoMagicEffects {
    press(midi: number, position: H.Vector3, velocity: number): void;
    release(midi: number): void;
    update(seconds: number, dt: number, energy: number): void;
    setEnabled(enabled: boolean): void;
    dispose(): void;
}

interface SpriteBatch {
    readonly mesh: H.Mesh;
    readonly positions: Float32Array;
    readonly colors: Float32Array;
    readonly vertices: H.GeometryData;
    readonly colorData: H.GeometryData;
}

interface Emitter {
    held: boolean;
    x: number;
    y: number;
    z: number;
    velocity: number;
    age: number;
    releaseAge: number;
    remainder: number;
    envelope: number;
    phase: number;
}

interface LightDust {
    age: number;
    lifetime: number;
    x: number;
    y: number;
    z: number;
    rise: number;
    phase: number;
    twist: number;
    spread: number;
    size: number;
    brightness: number;
    tint: number;
    flowPhase: number;
    glint: number;
    driftX: number;
    driftZ: number;
}

function smoothstep(min: number, max: number, value: number): number {
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return t * t * (3 - 2 * t);
}

/** Grayscale red-channel masks preserve BasicMaterial's per-vertex cyan/blue coloration. */
function createMask(style: 'dust' | 'wisp' | 'core'): H.Texture<Uint8Array> {
    const size = 64;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        const v = (y / (size - 1)) * 2 - 1;
        for (let x = 0; x < size; x++) {
            const u = (x / (size - 1)) * 2 - 1;
            const radius = Math.hypot(u, v);
            const grain = 0.75 + Math.sin(u * 31 + v * 19) * 0.1 + Math.cos(v * 37 - u * 23) * 0.15;
            const edge = 1 - smoothstep(0.75, 0.98, radius);
            let opacity: number;
            if (style === 'dust') {
                // Filled, asymmetric grains have no outline that repeats as a chain of rings.
                const bend = u + Math.sin(v * 3.6) * 0.12;
                const body = Math.exp(-(bend * bend * 10 + v * v * 7));
                const shoulder = Math.exp(-((u - 0.19) ** 2 * 20 + (v + 0.16) ** 2 * 18));
                opacity = (body * 0.7 + shoulder * 0.25) * grain * edge;
            } else if (style === 'wisp') {
                const bend = u + Math.sin(v * 4.1 + 0.5) * 0.19;
                const taper = Math.exp(-(bend * bend * 11 + v * v * 3.6));
                const folds =
                    0.46 +
                    Math.sin(u * 13 + Math.sin(v * 6) * 2.2) * 0.2 +
                    Math.cos(v * 17 - u * 8) * 0.13;
                opacity = taper * folds * grain * edge;
            } else {
                opacity = Math.exp(-radius * radius * 20) * edge;
            }
            const value = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
            const offset = (y * size + x) * 4;
            pixels[offset] = value;
            pixels[offset + 1] = value;
            pixels[offset + 2] = value;
            pixels[offset + 3] = 255;
        }
    }
    return new H.Texture({
        image: pixels,
        width: size,
        height: size,
        internalFormat: H.constants.RGBA8,
        format: H.constants.RGBA,
        type: H.constants.UNSIGNED_BYTE,
        wrapS: H.constants.CLAMP_TO_EDGE,
        wrapT: H.constants.CLAMP_TO_EDGE,
        magFilter: H.constants.LINEAR,
        minFilter: H.constants.LINEAR
    });
}

/** One persistent portable draw per optical layer; each batch stays below Uint16 limits. */
function createBatch(
    parent: H.Node,
    material: H.MaterialInstance,
    name: string,
    capacity = PARTICLE_CAPACITY,
    proceduralUV = false
): SpriteBatch {
    const positions = new Float32Array(capacity * 12);
    const colors = new Float32Array(capacity * 16);
    const uvs = new Float32Array(capacity * 8);
    const indices = new Uint16Array(capacity * 6);
    for (let index = 0; index < capacity; index++) {
        uvs.set([0, 1, 1, 1, 1, 0, 0, 0], index * 8);
        if (proceduralUV) uvs.set([0, 0, 1, 0, 1, 1, 0, 1], index * 8);
        const vertex = index * 4;
        indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], index * 6);
    }
    const vertices = new H.GeometryData(positions, 3);
    const colorData = new H.GeometryData(colors, 4);
    const mesh = new H.Mesh({
        name,
        geometry: new H.Geometry({
            vertices,
            colors: colorData,
            uvs: new H.GeometryData(uvs, 2),
            indices: new H.GeometryData(indices, 1),
            isStatic: false
        }),
        material,
        // All particles move above the keyboard; avoid stale geometry-bounds culling.
        frustumTest: false,
        castShadows: false,
        receiveShadows: false
    }).addTo(parent);
    return { mesh, positions, colors, vertices, colorData };
}

function maskedMaterial(mask: H.Texture<Uint8Array>): H.BasicMaterial {
    return new H.BasicMaterial({
        lightType: 'NONE',
        opacityMap: { texture: mask, encoding: 'data' },
        cullMode: 'none',
        compositing: { mode: 'additive', premultiplied: false },
        state: { depthWrite: false }
    });
}

function writeColor(
    batch: SpriteBatch,
    index: number,
    red: number,
    green: number,
    blue: number,
    opacity: number
): void {
    const start = index * 16;
    for (let corner = 0; corner < 4; corner++) {
        const offset = start + corner * 4;
        batch.colors[offset] = red;
        batch.colors[offset + 1] = green;
        batch.colors[offset + 2] = blue;
        batch.colors[offset + 3] = opacity;
    }
}

/** Fine cyan light dust follows curling fluid above each played key and dissolves into darkness. */
export function createPianoMagicEffects(
    stage: H.Stage,
    camera: H.PerspectiveCamera
): PianoMagicEffects {
    const root = new H.Node({ name: 'piano-magic-light-plumes' }).addTo(stage);
    const dustMask = createMask('dust');
    const wispMask = createMask('wisp');
    const coreMask = createMask('core');
    const dust = createBatch(root, maskedMaterial(dustMask), 'piano-fine-cyan-light-dust');
    const wisps = createBatch(root, maskedMaterial(wispMask), 'piano-dark-blue-fluid-wisps');
    const cores = createBatch(root, maskedMaterial(coreMask), 'piano-cold-white-light-glints');
    const plumeShader = createMagicPlumeMaterial();
    const plumes = createBatch(
        root,
        plumeShader.material,
        'piano-curling-blue-plumes',
        MIDI_CAPACITY,
        true
    );
    const particleBatches = [wisps, dust, cores];
    const batches = [wisps, dust, cores, plumes];
    const particles: LightDust[] = Array.from({ length: PARTICLE_CAPACITY }, () => ({
        age: 10,
        lifetime: 0,
        x: 0,
        y: 0,
        z: 0,
        rise: 0,
        phase: 0,
        twist: 0,
        spread: 0,
        size: 0,
        brightness: 0,
        tint: 0,
        flowPhase: 0,
        glint: 0,
        driftX: 0,
        driftZ: 0
    }));
    const emitters: Emitter[] = Array.from({ length: MIDI_CAPACITY }, (_, midi) => ({
        held: false,
        x: 0,
        y: 0,
        z: 0,
        velocity: 0,
        age: 0,
        releaseAge: 0,
        remainder: 0,
        envelope: 0,
        phase: midi * 2.399963
    }));
    const lights = Array.from({ length: LIGHT_COUNT }, (_, index) =>
        new H.PointLight({
            name: `piano-plume-light-${String(index)}`,
            color: new H.Color(0.015, 0.44, 1),
            amount: 0,
            range: 2.4
        }).addTo(root)
    );
    const lightWeights = new Float32Array(LIGHT_COUNT);
    const lightX = new Float32Array(LIGHT_COUNT);
    const lightY = new Float32Array(LIGHT_COUNT);
    const lightZ = new Float32Array(LIGHT_COUNT);
    const right = new H.Vector3(1, 0, 0);
    const up = new H.Vector3(0, 1, 0);
    let enabled = true;
    let disposed = false;
    let cursor = 0;
    let randomState = 0x7f4a7c15;

    function random(): number {
        randomState ^= randomState << 13;
        randomState ^= randomState >>> 17;
        randomState ^= randomState << 5;
        return (randomState >>> 0) / 4294967296;
    }

    function emit(emitter: Emitter, count: number, attack: boolean): void {
        for (let index = 0; index < count; index++) {
            const particle = particles[cursor];
            cursor = (cursor + 1) % PARTICLE_CAPACITY;
            if (!particle) continue;
            const phase = random() * TAU;
            const spread = 0.012 + random() ** 1.6 * 0.1;
            // Uneven packets share a fluid centre without forming rigid dotted vertical rails.
            const packet = Math.floor(emitter.age * 9);
            const packetX = Math.sin(packet * 1.3 + emitter.phase) * 0.045;
            const packetZ = Math.cos(packet * 1.1 + emitter.phase) * 0.055;
            particle.x = emitter.x + Math.cos(phase) * spread + packetX;
            particle.y = emitter.y + 0.06 + random() * (attack ? 0.26 : 0.1);
            particle.z = emitter.z + Math.sin(phase) * spread + packetZ;
            particle.age = 0;
            particle.lifetime = 2.05 + random() * 0.8;
            particle.rise = 1.65 + random() * 0.5;
            particle.phase = phase;
            particle.twist = 1.4 + random() * 2.2;
            particle.spread = 0.035 + random() ** 1.5 * 0.25;
            particle.size = 0.018 + random() ** 2.5 * 0.032;
            particle.brightness =
                (0.26 + random() ** 1.4 * 0.74) * (0.65 + emitter.velocity * 0.35);
            particle.tint = random();
            particle.flowPhase = emitter.phase;
            particle.glint = random() > 0.91 ? 0.65 + random() * 0.35 : 0;
            const driftAngle =
                emitter.phase + Math.sin(packet * 1.3) * 0.45 + (random() - 0.5) * 1.8;
            const driftStrength = 0.16 + random() ** 1.3 * 0.42;
            particle.driftX = Math.cos(driftAngle) * driftStrength;
            particle.driftZ = Math.sin(driftAngle) * driftStrength * 0.75;
        }
    }

    function billboard(
        batch: SpriteBatch,
        index: number,
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        angle: number
    ): void {
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const rx = (right.x * cosine + up.x * sine) * width;
        const ry = (right.y * cosine + up.y * sine) * width;
        const rz = (right.z * cosine + up.z * sine) * width;
        const ux = (up.x * cosine - right.x * sine) * height;
        const uy = (up.y * cosine - right.y * sine) * height;
        const uz = (up.z * cosine - right.z * sine) * height;
        const offset = index * 12;
        const positions = batch.positions;
        positions[offset] = x - rx - ux;
        positions[offset + 1] = y - ry - uy;
        positions[offset + 2] = z - rz - uz;
        positions[offset + 3] = x + rx - ux;
        positions[offset + 4] = y + ry - uy;
        positions[offset + 5] = z + rz - uz;
        positions[offset + 6] = x + rx + ux;
        positions[offset + 7] = y + ry + uy;
        positions[offset + 8] = z + rz + uz;
        positions[offset + 9] = x - rx + ux;
        positions[offset + 10] = y - ry + uy;
        positions[offset + 11] = z - rz + uz;
    }

    function update(seconds: number, dt: number, energy: number): void {
        if (disposed) return;
        const step = Math.max(0, dt);
        // Age existing effects in real time, but never emit a backlog after a stalled frame.
        const emissionStep = Math.min(0.1, step);
        const musicalEnergy = Math.max(0, Math.min(1, energy));
        let heldCount = 0;
        for (const emitter of emitters) if (emitter.held) heldCount++;
        const perKeyRate = Math.min(160, MAX_EMISSION_RATE / Math.max(1, heldCount));
        lightWeights.fill(0);
        lightX.fill(0);
        lightY.fill(0);
        lightZ.fill(0);
        for (let midi = 0; midi < MIDI_CAPACITY; midi++) {
            const emitter = emitters[midi];
            if (!emitter) continue;
            emitter.age += step;
            if (!emitter.held) emitter.releaseAge += step;
            emitter.envelope +=
                ((emitter.held ? emitter.velocity : 0) - emitter.envelope) *
                (1 - Math.exp(-step * (emitter.held ? 16 : 2.8)));
            if (enabled && emitter.held) {
                const packetPulse =
                    0.42 + Math.max(0, Math.sin(emitter.age * 16 + emitter.phase)) * 0.78;
                emitter.remainder +=
                    emissionStep * perKeyRate * packetPulse * (0.65 + emitter.velocity * 0.35);
                const count = Math.floor(emitter.remainder);
                emitter.remainder -= count;
                emit(emitter, count, false);
            }
            if (emitter.envelope < 0.002) continue;
            const zone = Math.max(0, Math.min(LIGHT_COUNT - 1, Math.floor((midi - 48) / 10)));
            const weight = emitter.envelope;
            lightWeights[zone] = (lightWeights[zone] ?? 0) + weight;
            lightX[zone] = (lightX[zone] ?? 0) + emitter.x * weight;
            lightY[zone] = (lightY[zone] ?? 0) + emitter.y * weight;
            lightZ[zone] = (lightZ[zone] ?? 0) + emitter.z * weight;
        }
        for (let index = 0; index < LIGHT_COUNT; index++) {
            const light = lights[index];
            if (!light) continue;
            const weight = lightWeights[index] ?? 0;
            if (weight > 0.002) {
                light.setPosition(
                    (lightX[index] ?? 0) / weight,
                    (lightY[index] ?? 0) / weight + 0.55,
                    (lightZ[index] ?? 0) / weight + 0.12
                );
            }
            light.amount = enabled
                ? Math.min(1.15, weight) *
                  (0.45 + musicalEnergy * 1.05) *
                  (0.92 + Math.sin(seconds * 12.4 + index * 1.8) * 0.08)
                : 0;
        }
        if (!enabled) return;
        plumeShader.update(seconds);
        // Controls set the camera quaternion before Stage refreshes the world matrix.
        right.set(1, 0, 0).transformQuat(camera.quaternion);
        up.set(0, 1, 0).transformQuat(camera.quaternion);
        const horizontalLength = Math.hypot(right.x, right.z);
        const sideX = right.x / Math.max(0.001, horizontalLength);
        const sideZ = right.z / Math.max(0.001, horizontalLength);
        for (let midi = 0; midi < MIDI_CAPACITY; midi++) {
            const emitter = emitters[midi];
            if (!emitter) continue;
            const intensity = emitter.envelope * Math.exp(-emitter.releaseAge * 1.1);
            writeColor(plumes, midi, ((midi * 17) % 127) / 127, intensity, 1, emitter.velocity);
            const offset = midi * 12;
            if (intensity < 0.001) {
                plumes.positions.fill(0, offset, offset + 12);
                continue;
            }
            const rise = emitter.releaseAge * 1.35;
            const crestHeight = 4.35 + (0.5 + Math.sin(emitter.phase) * 0.5) * 0.45;
            const growth = 1.95 + emitter.velocity * 0.35 + Math.sin(emitter.phase) * 0.16;
            const height = Math.max(
                0.1,
                Math.min(crestHeight, 0.35 + (emitter.age - emitter.releaseAge) * growth) - rise
            );
            const bottom = emitter.y + 0.06 + rise;
            const width = 0.78 + emitter.velocity * 0.28;
            const upperLean = smoothstep(0.8, 4, height) * 0.48;
            const leanX = Math.cos(emitter.phase) * upperLean;
            const leanZ = Math.sin(emitter.phase) * upperLean * 0.75;
            // World-vertical cards turn only around Y, so tall streams stay rooted to their key.
            for (let corner = 0; corner < 4; corner++) {
                const side = corner === 0 || corner === 3 ? -1 : 1;
                const top = corner >= 2;
                const vertex = offset + corner * 3;
                plumes.positions[vertex] = emitter.x + sideX * width * side + (top ? leanX : 0);
                plumes.positions[vertex + 1] = bottom + (top ? height : 0);
                plumes.positions[vertex + 2] = emitter.z + sideZ * width * side + (top ? leanZ : 0);
            }
        }
        for (let index = 0; index < PARTICLE_CAPACITY; index++) {
            const particle = particles[index];
            if (!particle) continue;
            if (particle.lifetime === 0) continue;
            particle.age += step;
            const age = particle.age;
            const t = age / particle.lifetime;
            if (t >= 1) {
                for (const batch of particleBatches) {
                    writeColor(batch, index, 0, 0, 0, 0);
                    batch.positions.fill(0, index * 12, index * 12 + 12);
                }
                particle.lifetime = 0;
                continue;
            }
            const swirl = particle.phase + age * particle.twist;
            const elevation = age * particle.rise;
            const crown = smoothstep(0.8, 3.4, elevation);
            const radius = particle.spread * (0.22 + crown * 1.15);
            // Nearby grains follow the same broad current, with smaller independent eddies.
            const flow = elevation * 1.18 - seconds * 0.65 + particle.flowPhase;
            const flowWidth =
                (0.02 + elevation * 0.062 + crown * 0.24) * smoothstep(0, 1.6, elevation);
            // The crown drifts out of the rising stream instead of staying inside a pipe.
            const drift = Math.max(0, elevation - 0.9) ** 1.25 * 0.38;
            const x =
                particle.x +
                Math.sin(flow) * flowWidth +
                Math.cos(swirl) * radius +
                particle.driftX * drift;
            const y = particle.y + elevation + Math.sin(swirl * 0.72) * radius * 0.3;
            const z =
                particle.z +
                Math.cos(flow * 0.82) * flowWidth * 0.85 +
                Math.sin(swirl) * radius +
                particle.driftZ * drift;
            const size = particle.size * (1 - t * 0.18);
            const fade =
                smoothstep(0, 0.05, age) *
                (1 - smoothstep(0.5, 1, t)) *
                (1 - smoothstep(3.1, 4.85, elevation)) *
                particle.brightness;
            const shimmer = 0.76 + Math.sin(age * 8.2 + particle.phase) ** 2 * 0.24;
            const turn = particle.phase + age * 0.45;
            billboard(dust, index, x, y, z, size, size * (0.8 + particle.tint * 0.6), turn);
            writeColor(
                dust,
                index,
                0.03 + particle.tint * 0.07,
                0.88 + particle.tint * 0.68,
                1.9,
                fade * shimmer
            );
            billboard(
                wisps,
                index,
                x,
                y - size,
                z,
                size * (3.2 + particle.tint * 2),
                size * (5.2 + particle.tint * 2),
                turn * 0.7
            );
            writeColor(wisps, index, 0.008, 0.28 + particle.tint * 0.16, 1.05, fade * 0.065);
            const glintSize = 0.048 + size * 1.15;
            billboard(cores, index, x, y, z, glintSize, glintSize, turn);
            writeColor(cores, index, 1.65, 2.8, 3.4, fade * shimmer * particle.glint);
        }
        for (const batch of batches) {
            batch.vertices.isDirty = true;
            batch.colorData.isDirty = true;
        }
    }

    return {
        press(midi, position, velocity): void {
            if (disposed) return;
            const emitter = emitters[midi];
            if (!emitter) return;
            emitter.x = position.x;
            emitter.y = position.y;
            emitter.z = position.z;
            emitter.velocity = Math.max(0.1, Math.min(1, velocity));
            emitter.held = true;
            emitter.age = 0;
            emitter.releaseAge = 0;
            emitter.remainder = 0;
            emitter.envelope = Math.max(emitter.envelope, emitter.velocity * 0.75);
            if (enabled) emit(emitter, 22, true);
        },
        release(midi): void {
            const emitter = emitters[midi];
            if (!emitter) return;
            emitter.held = false;
            emitter.releaseAge = 0;
            emitter.remainder = 0;
        },
        update,
        setEnabled(value): void {
            if (disposed) return;
            enabled = value;
            root.visible = value;
            if (!value) {
                for (const particle of particles) particle.age = 10;
                for (const light of lights) light.amount = 0;
            }
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            root.destroy(stage.renderer);
            dustMask.destroy();
            wispMask.destroy();
            coreMask.destroy();
        }
    };
}
