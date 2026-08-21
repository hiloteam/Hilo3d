import Geometry from '../geometry/Geometry';
import Texture from '../texture/Texture';
import {
    compileParticleSystemDefinition,
    type ParticleCompilationEnvironment
} from './ParticleCompiler';
import ParticleCurve, { type ParticleCurveKeyframe } from './ParticleCurve';
import ParticleGradient, { type ParticleGradientKey } from './ParticleGradient';
import {
    ParticleParameter,
    type ParticleParameterType,
    type ParticleParameterValue
} from './ParticleParameter';
import ParticleSystemDefinition from './ParticleSystemDefinition';
import {
    PARTICLE_DEFINITION_VERSION,
    type ParticleEmitterDefinitionInput,
    type ParticleSystemDefinitionInput
} from './ParticleTypes';

/** Stable identifier stored at the root of every serialized particle definition. */
export const PARTICLE_DEFINITION_SCHEMA = 'hilo3d.particle-system' as const;

/** JSON value accepted by the version upgrade and definition serialization APIs. */
export type ParticleDefinitionJSONValue =
    | null
    | boolean
    | number
    | string
    | ParticleDefinitionJSONRecord
    | readonly ParticleDefinitionJSONValue[];

/** JSON object accepted by the version upgrade and definition serialization APIs. */
export interface ParticleDefinitionJSONRecord {
    readonly [key: string]: ParticleDefinitionJSONValue;
}

/** One serialized parameter declaration referenced by stable document-local identity. */
export interface ParticleDefinitionJSONParameter extends ParticleDefinitionJSONRecord {
    /** Stable document-local identity used by parameter reference tags. */
    readonly id: string;
    /** Public runtime parameter name. */
    readonly name: string;
    /** Runtime value kind enforced when the parameter token is recreated. */
    readonly type: ParticleParameterType;
    /** Tagged JSON representation of the immutable default value. */
    readonly defaultValue: ParticleDefinitionJSONValue;
}

/** Current versioned JSON representation of an immutable particle-system definition. */
export interface ParticleSystemDefinitionJSON extends ParticleDefinitionJSONRecord {
    /** Stable particle document family identifier. */
    readonly schema: typeof PARTICLE_DEFINITION_SCHEMA;
    /** Current particle document schema version. */
    readonly version: typeof PARTICLE_DEFINITION_VERSION;
    /** Shared parameter declarations referenced by emitters. */
    readonly parameters: readonly ParticleDefinitionJSONParameter[];
    /** Serialized emitter authoring records. */
    readonly emitters: readonly ParticleDefinitionJSONRecord[];
}

/** Opaque engine resource kinds represented by stable application-owned asset identifiers. */
export type ParticleDefinitionResourceKind = 'texture' | 'geometry';

/** Opaque engine resources that require application-owned identifiers in JSON. */
export type ParticleDefinitionResource = Texture<unknown> | Geometry;

/** Options used while converting a runtime definition into portable JSON data. */
export interface ParticleDefinitionSerializationOptions {
    /** Return a stable asset identifier for every Texture or Geometry encountered. */
    readonly getResourceId?: (
        resource: ParticleDefinitionResource,
        kind: ParticleDefinitionResourceKind
    ) => string;
}

/** One sequential JSON schema upgrade. The returned document must use `fromVersion + 1`. */
export interface ParticleDefinitionUpgrade {
    /** Source version accepted by this step. */
    readonly fromVersion: number;
    /** Produce a plain JSON document whose version is exactly `fromVersion + 1`. */
    readonly upgrade: (
        document: Readonly<ParticleDefinitionJSONRecord>
    ) => Readonly<ParticleDefinitionJSONRecord>;
}

/** Options used while upgrading and materializing a serialized definition. */
export interface ParticleDefinitionDeserializationOptions {
    /** Resolve stable asset identifiers without embedding runtime object IDs in the document. */
    readonly resolveResource?: (
        kind: ParticleDefinitionResourceKind,
        id: string
    ) => ParticleDefinitionResource;
    /** Sequential application-owned upgrades for schema versions older than the engine version. */
    readonly upgrades?: readonly ParticleDefinitionUpgrade[];
    /** Optional compile target used for backend-specific definition validation. */
    readonly compilationEnvironment?: Readonly<ParticleCompilationEnvironment>;
}

type MutableJSONRecord = Record<string, ParticleDefinitionJSONValue>;

const PARAMETER_TYPES = new Set<ParticleParameterType>([
    'float',
    'uint',
    'boolean',
    'vector2',
    'vector3',
    'vector4',
    'color',
    'texture',
    'curve',
    'gradient'
]);

function isParticleParameter(value: unknown): value is ParticleParameter {
    return value instanceof ParticleParameter;
}

const EMITTER_KEYS = new Set([
    'name',
    'capacity',
    'execution',
    'duration',
    'looping',
    'startDelay',
    'prewarm',
    'fixedStep',
    'maxCatchUpSteps',
    'simulationSpace',
    'overflow',
    'culling',
    'eventCapacity',
    'eventOverflow',
    'bounds',
    'emission',
    'shape',
    'initialize',
    'modules',
    'renderers'
]);

const MODULE_KEYS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
    'velocity-over-lifetime': new Set(['type', 'velocity', 'space']),
    'force-over-lifetime': new Set(['type', 'force', 'space']),
    gravity: new Set(['type', 'force', 'space']),
    wind: new Set(['type', 'force', 'space']),
    drag: new Set(['type', 'coefficient']),
    'limit-velocity': new Set(['type', 'limit', 'dampen']),
    'inherit-emitter-velocity': new Set(['type', 'multiplier']),
    noise: new Set([
        'type',
        'mode',
        'field',
        'strength',
        'frequency',
        'octaves',
        'lacunarity',
        'persistence',
        'scrollVelocity',
        'damping',
        'space',
        'seedOffset'
    ]),
    'alpha-over-lifetime': new Set(['type', 'curve', 'cycles']),
    'size-over-lifetime': new Set(['type', 'curve', 'cycles']),
    'rotation-over-lifetime': new Set(['type', 'curve', 'cycles']),
    'frame-over-lifetime': new Set(['type', 'curve', 'cycles']),
    'color-over-lifetime': new Set(['type', 'gradient']),
    'size-by-speed': new Set(['type', 'speedRange', 'curve']),
    'rotation-by-speed': new Set(['type', 'speedRange', 'curve']),
    'color-by-speed': new Set(['type', 'speedRange', 'gradient']),
    'texture-sheet': new Set(['type', 'mode', 'rows', 'columns', 'cycles', 'fps', 'speedRange']),
    'radial-force': new Set(['type', 'center', 'strength', 'axis']),
    'orbital-force': new Set(['type', 'center', 'strength', 'axis']),
    'vortex-force': new Set(['type', 'center', 'strength', 'axis']),
    'point-attraction': new Set(['type', 'point', 'lineStart', 'lineEnd', 'strength']),
    'line-attraction': new Set(['type', 'point', 'lineStart', 'lineEnd', 'strength']),
    'rotate-around-point': new Set(['type', 'center', 'axis', 'angularSpeed']),
    'conform-sphere': new Set(['type', 'center', 'radius', 'strength']),
    'lifetime-by-emitter-speed': new Set(['type', 'speedRange', 'lifetimeRange']),
    'kill-speed': new Set(['type', 'range']),
    'kill-distance': new Set(['type', 'range']),
    'kill-plane': new Set(['type', 'center', 'size', 'radius', 'normal', 'offset', 'mode']),
    'kill-box': new Set(['type', 'center', 'size', 'radius', 'normal', 'offset', 'mode']),
    'kill-sphere': new Set(['type', 'center', 'size', 'radius', 'normal', 'offset', 'mode']),
    'camera-offset': new Set(['type', 'range', 'scale']),
    'camera-fade': new Set(['type', 'range', 'scale']),
    'screen-space-size': new Set(['type', 'range', 'scale']),
    'custom-channel': new Set(['type', 'name', 'valueType', 'value']),
    'vector-field': new Set(['type', 'texture', 'strength']),
    collision: new Set([
        'type',
        'colliders',
        'bounce',
        'friction',
        'radiusScale',
        'lifetimeLoss',
        'event'
    ]),
    trigger: new Set(['type', 'volumes', 'events']),
    'scene-depth-collision': new Set(['type', 'thickness', 'bounce', 'friction', 'event']),
    'sub-emitter': new Set(['type', 'event', 'emitter', 'count', 'inheritVelocity'])
});

const SURFACE_KEYS = [
    'texture',
    'coverage',
    'alphaCutoff',
    'blend',
    'lighting',
    'depthTest',
    'depthWrite',
    'sort',
    'renderOrder',
    'composition'
] as const;

const RENDERER_KEYS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
    sprite: new Set([
        'type',
        'texture',
        'alignment',
        'blend',
        'depthTest',
        'depthWrite',
        'sort',
        'renderOrder',
        'pivot',
        'stretchScale',
        'softParticle'
    ]),
    mesh: new Set(['type', 'meshes', 'orientation', 'motionVectors', ...SURFACE_KEYS]),
    ribbon: new Set([
        'type',
        'facing',
        'widthScale',
        'uvMode',
        'tilesPerUnit',
        'softParticle',
        ...SURFACE_KEYS
    ]),
    trail: new Set([
        'type',
        'facing',
        'widthScale',
        'uvMode',
        'tilesPerUnit',
        'softParticle',
        ...SURFACE_KEYS
    ])
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
    return value;
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label} must be a non-empty string`);
    }
    return value;
}

function requireExactKeys(
    record: Readonly<Record<string, unknown>>,
    allowed: ReadonlySet<string>,
    label: string
): void {
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) throw new TypeError(`${label}.${key} is not part of the schema`);
    }
}

function requireArray(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}

function snapshotJSON(
    value: unknown,
    label: string,
    seen = new Set<object>()
): ParticleDefinitionJSONValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`${label} must contain finite numbers`);
        return value;
    }
    if (typeof value !== 'object') throw new TypeError(`${label} contains a non-JSON value`);
    if (seen.has(value)) throw new TypeError(`${label} contains a cycle`);
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return Object.freeze(
                value.map((item, index) => snapshotJSON(item, `${label}[${String(index)}]`, seen))
            );
        }
        const prototype = Object.getPrototypeOf(value) as object | null;
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${label} must contain only JSON objects`);
        }
        const source = value as Readonly<Record<string, unknown>>;
        const result: MutableJSONRecord = {};
        for (const key of Object.keys(source).sort()) {
            result[key] = snapshotJSON(source[key], `${label}.${key}`, seen);
        }
        return Object.freeze(result);
    } finally {
        seen.delete(value);
    }
}

function requireJSONRecord(
    value: ParticleDefinitionJSONValue,
    label: string
): Readonly<ParticleDefinitionJSONRecord> {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new TypeError(`${label} must be a JSON object`);
    }
    return value as Readonly<ParticleDefinitionJSONRecord>;
}

function requireVersion(record: Readonly<ParticleDefinitionJSONRecord>, label: string): number {
    const version = record['version'];
    if (!Number.isSafeInteger(version) || typeof version !== 'number' || version < 0) {
        throw new TypeError(`${label}.version must be a non-negative safe integer`);
    }
    return version;
}

function upgradeDocument(
    source: unknown,
    upgrades: readonly ParticleDefinitionUpgrade[]
): Readonly<ParticleDefinitionJSONRecord> {
    let document = requireJSONRecord(
        snapshotJSON(source, 'Particle definition JSON'),
        'Particle definition JSON'
    );
    let version = requireVersion(document, 'Particle definition JSON');
    if (version > PARTICLE_DEFINITION_VERSION) {
        throw new RangeError(
            `Particle definition version ${String(version)} is newer than supported version ${String(PARTICLE_DEFINITION_VERSION)}`
        );
    }
    const steps = new Map<number, ParticleDefinitionUpgrade>();
    for (const step of upgrades) {
        if (!Number.isSafeInteger(step.fromVersion) || step.fromVersion < 0) {
            throw new TypeError(
                'Particle definition upgrade fromVersion must be a non-negative safe integer'
            );
        }
        if (steps.has(step.fromVersion)) {
            throw new TypeError(
                `Particle definition has duplicate upgrade from version ${String(step.fromVersion)}`
            );
        }
        steps.set(step.fromVersion, step);
    }
    while (version < PARTICLE_DEFINITION_VERSION) {
        const step = steps.get(version);
        if (!step) {
            throw new RangeError(
                `Particle definition has no upgrade from version ${String(version)}`
            );
        }
        const upgraded = requireJSONRecord(
            snapshotJSON(step.upgrade(document), `Particle definition upgrade ${String(version)}`),
            `Particle definition upgrade ${String(version)}`
        );
        const nextVersion = requireVersion(
            upgraded,
            `Particle definition upgrade ${String(version)}`
        );
        if (nextVersion !== version + 1) {
            throw new RangeError(
                `Particle definition upgrade ${String(version)} must produce version ${String(version + 1)}`
            );
        }
        document = upgraded;
        version = nextVersion;
    }
    return document;
}

function normalizedEmitterRecord(emitter: ParticleSystemDefinition['emitters'][number]): object {
    return {
        name: emitter.name,
        capacity: emitter.capacity,
        execution: emitter.execution,
        duration: emitter.duration,
        looping: emitter.looping,
        startDelay: emitter.startDelay,
        prewarm: emitter.prewarm,
        fixedStep: emitter.fixedStep,
        maxCatchUpSteps: emitter.maxCatchUpSteps,
        simulationSpace: emitter.simulationSpace,
        overflow: emitter.overflow,
        culling: emitter.culling,
        eventCapacity: emitter.eventCapacity,
        eventOverflow: emitter.eventOverflow,
        bounds: emitter.bounds,
        emission: emitter.emission,
        shape: emitter.shape,
        initialize: emitter.initialize,
        modules: emitter.modules,
        renderers: emitter.renderers
    };
}

interface EncodeContext {
    readonly options: Readonly<ParticleDefinitionSerializationOptions>;
    readonly parameterIds: Map<ParticleParameter, string>;
    readonly parameters: ParticleDefinitionJSONParameter[];
    readonly resources: Map<string, ParticleDefinitionResource>;
    readonly seen: Set<object>;
}

function requireResourceId(
    resource: ParticleDefinitionResource,
    kind: ParticleDefinitionResourceKind,
    context: EncodeContext
): string {
    const getResourceId = context.options.getResourceId;
    if (!getResourceId) {
        throw new TypeError(
            `Particle definition contains a ${kind} resource; getResourceId is required for serialization`
        );
    }
    const id = requireString(getResourceId(resource, kind), `Particle ${kind} resource id`);
    const key = `${kind}\u0000${id}`;
    const previous = context.resources.get(key);
    if (previous !== undefined && previous !== resource) {
        throw new TypeError(`Particle ${kind} resource id ${id} refers to multiple objects`);
    }
    context.resources.set(key, resource);
    return id;
}

function encodeValue(
    value: unknown,
    context: EncodeContext,
    label: string
): ParticleDefinitionJSONValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
        return value;
    }
    if (isParticleParameter(value)) {
        let id = context.parameterIds.get(value);
        if (id === undefined) {
            id = `p${String(context.parameters.length)}`;
            context.parameterIds.set(value, id);
            const defaultValue = encodeValue(value.defaultValue, context, `${label}.defaultValue`);
            context.parameters.push(
                Object.freeze({ id, name: value.name, type: value.type, defaultValue })
            );
        }
        return Object.freeze({ $type: 'parameter', id });
    }
    if (value instanceof ParticleCurve) {
        return Object.freeze({
            $type: 'curve',
            wrap: value.wrap,
            interpolation: value.interpolation,
            keys: encodeValue(value.keys, context, `${label}.keys`)
        });
    }
    if (value instanceof ParticleGradient) {
        return Object.freeze({
            $type: 'gradient',
            keys: encodeValue(value.keys, context, `${label}.keys`)
        });
    }
    if (value instanceof Texture) {
        return Object.freeze({
            $type: 'resource',
            kind: 'texture',
            id: requireResourceId(value, 'texture', context)
        });
    }
    if (value instanceof Geometry) {
        return Object.freeze({
            $type: 'resource',
            kind: 'geometry',
            id: requireResourceId(value, 'geometry', context)
        });
    }
    if (typeof value !== 'object') {
        throw new TypeError(`${label} contains a non-JSON value`);
    }
    if (context.seen.has(value)) throw new TypeError(`${label} contains a cycle`);
    context.seen.add(value);
    try {
        if (Array.isArray(value)) {
            return Object.freeze(
                value.map((item, index) => encodeValue(item, context, `${label}[${String(index)}]`))
            );
        }
        const prototype = Object.getPrototypeOf(value) as object | null;
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${label} contains an unsupported object`);
        }
        const source = value as Readonly<Record<string, unknown>>;
        if ('$type' in source) throw new TypeError(`${label} uses reserved key $type`);
        const result: MutableJSONRecord = {};
        for (const key of Object.keys(source).sort()) {
            result[key] = encodeValue(source[key], context, `${label}.${key}`);
        }
        return Object.freeze(result);
    } finally {
        context.seen.delete(value);
    }
}

interface DecodeContext {
    readonly parameters: ReadonlyMap<string, ParticleParameter>;
    readonly options: Readonly<ParticleDefinitionDeserializationOptions>;
    readonly resources: Map<string, ParticleDefinitionResource>;
}

function decodeCurve(record: Readonly<Record<string, unknown>>, label: string): ParticleCurve {
    requireExactKeys(record, new Set(['$type', 'wrap', 'interpolation', 'keys']), label);
    const wrap = record['wrap'];
    if (wrap !== 'clamp' && wrap !== 'loop' && wrap !== 'ping-pong') {
        throw new TypeError(`${label}.wrap is invalid`);
    }
    const interpolation = record['interpolation'];
    if (interpolation !== 'linear' && interpolation !== 'smooth') {
        throw new TypeError(`${label}.interpolation is invalid`);
    }
    const keys = requireArray(record['keys'], `${label}.keys`).map((value, index) => {
        const key = requireRecord(value, `${label}.keys[${String(index)}]`);
        requireExactKeys(key, new Set(['time', 'value']), `${label}.keys[${String(index)}]`);
        return { time: key['time'], value: key['value'] } as ParticleCurveKeyframe;
    });
    return new ParticleCurve(keys, {
        wrap,
        interpolation
    });
}

function decodeGradient(
    record: Readonly<Record<string, unknown>>,
    label: string
): ParticleGradient {
    requireExactKeys(record, new Set(['$type', 'keys']), label);
    const keys = requireArray(record['keys'], `${label}.keys`).map((value, index) => {
        const key = requireRecord(value, `${label}.keys[${String(index)}]`);
        requireExactKeys(key, new Set(['time', 'color']), `${label}.keys[${String(index)}]`);
        return { time: key['time'], color: key['color'] } as ParticleGradientKey;
    });
    return new ParticleGradient(keys);
}

function decodeResource(
    record: Readonly<Record<string, unknown>>,
    context: DecodeContext,
    label: string
): ParticleDefinitionResource {
    requireExactKeys(record, new Set(['$type', 'kind', 'id']), label);
    const kind = record['kind'];
    if (kind !== 'texture' && kind !== 'geometry') throw new TypeError(`${label}.kind is invalid`);
    const id = requireString(record['id'], `${label}.id`);
    const cacheKey = `${kind}\u0000${id}`;
    const cached = context.resources.get(cacheKey);
    if (cached) return cached;
    const resolveResource = context.options.resolveResource;
    if (!resolveResource) {
        throw new TypeError(
            `Particle definition references ${kind} resource ${id}; resolveResource is required`
        );
    }
    const resource = resolveResource(kind, id);
    if (kind === 'texture' ? !(resource instanceof Texture) : !(resource instanceof Geometry)) {
        throw new TypeError(`Particle ${kind} resource ${id} resolved to the wrong object type`);
    }
    context.resources.set(cacheKey, resource);
    return resource;
}

function decodeValue(value: unknown, context: DecodeContext, label: string): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) => decodeValue(item, context, `${label}[${String(index)}]`));
    }
    const record = requireRecord(value, label);
    if ('$type' in record) {
        const type = record['$type'];
        if (type === 'curve') return decodeCurve(record, label);
        if (type === 'gradient') return decodeGradient(record, label);
        if (type === 'resource') return decodeResource(record, context, label);
        if (type === 'parameter') {
            requireExactKeys(record, new Set(['$type', 'id']), label);
            const id = requireString(record['id'], `${label}.id`);
            const parameter = context.parameters.get(id);
            if (!parameter) throw new TypeError(`${label} references unknown parameter ${id}`);
            return parameter;
        }
        throw new TypeError(`${label} has unknown tagged value ${String(type)}`);
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
        result[key] = decodeValue(record[key], context, `${label}.${key}`);
    }
    return result;
}

function requireDiscriminatedRecord(
    value: unknown,
    keySets: Readonly<Record<string, ReadonlySet<string>>>,
    label: string
): Readonly<Record<string, unknown>> {
    const record = requireRecord(value, label);
    const type = requireString(record['type'], `${label}.type`);
    const keys = keySets[type];
    if (!keys) throw new TypeError(`${label}.type ${type} is unsupported`);
    requireExactKeys(record, keys, label);
    return record;
}

function requireOptionalEnum(
    record: Readonly<Record<string, unknown>>,
    key: string,
    values: ReadonlySet<string>,
    label: string
): void {
    const value = record[key];
    if (value !== undefined && (typeof value !== 'string' || !values.has(value))) {
        throw new TypeError(`${label}.${key} is invalid`);
    }
}

function validateRangeRecord(value: unknown, label: string): void {
    if (
        !isRecord(value) ||
        value instanceof ParticleParameter ||
        value instanceof ParticleCurve ||
        value instanceof ParticleGradient ||
        value instanceof Texture ||
        value instanceof Geometry
    ) {
        return;
    }
    requireExactKeys(value, new Set(['min', 'max']), label);
    if (!('min' in value) || !('max' in value)) {
        throw new TypeError(`${label} range must contain min and max`);
    }
}

function validateModuleRecord(module: Readonly<Record<string, unknown>>, label: string): void {
    const type = module['type'];
    requireOptionalEnum(module, 'space', new Set(['local', 'world']), label);
    switch (type) {
        case 'velocity-over-lifetime':
            validateRangeRecord(module['velocity'], `${label}.velocity`);
            return;
        case 'force-over-lifetime':
        case 'gravity':
        case 'wind':
            validateRangeRecord(module['force'], `${label}.force`);
            return;
        case 'limit-velocity':
            validateRangeRecord(module['limit'], `${label}.limit`);
            return;
        case 'noise':
            requireOptionalEnum(module, 'mode', new Set(['position-offset', 'force']), label);
            requireOptionalEnum(module, 'field', new Set(['vector', 'curl']), label);
            validateRangeRecord(module['strength'], `${label}.strength`);
            return;
        case 'texture-sheet':
            requireOptionalEnum(module, 'mode', new Set(['lifetime', 'speed', 'fps']), label);
            return;
        case 'radial-force':
        case 'orbital-force':
        case 'vortex-force':
        case 'point-attraction':
        case 'line-attraction':
            validateRangeRecord(module['strength'], `${label}.strength`);
            return;
        case 'rotate-around-point':
            validateRangeRecord(module['angularSpeed'], `${label}.angularSpeed`);
            return;
        case 'kill-plane':
        case 'kill-box':
        case 'kill-sphere':
            requireOptionalEnum(module, 'mode', new Set(['inside', 'outside']), label);
            return;
        case 'custom-channel':
            requireOptionalEnum(
                module,
                'valueType',
                new Set(['float', 'vec2', 'vec3', 'vec4', 'color']),
                label
            );
            return;
    }
}

function validateRendererRecord(renderer: Readonly<Record<string, unknown>>, label: string): void {
    requireOptionalEnum(
        renderer,
        'blend',
        new Set(['alpha', 'premultiplied-alpha', 'additive']),
        label
    );
    requireOptionalEnum(
        renderer,
        'sort',
        new Set(['none', 'distance', 'youngest', 'oldest']),
        label
    );
    requireOptionalEnum(renderer, 'coverage', new Set(['opaque', 'masked', 'transparent']), label);
    requireOptionalEnum(renderer, 'lighting', new Set(['unlit', 'lambert']), label);
    requireOptionalEnum(renderer, 'composition', new Set(['scene']), label);
    if (renderer['type'] === 'sprite') {
        requireOptionalEnum(
            renderer,
            'alignment',
            new Set(['view', 'world-up', 'stretched', 'velocity']),
            label
        );
    } else if (renderer['type'] === 'mesh') {
        requireOptionalEnum(renderer, 'orientation', new Set(['rotation', 'velocity']), label);
    } else {
        requireOptionalEnum(renderer, 'facing', new Set(['view', 'world-up']), label);
        requireOptionalEnum(renderer, 'uvMode', new Set(['stretch', 'repeat']), label);
    }
}

function validateColliderRecords(value: unknown, label: string): void {
    const keys: Readonly<Record<string, ReadonlySet<string>>> = {
        plane: new Set(['type', 'normal', 'offset']),
        sphere: new Set(['type', 'center', 'radius']),
        box: new Set(['type', 'center', 'size']),
        capsule: new Set(['type', 'start', 'end', 'radius'])
    };
    for (const [index, collider] of requireArray(value, label).entries()) {
        requireDiscriminatedRecord(collider, keys, `${label}[${String(index)}]`);
    }
}

function validateDecodedEmitter(value: unknown, index: number): void {
    const label = `Particle definition emitters[${String(index)}]`;
    const emitter = requireRecord(value, label);
    requireExactKeys(emitter, EMITTER_KEYS, label);
    requireOptionalEnum(emitter, 'execution', new Set(['auto', 'cpu', 'gpu', 'stateless']), label);
    requireOptionalEnum(emitter, 'simulationSpace', new Set(['local', 'world']), label);
    requireOptionalEnum(emitter, 'overflow', new Set(['drop-new', 'replace-oldest']), label);
    requireOptionalEnum(
        emitter,
        'culling',
        new Set(['render-only', 'pause', 'pause-and-catch-up', 'stop']),
        label
    );
    requireOptionalEnum(emitter, 'eventOverflow', new Set(['drop-new', 'drop-oldest']), label);
    if (emitter['bounds'] !== undefined) {
        const boundsKeys: Readonly<Record<string, ReadonlySet<string>>> = {
            automatic: new Set(['mode']),
            dynamic: new Set(['mode']),
            manual: new Set(['mode', 'min', 'max'])
        };
        const bounds = requireRecord(emitter['bounds'], `${label}.bounds`);
        const mode = requireString(bounds['mode'], `${label}.bounds.mode`);
        const keys = boundsKeys[mode];
        if (!keys) throw new TypeError(`${label}.bounds.mode ${mode} is unsupported`);
        requireExactKeys(bounds, keys, `${label}.bounds`);
    }
    if (emitter['emission'] !== undefined) {
        const emission = requireRecord(emitter['emission'], `${label}.emission`);
        requireExactKeys(
            emission,
            new Set(['rateOverTime', 'rateOverDistance', 'bursts']),
            `${label}.emission`
        );
        validateRangeRecord(emission['rateOverTime'], `${label}.emission.rateOverTime`);
        validateRangeRecord(emission['rateOverDistance'], `${label}.emission.rateOverDistance`);
        if (emission['bursts'] !== undefined) {
            for (const [burstIndex, burstValue] of requireArray(
                emission['bursts'],
                `${label}.emission.bursts`
            ).entries()) {
                requireExactKeys(
                    requireRecord(burstValue, `${label}.emission.bursts[${String(burstIndex)}]`),
                    new Set(['time', 'count', 'cycles', 'interval']),
                    `${label}.emission.bursts[${String(burstIndex)}]`
                );
            }
        }
    }
    if (emitter['initialize'] !== undefined) {
        const initialize = requireRecord(emitter['initialize'], `${label}.initialize`);
        requireExactKeys(
            initialize,
            new Set([
                'lifetime',
                'position',
                'direction',
                'speed',
                'color',
                'size',
                'rotation',
                'mass',
                'meshIndex',
                'ribbonId'
            ]),
            `${label}.initialize`
        );
        for (const key of Object.keys(initialize)) {
            validateRangeRecord(initialize[key], `${label}.initialize.${key}`);
        }
    }
    const shapeKeys: Readonly<Record<string, ReadonlySet<string>>> = {
        point: new Set(['type', 'distribution', 'arc', 'thickness']),
        line: new Set(['type', 'start', 'end', 'distribution', 'arc', 'thickness']),
        edge: new Set(['type', 'start', 'end', 'distribution', 'arc', 'thickness']),
        box: new Set(['type', 'size', 'distribution', 'arc', 'thickness']),
        circle: new Set(['type', 'radius', 'distribution', 'arc', 'thickness']),
        disc: new Set(['type', 'radius', 'distribution', 'arc', 'thickness']),
        sphere: new Set(['type', 'radius', 'distribution', 'arc', 'thickness']),
        hemisphere: new Set(['type', 'radius', 'distribution', 'arc', 'thickness']),
        cone: new Set(['type', 'radius', 'angle', 'length', 'distribution', 'arc', 'thickness']),
        torus: new Set(['type', 'radius', 'tubeRadius', 'distribution', 'arc', 'thickness']),
        donut: new Set(['type', 'radius', 'tubeRadius', 'distribution', 'arc', 'thickness'])
    };
    if (emitter['shape'] !== undefined)
        requireDiscriminatedRecord(emitter['shape'], shapeKeys, `${label}.shape`);
    if (emitter['shape'] !== undefined) {
        requireOptionalEnum(
            requireRecord(emitter['shape'], `${label}.shape`),
            'distribution',
            new Set(['surface', 'volume']),
            `${label}.shape`
        );
    }
    if (emitter['modules'] !== undefined) {
        for (const [moduleIndex, moduleValue] of requireArray(
            emitter['modules'],
            `${label}.modules`
        ).entries()) {
            const moduleLabel = `${label}.modules[${String(moduleIndex)}]`;
            const module = requireDiscriminatedRecord(moduleValue, MODULE_KEYS, moduleLabel);
            validateModuleRecord(module, moduleLabel);
            if (module['type'] === 'collision')
                validateColliderRecords(module['colliders'], `${moduleLabel}.colliders`);
            if (module['type'] === 'trigger')
                validateColliderRecords(module['volumes'], `${moduleLabel}.volumes`);
            if (module['type'] === 'trigger' && module['events'] !== undefined) {
                requireExactKeys(
                    requireRecord(module['events'], `${moduleLabel}.events`),
                    new Set(['inside', 'enter', 'exit']),
                    `${moduleLabel}.events`
                );
            }
        }
    }
    for (const [rendererIndex, rendererValue] of requireArray(
        emitter['renderers'],
        `${label}.renderers`
    ).entries()) {
        const rendererLabel = `${label}.renderers[${String(rendererIndex)}]`;
        const renderer = requireDiscriminatedRecord(rendererValue, RENDERER_KEYS, rendererLabel);
        validateRendererRecord(renderer, rendererLabel);
        if (renderer['softParticle'] !== undefined) {
            requireExactKeys(
                requireRecord(renderer['softParticle'], `${rendererLabel}.softParticle`),
                new Set(['distance', 'contrast']),
                `${rendererLabel}.softParticle`
            );
        }
        if (renderer['type'] === 'mesh') {
            for (const [assetIndex, asset] of requireArray(
                renderer['meshes'],
                `${rendererLabel}.meshes`
            ).entries()) {
                requireExactKeys(
                    requireRecord(asset, `${rendererLabel}.meshes[${String(assetIndex)}]`),
                    new Set(['geometry', 'texture']),
                    `${rendererLabel}.meshes[${String(assetIndex)}]`
                );
            }
        }
    }
}

/** Convert an immutable runtime definition into a deeply frozen, versioned JSON document. */
export function serializeParticleSystemDefinition(
    definition: ParticleSystemDefinition,
    options: Readonly<ParticleDefinitionSerializationOptions> = {}
): Readonly<ParticleSystemDefinitionJSON> {
    if (!(definition instanceof ParticleSystemDefinition)) {
        throw new TypeError(
            'serializeParticleSystemDefinition requires a ParticleSystemDefinition'
        );
    }
    const context: EncodeContext = {
        options,
        parameterIds: new Map(),
        parameters: [],
        resources: new Map(),
        seen: new Set()
    };
    const emitters = definition.emitters.map((emitter, index) =>
        requireJSONRecord(
            encodeValue(normalizedEmitterRecord(emitter), context, `emitters[${String(index)}]`),
            `emitters[${String(index)}]`
        )
    );
    return Object.freeze({
        schema: PARTICLE_DEFINITION_SCHEMA,
        version: PARTICLE_DEFINITION_VERSION,
        parameters: Object.freeze(context.parameters),
        emitters: Object.freeze(emitters)
    });
}

/** Upgrade, strictly decode, validate, and snapshot a particle JSON document. */
export function deserializeParticleSystemDefinition(
    source: unknown,
    options: Readonly<ParticleDefinitionDeserializationOptions> = {}
): ParticleSystemDefinition {
    const document = upgradeDocument(source, options.upgrades ?? []);
    requireExactKeys(
        document,
        new Set(['schema', 'version', 'parameters', 'emitters']),
        'Particle definition JSON'
    );
    if (document['schema'] !== PARTICLE_DEFINITION_SCHEMA) {
        throw new TypeError(`Particle definition schema must be ${PARTICLE_DEFINITION_SCHEMA}`);
    }
    if (document['version'] !== PARTICLE_DEFINITION_VERSION) {
        throw new RangeError(
            `Particle definition version must be ${String(PARTICLE_DEFINITION_VERSION)}`
        );
    }
    const parameterRecords = requireArray(
        document['parameters'],
        'Particle definition JSON.parameters'
    );
    const parameters = new Map<string, ParticleParameter>();
    const context: DecodeContext = { parameters, options, resources: new Map() };
    for (const [index, value] of parameterRecords.entries()) {
        const label = `Particle definition JSON.parameters[${String(index)}]`;
        const record = requireRecord(value, label);
        requireExactKeys(record, new Set(['id', 'name', 'type', 'defaultValue']), label);
        const id = requireString(record['id'], `${label}.id`);
        if (parameters.has(id))
            throw new TypeError(`Particle definition has duplicate parameter id ${id}`);
        const name = requireString(record['name'], `${label}.name`);
        const type = record['type'];
        if (typeof type !== 'string' || !PARAMETER_TYPES.has(type as ParticleParameterType)) {
            throw new TypeError(`${label}.type is invalid`);
        }
        const defaultValue = decodeValue(record['defaultValue'], context, `${label}.defaultValue`);
        parameters.set(
            id,
            new ParticleParameter(
                name,
                type as ParticleParameterType,
                defaultValue as ParticleParameterValue
            )
        );
    }
    const emitterValues = requireArray(
        document['emitters'],
        'Particle definition JSON.emitters'
    ).map((value, index) =>
        decodeValue(value, context, `Particle definition emitters[${String(index)}]`)
    );
    emitterValues.forEach(validateDecodedEmitter);
    const definition = ParticleSystemDefinition.create({
        version: PARTICLE_DEFINITION_VERSION,
        emitters: emitterValues as readonly ParticleEmitterDefinitionInput[]
    } satisfies ParticleSystemDefinitionInput);
    compileParticleSystemDefinition(definition, options.compilationEnvironment);
    return definition;
}

/** Parse JSON text before applying the same upgrade, resource, and validation contract. */
export function parseParticleSystemDefinitionJSON(
    source: string,
    options: Readonly<ParticleDefinitionDeserializationOptions> = {}
): ParticleSystemDefinition {
    if (typeof source !== 'string')
        throw new TypeError('Particle definition JSON source must be a string');
    return deserializeParticleSystemDefinition(JSON.parse(source) as unknown, options);
}
