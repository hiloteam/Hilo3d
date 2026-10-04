/** Editable vector components; positions use meters and rotations use degrees. */
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

/** A named, shareable physically based material. Colors are sRGB hexadecimal values. */
export interface SceneMaterial {
    name: string;
    color: string;
    metallic: number;
    roughness: number;
    baseColorTexture?: string;
    normalTexture?: string;
    metallicRoughnessTexture?: string;
    emissiveTexture?: string;
    emissiveColor?: string;
}

/** Authoring data only: stable record keys provide identity independently of display names. */
export interface SceneNode {
    name: string;
    type: 'group' | 'mesh' | 'light' | 'model' | 'camera';
    parent: string | null;
    visible: boolean;
    locked?: boolean;
    asset?: string;
    scripts?: string[];
    camera?: { fov: number; near: number; far: number };
    transform: {
        position: Vec3;
        rotation: Vec3;
        scale: Vec3;
    };
    geometry?: 'cube' | 'sphere' | 'cylinder' | 'plane';
    material?: string;
    light?: {
        kind: 'directional' | 'ambient';
        color: string;
        intensity: number;
    };
}

/** Versioned scene source, designed for focused human and AI edits and readable Git diffs. */
export interface SceneDocument {
    format: 'hilo3d-scene';
    version: 2;
    name: string;
    units: 'meters';
    environment: {
        background: string;
        ambientIntensity: number;
    };
    materials: Record<string, SceneMaterial>;
    nodes: Record<string, SceneNode>;
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 1_000;
const MAX_MATERIALS = 256;
const MAX_DEPTH = 64;
const MAX_DIRECTIONAL_LIGHTS = 8;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const COLOR_PATTERN = /^#[\da-fA-F]{6}$/;
const RESERVED_IDS = new Set(['constructor', 'prototype']);

function invalid(path: string, message: string): never {
    throw new Error(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid(path, 'expected an object');
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        invalid(path, 'expected a plain object');
    }
    return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, path: string, allowed: readonly string[]): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) invalid(`${path}.${key}`, 'unknown field');
    }
}

function text(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 120) {
        invalid(path, 'expected a nonempty name of at most 120 characters');
    }
    return value;
}

function identifier(value: unknown, path: string): string {
    if (
        typeof value !== 'string' ||
        value.length > 64 ||
        !ID_PATTERN.test(value) ||
        RESERVED_IDS.has(value)
    ) {
        invalid(path, 'expected a stable kebab-case ID of at most 64 characters');
    }
    return value;
}

function number(value: unknown, path: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        invalid(path, `expected a finite number between ${String(min)} and ${String(max)}`);
    }
    return value === 0 ? 0 : value;
}

function color(value: unknown, path: string): string {
    if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
        invalid(path, 'expected an sRGB color in #RRGGBB form');
    }
    return value.toLowerCase();
}

function vector(value: unknown, path: string, min: number, max: number): Vec3 {
    const input = record(value, path);
    fields(input, path, ['x', 'y', 'z']);
    return {
        x: number(input['x'], `${path}.x`, min, max),
        y: number(input['y'], `${path}.y`, min, max),
        z: number(input['z'], `${path}.z`, min, max)
    };
}

function material(value: unknown, path: string): SceneMaterial {
    const input = record(value, path);
    fields(input, path, [
        'name',
        'color',
        'metallic',
        'roughness',
        'baseColorTexture',
        'normalTexture',
        'metallicRoughnessTexture',
        'emissiveTexture',
        'emissiveColor'
    ]);
    const result: SceneMaterial = {
        name: text(input['name'], `${path}.name`),
        color: color(input['color'], `${path}.color`),
        metallic: number(input['metallic'], `${path}.metallic`, 0, 1),
        roughness: number(input['roughness'], `${path}.roughness`, 0, 1)
    };
    for (const slot of [
        'baseColorTexture',
        'normalTexture',
        'metallicRoughnessTexture',
        'emissiveTexture'
    ] as const) {
        if (input[slot] !== undefined) result[slot] = identifier(input[slot], `${path}.${slot}`);
    }
    if (input['emissiveColor'] !== undefined)
        result.emissiveColor = color(input['emissiveColor'], `${path}.emissiveColor`);
    return result;
}

/** Validate script/gesture transform messages without reserializing an entire scene per frame. */
export function validateTransform(value: unknown, path = 'transform'): SceneNode['transform'] {
    const transform = record(value, path);
    fields(transform, path, ['position', 'rotation', 'scale']);
    return {
        position: vector(transform['position'], `${path}.position`, -10_000, 10_000),
        rotation: vector(transform['rotation'], `${path}.rotation`, -360_000, 360_000),
        scale: vector(transform['scale'], `${path}.scale`, 0.001, 10_000)
    };
}

function node(value: unknown, path: string): SceneNode {
    const input = record(value, path);
    fields(input, path, [
        'name',
        'type',
        'parent',
        'visible',
        'transform',
        'geometry',
        'material',
        'light',
        'locked',
        'asset',
        'scripts',
        'camera'
    ]);
    const kind = input['type'];
    if (
        kind !== 'group' &&
        kind !== 'mesh' &&
        kind !== 'light' &&
        kind !== 'model' &&
        kind !== 'camera'
    ) {
        invalid(`${path}.type`, 'expected group, mesh, model, camera, or light');
    }
    if (typeof input['visible'] !== 'boolean') invalid(`${path}.visible`, 'expected a boolean');
    const result: SceneNode = {
        name: text(input['name'], `${path}.name`),
        type: kind,
        parent: input['parent'] === null ? null : identifier(input['parent'], `${path}.parent`),
        visible: input['visible'],
        transform: validateTransform(input['transform'], `${path}.transform`)
    };
    if (input['locked'] !== undefined) {
        if (typeof input['locked'] !== 'boolean') invalid(`${path}.locked`, 'expected a boolean');
        result.locked = input['locked'];
    }
    if (input['scripts'] !== undefined) {
        const scripts = input['scripts'];
        if (!Array.isArray(scripts) || scripts.length > 16)
            invalid(`${path}.scripts`, 'expected at most 16 script IDs');
        result.scripts = scripts.map((script: unknown, index: number) =>
            identifier(script, `${path}.scripts.${String(index)}`)
        );
        if (new Set(result.scripts).size !== result.scripts.length)
            invalid(`${path}.scripts`, 'duplicate script ID');
    }
    if (kind === 'model') {
        result.asset = identifier(input['asset'], `${path}.asset`);
        if (input['material'] !== undefined)
            result.material = identifier(input['material'], `${path}.material`);
    } else if (Object.hasOwn(input, 'asset')) invalid(path, 'only model nodes may define asset');
    if (kind === 'camera') {
        const settings = record(input['camera'], `${path}.camera`);
        fields(settings, `${path}.camera`, ['fov', 'near', 'far']);
        result.camera = {
            fov: number(settings['fov'], `${path}.camera.fov`, 1, 170),
            near: number(settings['near'], `${path}.camera.near`, 0.001, 1000),
            far: number(settings['far'], `${path}.camera.far`, 0.01, 100000)
        };
        if (result.camera.far <= result.camera.near)
            invalid(`${path}.camera`, 'far must be greater than near');
    } else if (Object.hasOwn(input, 'camera')) invalid(path, 'only camera nodes may define camera');
    if (kind === 'mesh') {
        const geometry = input['geometry'];
        if (
            geometry !== 'cube' &&
            geometry !== 'sphere' &&
            geometry !== 'cylinder' &&
            geometry !== 'plane'
        ) {
            invalid(`${path}.geometry`, 'expected cube, sphere, cylinder, or plane');
        }
        result.geometry = geometry;
        result.material = identifier(input['material'], `${path}.material`);
    } else if (
        Object.hasOwn(input, 'geometry') ||
        (kind !== 'model' && Object.hasOwn(input, 'material'))
    ) {
        invalid(path, 'only mesh nodes may define geometry or material');
    }
    if (kind === 'light') {
        const light = record(input['light'], `${path}.light`);
        fields(light, `${path}.light`, ['kind', 'color', 'intensity']);
        if (light['kind'] !== 'directional' && light['kind'] !== 'ambient') {
            invalid(`${path}.light.kind`, 'expected directional or ambient');
        }
        result.light = {
            kind: light['kind'],
            color: color(light['color'], `${path}.light.color`),
            intensity: number(light['intensity'], `${path}.light.intensity`, 0, 100)
        };
    } else if (Object.hasOwn(input, 'light')) {
        invalid(path, 'only light nodes may define light properties');
    }
    return result;
}

function validate(value: unknown): SceneDocument {
    const input = record(value, 'scene');
    fields(input, 'scene', [
        'format',
        'version',
        'name',
        'units',
        'environment',
        'materials',
        'nodes'
    ]);
    if (input['format'] !== 'hilo3d-scene') invalid('scene.format', 'expected hilo3d-scene');
    if (input['version'] !== 1 && input['version'] !== 2)
        invalid('scene.version', 'only versions 1 and 2 are supported');
    if (input['units'] !== 'meters') invalid('scene.units', 'expected meters');
    const environment = record(input['environment'], 'scene.environment');
    fields(environment, 'scene.environment', ['background', 'ambientIntensity']);
    const inputMaterials = record(input['materials'], 'scene.materials');
    const inputNodes = record(input['nodes'], 'scene.nodes');
    if (input['version'] === 1) {
        for (const [id, entry] of Object.entries(inputMaterials)) {
            const legacy = record(entry, `scene.materials.${id}`);
            fields(legacy, `scene.materials.${id} (version 1)`, [
                'name',
                'color',
                'metallic',
                'roughness'
            ]);
        }
        for (const [id, entry] of Object.entries(inputNodes)) {
            const legacy = record(entry, `scene.nodes.${id}`);
            fields(legacy, `scene.nodes.${id} (version 1)`, [
                'name',
                'type',
                'parent',
                'visible',
                'transform',
                'geometry',
                'material',
                'light'
            ]);
            if (
                legacy['type'] !== 'group' &&
                legacy['type'] !== 'mesh' &&
                legacy['type'] !== 'light'
            )
                invalid(`scene.nodes.${id}.type`, 'this node type requires scene version 2');
        }
    }
    const materialIds = Object.keys(inputMaterials).sort();
    const nodeIds = Object.keys(inputNodes).sort();
    if (materialIds.length > MAX_MATERIALS)
        invalid('scene.materials', `limit is ${String(MAX_MATERIALS)}`);
    if (nodeIds.length > MAX_NODES) invalid('scene.nodes', `limit is ${String(MAX_NODES)}`);
    const materials: Record<string, SceneMaterial> = {};
    const nodes: Record<string, SceneNode> = {};
    for (const id of materialIds) {
        identifier(id, `scene.materials.${id}`);
        materials[id] = material(inputMaterials[id], `scene.materials.${id}`);
    }
    for (const id of nodeIds) {
        identifier(id, `scene.nodes.${id}`);
        nodes[id] = node(inputNodes[id], `scene.nodes.${id}`);
    }
    const directionalLights = Object.values(nodes).filter(
        item => item.light?.kind === 'directional'
    );
    if (directionalLights.length > MAX_DIRECTIONAL_LIGHTS) {
        invalid(
            'scene.nodes',
            `directional light limit is ${String(MAX_DIRECTIONAL_LIGHTS)} (including hidden lights)`
        );
    }
    for (const [id, item] of Object.entries(nodes)) {
        if (item.material !== undefined && !Object.hasOwn(materials, item.material)) {
            invalid(`scene.nodes.${id}.material`, `missing material "${item.material}"`);
        }
        const visited = new Set([id]);
        let parent = item.parent;
        while (parent !== null) {
            if (visited.has(parent)) invalid(`scene.nodes.${id}.parent`, 'parent cycle detected');
            const ancestor = nodes[parent];
            if (!ancestor) invalid(`scene.nodes.${id}.parent`, `missing node "${parent}"`);
            visited.add(parent);
            if (visited.size > MAX_DEPTH)
                invalid(`scene.nodes.${id}.parent`, `maximum depth is ${String(MAX_DEPTH)}`);
            parent = ancestor.parent;
        }
    }
    const result: SceneDocument = {
        format: 'hilo3d-scene',
        version: 2,
        name: text(input['name'], 'scene.name'),
        units: 'meters',
        environment: {
            background: color(environment['background'], 'scene.environment.background'),
            ambientIntensity: number(
                environment['ambientIntensity'],
                'scene.environment.ambientIntensity',
                0,
                10
            )
        },
        materials,
        nodes
    };
    const canonical = JSON.stringify(result, null, 2);
    if (
        canonical.length + 1 > MAX_TEXT_BYTES ||
        new TextEncoder().encode(canonical).byteLength + 1 > MAX_TEXT_BYTES
    )
        invalid('scene', 'canonical document exceeds the 2 MiB limit');
    return result;
}

/** Parse untrusted scene JSON. Reject unsupported versions, unknown fields, bad references and cycles. */
export function parseScene(source: string): SceneDocument {
    if (
        source.length > MAX_TEXT_BYTES ||
        new TextEncoder().encode(source).byteLength > MAX_TEXT_BYTES
    ) {
        invalid('scene', 'document exceeds the 2 MiB limit');
    }
    let value: unknown;
    try {
        value = JSON.parse(source) as unknown;
    } catch {
        invalid('scene', 'invalid JSON; check commas, quotes, and brackets');
    }
    return validate(value);
}

/** Validate and emit deterministic, two-space JSON with sorted IDs and a final newline. */
export function serializeScene(scene: SceneDocument): string {
    return `${JSON.stringify(validate(scene), null, 2)}\n`;
}

/** Return a validated, fully detached scene snapshot. */
export function cloneScene(scene: SceneDocument): SceneDocument {
    return validate(scene);
}

/** Create a warm material study with reusable materials and readable semantic object IDs. */
export function createDefaultScene(): SceneDocument {
    const transform = (
        position: Vec3,
        scale: Vec3,
        rotation: Vec3 = { x: 0, y: 0, z: 0 }
    ): SceneNode['transform'] => ({
        position,
        rotation,
        scale
    });
    const mesh = (
        name: string,
        geometry: NonNullable<SceneNode['geometry']>,
        materialId: string,
        position: Vec3,
        scale: Vec3,
        rotation?: Vec3
    ): SceneNode => ({
        name,
        type: 'mesh',
        parent: 'sculpture',
        visible: true,
        transform: transform(position, scale, rotation),
        geometry,
        material: materialId
    });
    return cloneScene({
        format: 'hilo3d-scene',
        version: 2,
        name: 'Terracotta Study',
        units: 'meters',
        environment: { background: '#343639', ambientIntensity: 0.8 },
        materials: {
            terracotta: { name: 'Terracotta', color: '#cb765b', metallic: 0.05, roughness: 0.64 },
            porcelain: { name: 'Warm Porcelain', color: '#e8decb', metallic: 0, roughness: 0.36 },
            charcoal: { name: 'Charcoal', color: '#45484b', metallic: 0.08, roughness: 0.58 },
            sand: { name: 'Sandstone', color: '#b2a18b', metallic: 0, roughness: 0.82 },
            ground: { name: 'Studio Ground', color: '#3b3d41', metallic: 0, roughness: 0.94 }
        },
        nodes: {
            sculpture: {
                name: 'Sculpture',
                type: 'group',
                parent: null,
                visible: true,
                transform: transform({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
            },
            'hero-plinth': mesh(
                '01 · Terracotta Plinth',
                'cylinder',
                'terracotta',
                { x: 0, y: 0.6, z: 0 },
                { x: 1.8, y: 1.2, z: 1.8 }
            ),
            'hero-sphere': mesh(
                '02 · Porcelain Sphere',
                'sphere',
                'porcelain',
                { x: 0, y: 1.86, z: 0 },
                { x: 1.32, y: 1.32, z: 1.32 }
            ),
            'side-plinth': mesh(
                '03 · Sandstone Block',
                'cube',
                'sand',
                { x: -1.75, y: 0.4, z: -0.3 },
                { x: 1.1, y: 0.8, z: 1.1 },
                { x: 0, y: -12, z: 0 }
            ),
            'side-sphere': mesh(
                '04 · Clay Sphere',
                'sphere',
                'terracotta',
                { x: -1.75, y: 1.12, z: -0.3 },
                { x: 0.64, y: 0.64, z: 0.64 }
            ),
            'small-block': mesh(
                '05 · Charcoal Block',
                'cube',
                'charcoal',
                { x: 1.65, y: 0.48, z: 0.35 },
                { x: 0.96, y: 0.96, z: 0.96 },
                { x: 0, y: 18, z: 0 }
            ),
            'foreground-sphere': mesh(
                '06 · Clay Pebble',
                'sphere',
                'terracotta',
                { x: -0.7, y: 0.28, z: 1.35 },
                { x: 0.56, y: 0.56, z: 0.56 }
            ),
            ground: {
                ...mesh(
                    'Studio Ground',
                    'plane',
                    'ground',
                    { x: 0, y: -0.1, z: 0 },
                    { x: 200, y: 1, z: 200 }
                ),
                parent: null
            },
            'key-light': {
                name: 'Key Light',
                type: 'light',
                parent: null,
                visible: true,
                transform: transform(
                    { x: 3, y: 6, z: 4 },
                    { x: 1, y: 1, z: 1 },
                    { x: -42, y: 32, z: 0 }
                ),
                light: { kind: 'directional', color: '#fff0dc', intensity: 2.7 }
            }
        }
    });
}

/** Bounded, immutable transaction history. Call commit once per completed authoring gesture. */
export class SceneHistory {
    private readonly entries: string[];
    private index = 0;

    constructor(initial: SceneDocument) {
        this.entries = [serializeScene(initial)];
    }

    /** A detached copy of the current document. */
    get scene(): SceneDocument {
        const current = this.entries[this.index];
        if (current === undefined) throw new Error('Scene history is empty');
        return parseScene(current);
    }

    get canUndo(): boolean {
        return this.index > 0;
    }

    get canRedo(): boolean {
        return this.index < this.entries.length - 1;
    }

    /** Record a validated change; identical content does not discard the redo branch. */
    commit(next: SceneDocument): boolean {
        const serialized = serializeScene(next);
        if (serialized === this.entries[this.index]) return false;
        this.entries.splice(this.index + 1);
        this.entries.push(serialized);
        if (this.entries.length > 80) this.entries.shift();
        this.index = this.entries.length - 1;
        return true;
    }

    undo(): SceneDocument {
        if (this.canUndo) this.index -= 1;
        return this.scene;
    }

    redo(): SceneDocument {
        if (this.canRedo) this.index += 1;
        return this.scene;
    }
}
