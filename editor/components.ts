import type { SceneDocument, SceneNode, Vec3 } from './scene';
import type { AnimationClip } from './animation';

/** Portable collider dimensions are local meters; box size is its full width/height/depth. */
export interface PhysicsComponent {
    body: 'static' | 'dynamic' | 'kinematic';
    shape: 'box' | 'sphere' | 'capsule';
    size: Vec3;
    radius: number;
    halfHeight: number;
    mass: number;
    friction: number;
    restitution: number;
    sensor: boolean;
}

/** Bounded deterministic local-space CPU emitter supported by both rendering backends. */
export interface ParticleComponent {
    seed: number;
    maxParticles: number;
    rate: number;
    lifetime: number;
    speed: number;
    size: number;
    color: string;
    gravity: Vec3;
    shape: 'point' | 'box' | 'sphere';
    extent: Vec3;
    loop: boolean;
    duration: number;
}

/** An imported local PCM WAV source. Playback starts only after an explicit Play gesture. */
export interface AudioComponent {
    asset: string;
    autoplay: boolean;
    loop: boolean;
    volume: number;
    spatial: boolean;
    refDistance: number;
    maxDistance: number;
}

/** Optional authored features; absent components have no runtime allocation or side effects. */
export interface NodeComponents {
    physics?: PhysicsComponent;
    particles?: ParticleComponent;
    audio?: AudioComponent;
}

export const MAX_SCENE_PARTICLES = 32768;
export const MAX_SCENE_AUDIO_SOURCES = 32;

/** A detached initial rigid body with a one-meter box collider. */
export function defaultPhysicsComponent(): PhysicsComponent {
    return {
        body: 'dynamic',
        shape: 'box',
        size: { x: 1, y: 1, z: 1 },
        radius: 0.5,
        halfHeight: 0.5,
        mass: 1,
        friction: 0.5,
        restitution: 0.2,
        sensor: false
    };
}

/** A detached, repeatable upward emitter with a bounded particle capacity. */
export function defaultParticleComponent(): ParticleComponent {
    return {
        seed: 1,
        maxParticles: 256,
        rate: 30,
        lifetime: 2,
        speed: 2,
        size: 0.12,
        color: '#ffc078',
        gravity: { x: 0, y: -1, z: 0 },
        shape: 'point',
        extent: { x: 1, y: 1, z: 1 },
        loop: true,
        duration: 5
    };
}

/** A detached audio source configured for explicit-gesture playback. */
export function defaultAudioComponent(asset: string): AudioComponent {
    return {
        asset,
        autoplay: true,
        loop: false,
        volume: 0.75,
        spatial: true,
        refDistance: 1,
        maxDistance: 100
    };
}

function object(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error(`${path}: expected an object`);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`${path}: expected a plain object`);
    const result = value as Record<string, unknown>;
    for (const key of Object.keys(result))
        if (!allowed.includes(key)) throw new Error(`${path}.${key}: unknown field`);
    return result;
}
function number(value: unknown, path: string, min: number, max: number, integer = false): number {
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (integer && !Number.isSafeInteger(value))
    )
        throw new Error(
            `${path}: expected ${integer ? 'an integer' : 'a finite number'} between ${String(min)} and ${String(max)}`
        );
    return value === 0 ? 0 : value;
}
function boolean(value: unknown, path: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`${path}: expected a boolean`);
    return value;
}
function choice<T extends string>(value: unknown, path: string, choices: readonly T[]): T {
    for (const candidate of choices) if (candidate === value) return candidate;
    throw new Error(`${path}: expected ${choices.join(', ')}`);
}
function vector(value: unknown, path: string, min: number, max: number): Vec3 {
    const source = object(value, path, ['x', 'y', 'z']);
    return {
        x: number(source['x'], `${path}.x`, min, max),
        y: number(source['y'], `${path}.y`, min, max),
        z: number(source['z'], `${path}.z`, min, max)
    };
}

/** Validate unknown component data and return detached records in canonical property order. */
export function validateNodeComponents(value: unknown, path = 'components'): NodeComponents {
    const source = object(value, path, ['physics', 'particles', 'audio']);
    const result: NodeComponents = {};
    if (source['physics'] !== undefined) {
        const prefix = `${path}.physics`;
        const p = object(source['physics'], prefix, [
            'body',
            'shape',
            'size',
            'radius',
            'halfHeight',
            'mass',
            'friction',
            'restitution',
            'sensor'
        ]);
        result.physics = {
            body: choice(p['body'], `${prefix}.body`, ['static', 'dynamic', 'kinematic']),
            shape: choice(p['shape'], `${prefix}.shape`, ['box', 'sphere', 'capsule']),
            size: vector(p['size'], `${prefix}.size`, 0.001, 10000),
            radius: number(p['radius'], `${prefix}.radius`, 0.001, 10000),
            halfHeight: number(p['halfHeight'], `${prefix}.halfHeight`, 0.001, 10000),
            mass: number(p['mass'], `${prefix}.mass`, 0.001, 100000),
            friction: number(p['friction'], `${prefix}.friction`, 0, 10),
            restitution: number(p['restitution'], `${prefix}.restitution`, 0, 1),
            sensor: boolean(p['sensor'], `${prefix}.sensor`)
        };
    }
    if (source['particles'] !== undefined) {
        const prefix = `${path}.particles`;
        const p = object(source['particles'], prefix, [
            'seed',
            'maxParticles',
            'rate',
            'lifetime',
            'speed',
            'size',
            'color',
            'gravity',
            'shape',
            'extent',
            'loop',
            'duration'
        ]);
        if (typeof p['color'] !== 'string' || !/^#[\da-fA-F]{6}$/u.test(p['color']))
            throw new Error(`${prefix}.color: expected an sRGB color in #RRGGBB form`);
        result.particles = {
            seed: number(p['seed'], `${prefix}.seed`, 0, 4294967295, true),
            maxParticles: number(p['maxParticles'], `${prefix}.maxParticles`, 1, 4096, true),
            rate: number(p['rate'], `${prefix}.rate`, 0, 1000),
            lifetime: number(p['lifetime'], `${prefix}.lifetime`, 0.01, 60),
            speed: number(p['speed'], `${prefix}.speed`, 0, 1000),
            size: number(p['size'], `${prefix}.size`, 0.001, 100),
            color: p['color'].toLowerCase(),
            gravity: vector(p['gravity'], `${prefix}.gravity`, -1000, 1000),
            shape: choice(p['shape'], `${prefix}.shape`, ['point', 'box', 'sphere']),
            extent: vector(p['extent'], `${prefix}.extent`, 0.001, 1000),
            loop: boolean(p['loop'], `${prefix}.loop`),
            duration: number(p['duration'], `${prefix}.duration`, 0.01, 3600)
        };
    }
    if (
        result.particles?.shape === 'sphere' &&
        (result.particles.extent.x !== result.particles.extent.y ||
            result.particles.extent.x !== result.particles.extent.z)
    )
        throw new Error(`${path}.particles.extent: sphere emitters require equal radii`);
    if (source['audio'] !== undefined) {
        const prefix = `${path}.audio`;
        const a = object(source['audio'], prefix, [
            'asset',
            'autoplay',
            'loop',
            'volume',
            'spatial',
            'refDistance',
            'maxDistance'
        ]);
        const asset = a['asset'];
        if (
            typeof asset !== 'string' ||
            asset.length > 64 ||
            !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(asset) ||
            asset === 'constructor' ||
            asset === 'prototype'
        )
            throw new Error(`${prefix}.asset: expected a stable asset ID`);
        result.audio = {
            asset,
            autoplay: boolean(a['autoplay'], `${prefix}.autoplay`),
            loop: boolean(a['loop'], `${prefix}.loop`),
            volume: number(a['volume'], `${prefix}.volume`, 0, 1),
            spatial: boolean(a['spatial'], `${prefix}.spatial`),
            refDistance: number(a['refDistance'], `${prefix}.refDistance`, 0.01, 10000),
            maxDistance: number(a['maxDistance'], `${prefix}.maxDistance`, 0.01, 100000)
        };
        if (result.audio.maxDistance < result.audio.refDistance)
            throw new Error(`${prefix}.maxDistance: must be at least refDistance`);
    }
    return result;
}

/** Reject authoring that conflicts with rigid-body ownership or changes baked collider scale. */
export function validateSceneComponents(
    scene: Pick<SceneDocument, 'nodes'>,
    clips: readonly AnimationClip[] = []
): void {
    const animated = new Map<string, { motion: string; scale?: string }>();
    for (const clip of clips) {
        for (const track of clip.tracks) {
            if (!track.keys.length) continue;
            const reason = `animation ${clip.name} conflicts with ${track.property}`;
            const entry = animated.get(track.nodeId) ?? { motion: reason };
            if (track.property.startsWith('scale.') && !entry.scale) entry.scale = reason;
            animated.set(track.nodeId, entry);
        }
    }
    let capacity = 0;
    let audioSources = 0;
    for (const [nodeId, node] of Object.entries(scene.nodes)) {
        capacity += node.components?.particles?.maxParticles ?? 0;
        if (node.components?.audio) audioSources += 1;
        const physics = node.components?.physics;
        if (!physics) continue;
        const scale = node.transform.scale;
        if (physics.shape !== 'box' && (scale.x !== scale.y || scale.x !== scale.z))
            throw new Error(
                `Physics ${nodeId}: sphere and capsule colliders require uniform scale`
            );
        const visited = new Set<string>();
        let current: string | null = nodeId;
        while (current !== null) {
            if (visited.has(current)) throw new Error(`Physics ${nodeId}: parent cycle`);
            visited.add(current);
            const ancestor: SceneNode | undefined = scene.nodes[current];
            if (!ancestor) throw new Error(`Physics ${nodeId}: missing ancestor ${current}`);
            if (
                current !== nodeId &&
                Object.values(ancestor.transform.scale).some(value => value !== 1)
            )
                throw new Error(`Physics ${nodeId}: physics ancestors require unit scale`);
            if (physics.body === 'dynamic' && current !== nodeId && ancestor.scripts?.length)
                throw new Error(
                    `Physics ${nodeId}: ancestors of dynamic bodies cannot attach transform scripts; use a kinematic body`
                );
            const animation = animated.get(current);
            const conflict = physics.body === 'dynamic' ? animation?.motion : animation?.scale;
            if (conflict)
                throw new Error(
                    `Physics ${nodeId}: ${conflict}; collider scale is fixed and dynamic transforms belong to physics`
                );
            current = ancestor.parent;
        }
    }
    if (capacity > MAX_SCENE_PARTICLES)
        throw new Error(`Scene particle capacity exceeds ${String(MAX_SCENE_PARTICLES)}`);
    if (audioSources > MAX_SCENE_AUDIO_SOURCES)
        throw new Error(`Scene audio source count exceeds ${String(MAX_SCENE_AUDIO_SOURCES)}`);
}
