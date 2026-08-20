import { deriveParticleEmitterBounds, particleEmitterRequiresManualBounds } from './ParticleBounds';
import Geometry from '../geometry/Geometry';
import { TRIANGLES } from '../constants/webgl';
import type {
    ParticleAttributeLayout,
    ParticleAttributeName,
    ParticleCompiledEmitterPlan,
    ParticleCompiledPlan,
    ParticleCurveLUT,
    ParticleGradientLUT
} from './ParticleCompiledPlan';
import ParticleCurve from './ParticleCurve';
import { hashParticleDefinition } from './ParticleDefinitionHash';
import type ParticleEmitterDefinition from './ParticleEmitterDefinition';
import ParticleGradient from './ParticleGradient';
import { ParticleParameter, resolveParticleParameter } from './ParticleParameter';
import {
    analyzeParticleStatelessEligibility,
    particleStatelessBlockingDiagnostics
} from './ParticleStateless';
import type ParticleSystemDefinition from './ParticleSystemDefinition';
import type {
    ParticleColorSource,
    ParticleColorValue,
    ParticleModule,
    ParticleRange,
    ParticleScalarSource,
    ParticleScalarValue,
    ParticleShapeDefinition,
    ParticleVector3Source,
    ParticleVector3Value
} from './ParticleTypes';

/** Backend capabilities and optional automatic execution threshold used during plan selection. */
export interface ParticleAdvancedQualityPlan {
    /** Enable ribbon/trail topology. Explicit false fails definitions that require it. */
    readonly ribbons?: boolean;
    /** Enable the controlled Lambert scene-light subset. */
    readonly litParticles?: boolean;
    /** Enable portable opaque/masked mesh motion-vector output. */
    readonly motionVectors?: boolean;
}

export interface ParticleCompilationEnvironment {
    readonly backend?: 'webgl2' | 'webgpu';
    readonly preferGPUAboveCapacity?: number;
    readonly advancedQuality?: Readonly<ParticleAdvancedQualityPlan>;
}

interface AttributeShape {
    readonly storage: 'f32' | 'u32';
    readonly components: 1 | 2 | 3 | 4;
}

const ATTRIBUTE_SHAPES: Readonly<Record<string, AttributeShape>> = Object.freeze({
    'stable-id': { storage: 'u32', components: 1 },
    generation: { storage: 'u32', components: 1 },
    alive: { storage: 'u32', components: 1 },
    age: { storage: 'f32', components: 1 },
    lifetime: { storage: 'f32', components: 1 },
    'normalized-age': { storage: 'f32', components: 1 },
    position: { storage: 'f32', components: 3 },
    'previous-position': { storage: 'f32', components: 3 },
    'spawn-position': { storage: 'f32', components: 3 },
    velocity: { storage: 'f32', components: 3 },
    size: { storage: 'f32', components: 1 },
    'base-size': { storage: 'f32', components: 1 },
    rotation: { storage: 'f32', components: 1 },
    'base-rotation': { storage: 'f32', components: 1 },
    color: { storage: 'f32', components: 4 },
    'base-color': { storage: 'f32', components: 4 },
    'sprite-frame': { storage: 'f32', components: 1 },
    mass: { storage: 'f32', components: 1 },
    'noise-offset': { storage: 'f32', components: 3 },
    'collision-state': { storage: 'u32', components: 1 },
    'mesh-index': { storage: 'u32', components: 1 },
    'ribbon-id': { storage: 'u32', components: 1 }
});

function align(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function requireFinite(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function validateVector(value: readonly number[], length: number, label: string): void {
    if (value.length !== length || value.some(component => !Number.isFinite(component))) {
        throw new TypeError(`${label} must contain ${String(length)} finite components`);
    }
}

function isRange<T>(value: T | ParticleRange<T>): value is ParticleRange<T> {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && 'min' in value;
}

function validateScalar(value: ParticleScalarSource | undefined, label: string): void {
    if (value === undefined) return;
    if (value instanceof ParticleParameter && value.type !== 'float' && value.type !== 'uint') {
        throw new TypeError(`${label} parameter must have float or uint type`);
    }
    const source: ParticleScalarValue = resolveParticleParameter(value);
    if (typeof source === 'number') {
        requireFinite(source, label);
        return;
    }
    requireFinite(source.min, `${label}.min`);
    requireFinite(source.max, `${label}.max`);
    if (source.min > source.max) throw new RangeError(`${label}.min must not exceed max`);
}

function validateVectorValue(value: ParticleVector3Source | undefined, label: string): void {
    if (value === undefined) return;
    if (value instanceof ParticleParameter && value.type !== 'vector3') {
        throw new TypeError(`${label} parameter must have vector3 type`);
    }
    const source: ParticleVector3Value = resolveParticleParameter(value);
    if (isRange(source)) {
        validateVector(source.min, 3, `${label}.min`);
        validateVector(source.max, 3, `${label}.max`);
        validateVectorRange(source.min, source.max, label);
    } else {
        validateVector(source, 3, label);
    }
}

function validateColorValue(value: ParticleColorSource | undefined, label: string): void {
    if (value === undefined) return;
    if (value instanceof ParticleParameter && value.type !== 'color' && value.type !== 'vector4') {
        throw new TypeError(`${label} parameter must have color or vector4 type`);
    }
    const source: ParticleColorValue = resolveParticleParameter(value);
    if (isRange(source)) {
        validateVector(source.min, 4, `${label}.min`);
        validateVector(source.max, 4, `${label}.max`);
        validateVectorRange(source.min, source.max, label);
    } else {
        validateVector(source, 4, label);
    }
}

function validateVectorRange(
    minimum: readonly number[],
    maximum: readonly number[],
    label: string
): void {
    for (let component = 0; component < minimum.length; component += 1) {
        if ((minimum[component] ?? 0) > (maximum[component] ?? 0)) {
            throw new RangeError(`${label}.min must not exceed max component-wise`);
        }
    }
}

function validateIntegerScalar(value: ParticleScalarSource | undefined, label: string): void {
    if (value === undefined) return;
    if (value instanceof ParticleParameter && value.type !== 'uint') {
        throw new TypeError(`${label} parameter must have uint type`);
    }
    const source: ParticleScalarValue = resolveParticleParameter(value);
    const values = typeof source === 'number' ? [source] : [source.min, source.max];
    for (const candidate of values) {
        if (!Number.isSafeInteger(candidate) || candidate < 0) {
            throw new RangeError(`${label} must contain non-negative safe integers`);
        }
    }
    if (values.length === 2 && (values[0] ?? 0) > (values[1] ?? 0)) {
        throw new RangeError(`${label}.min must not exceed max`);
    }
}

function validateParticleGeometry(geometry: Geometry, label: string): void {
    if (!(geometry instanceof Geometry)) throw new TypeError(`${label} must be a Geometry`);
    if (geometry.mode !== TRIANGLES) {
        throw new TypeError(`${label} must use triangle-list topology`);
    }
    const vertices = geometry.vertices;
    if (vertices?.size !== 3 || vertices.count < 3) {
        throw new TypeError(`${label} requires three-component positions`);
    }
    if (!(vertices.data instanceof Float32Array)) {
        throw new TypeError(`${label} positions must use Float32Array storage`);
    }
    const normals = geometry.normals;
    if (normals?.size !== 3 || normals.count !== vertices.count) {
        throw new TypeError(`${label} requires one three-component normal per vertex`);
    }
    if (!(normals.data instanceof Float32Array)) {
        throw new TypeError(`${label} normals must use Float32Array storage`);
    }
    const uvs = geometry.uvs;
    if (uvs !== null && (uvs.size !== 2 || uvs.count !== vertices.count)) {
        throw new TypeError(`${label} UVs must contain one vec2 per vertex`);
    }
    const indices = geometry.indices;
    if (indices !== null && indices.size !== 1) {
        throw new TypeError(`${label} indices must be scalar`);
    }
}

function validateShape(shape: ParticleShapeDefinition, label: string): void {
    if (shape.arc !== undefined) {
        requireFinite(shape.arc, `${label}.arc`);
        if (shape.arc <= 0 || shape.arc > Math.fround(Math.PI * 2)) {
            throw new RangeError(`${label}.arc must be in the range (0, 2π]`);
        }
    }
    if (shape.thickness !== undefined) {
        requireFinite(shape.thickness, `${label}.thickness`);
        if (shape.thickness < 0 || shape.thickness > 1) {
            throw new RangeError(`${label}.thickness must be between zero and one`);
        }
    }
    switch (shape.type) {
        case 'point':
            return;
        case 'line':
        case 'edge':
            validateVector(shape.start, 3, `${label}.start`);
            validateVector(shape.end, 3, `${label}.end`);
            return;
        case 'box':
            validateVector(shape.size, 3, `${label}.size`);
            if (shape.size.some(component => component < 0)) {
                throw new RangeError(`${label}.size must be non-negative`);
            }
            return;
        case 'circle':
        case 'disc':
        case 'sphere':
        case 'hemisphere':
            requireFinite(shape.radius, `${label}.radius`);
            if (shape.radius < 0) throw new RangeError(`${label}.radius must be non-negative`);
            return;
        case 'cone':
            requireFinite(shape.radius, `${label}.radius`);
            requireFinite(shape.angle, `${label}.angle`);
            if (shape.radius < 0 || shape.angle < 0 || shape.angle >= 90) {
                throw new RangeError(`${label} cone radius/angle are invalid`);
            }
            if (shape.length !== undefined && shape.length < 0) {
                throw new RangeError(`${label}.length must be non-negative`);
            }
            return;
        case 'torus':
        case 'donut':
            requireFinite(shape.radius, `${label}.radius`);
            requireFinite(shape.tubeRadius, `${label}.tubeRadius`);
            if (shape.radius < 0 || shape.tubeRadius < 0) {
                throw new RangeError(`${label} torus radii must be non-negative`);
            }
    }
}

function validateCollider(
    collider: Extract<ParticleModule, { type: 'collision' }>['colliders'][number],
    label: string
): void {
    switch (collider.type) {
        case 'plane':
            validateVector(collider.normal, 3, `${label}.normal`);
            if (Math.hypot(...collider.normal) <= 1e-8) {
                throw new RangeError(`${label}.normal must not be zero`);
            }
            if (collider.offset !== undefined) requireFinite(collider.offset, `${label}.offset`);
            return;
        case 'sphere':
            if (collider.center !== undefined)
                validateVector(collider.center, 3, `${label}.center`);
            requireFinite(collider.radius, `${label}.radius`);
            if (collider.radius < 0) throw new RangeError(`${label}.radius must be non-negative`);
            return;
        case 'box':
            if (collider.center !== undefined)
                validateVector(collider.center, 3, `${label}.center`);
            validateVector(collider.size, 3, `${label}.size`);
            if (collider.size.some(component => component < 0)) {
                throw new RangeError(`${label}.size must be non-negative`);
            }
            return;
        case 'capsule':
            validateVector(collider.start, 3, `${label}.start`);
            validateVector(collider.end, 3, `${label}.end`);
            requireFinite(collider.radius, `${label}.radius`);
            if (collider.radius < 0) throw new RangeError(`${label}.radius must be non-negative`);
    }
}

function validateModule(module: ParticleModule, label: string): void {
    const phase: unknown = Reflect.get(module, 'phase');
    if (phase !== undefined && phase !== 'update' && phase !== 'kill') {
        throw new TypeError(`${label}.phase is invalid for fixed update modules`);
    }
    switch (module.type) {
        case 'velocity-over-lifetime':
            validateVectorValue(module.velocity, `${label}.velocity`);
            return;
        case 'force-over-lifetime':
        case 'gravity':
        case 'wind':
            validateVectorValue(module.force, `${label}.force`);
            return;
        case 'drag':
            requireFinite(module.coefficient, `${label}.coefficient`);
            if (module.coefficient < 0)
                throw new RangeError(`${label}.coefficient must be non-negative`);
            return;
        case 'limit-velocity':
            validateScalar(module.limit, `${label}.limit`);
            if (module.dampen !== undefined && (module.dampen < 0 || module.dampen > 1)) {
                throw new RangeError(`${label}.dampen must be between zero and one`);
            }
            return;
        case 'inherit-emitter-velocity':
            if (module.multiplier !== undefined)
                requireFinite(module.multiplier, `${label}.multiplier`);
            return;
        case 'noise':
            validateVectorValue(module.strength, `${label}.strength`);
            requireFinite(module.frequency, `${label}.frequency`);
            if (module.frequency <= 0) throw new RangeError(`${label}.frequency must be positive`);
            if (module.damping !== undefined && module.mode !== 'force') {
                throw new TypeError(`${label}.damping is valid only for force noise`);
            }
            if (module.scrollVelocity !== undefined) {
                validateVector(module.scrollVelocity, 3, `${label}.scrollVelocity`);
            }
            return;
        case 'alpha-over-lifetime':
        case 'size-over-lifetime':
        case 'rotation-over-lifetime':
        case 'frame-over-lifetime':
            if (!(module.curve instanceof ParticleCurve)) {
                throw new TypeError(`${label}.curve must be a ParticleCurve`);
            }
            return;
        case 'color-over-lifetime':
            if (!(module.gradient instanceof ParticleGradient)) {
                throw new TypeError(`${label}.gradient must be a ParticleGradient`);
            }
            return;
        case 'color-by-speed':
        case 'size-by-speed':
        case 'rotation-by-speed':
            validateVector(module.speedRange, 2, `${label}.speedRange`);
            if (module.speedRange[0] > module.speedRange[1]) {
                throw new RangeError(`${label}.speedRange must be ordered`);
            }
            if (module.type === 'color-by-speed') {
                if (!(module.gradient instanceof ParticleGradient)) {
                    throw new TypeError(`${label}.gradient must be a ParticleGradient`);
                }
            } else if (!(module.curve instanceof ParticleCurve)) {
                throw new TypeError(`${label}.curve must be a ParticleCurve`);
            }
            return;
        case 'texture-sheet':
            if (
                !Number.isSafeInteger(module.rows) ||
                module.rows < 1 ||
                !Number.isSafeInteger(module.columns) ||
                module.columns < 1
            ) {
                throw new RangeError(`${label} rows and columns must be positive integers`);
            }
            if (
                module.mode === 'fps' &&
                (!(module.fps && Number.isFinite(module.fps)) || module.fps <= 0)
            ) {
                throw new RangeError(`${label}.fps must be positive in fps mode`);
            }
            return;
        case 'radial-force':
        case 'orbital-force':
        case 'vortex-force':
            validateScalar(module.strength, `${label}.strength`);
            if (module.center !== undefined) validateVector(module.center, 3, `${label}.center`);
            if (module.axis !== undefined) validateVector(module.axis, 3, `${label}.axis`);
            return;
        case 'point-attraction':
        case 'line-attraction':
            validateScalar(module.strength, `${label}.strength`);
            if (module.point !== undefined) validateVector(module.point, 3, `${label}.point`);
            if (module.lineStart !== undefined)
                validateVector(module.lineStart, 3, `${label}.lineStart`);
            if (module.lineEnd !== undefined) validateVector(module.lineEnd, 3, `${label}.lineEnd`);
            return;
        case 'rotate-around-point':
            validateScalar(module.angularSpeed, `${label}.angularSpeed`);
            return;
        case 'conform-sphere':
            requireFinite(module.radius, `${label}.radius`);
            requireFinite(module.strength, `${label}.strength`);
            return;
        case 'lifetime-by-emitter-speed':
            validateVector(module.speedRange, 2, `${label}.speedRange`);
            validateVector(module.lifetimeRange, 2, `${label}.lifetimeRange`);
            return;
        case 'kill-speed':
        case 'kill-distance':
            validateVector(module.range, 2, `${label}.range`);
            return;
        case 'kill-plane':
        case 'kill-box':
        case 'kill-sphere':
            if (module.center !== undefined) validateVector(module.center, 3, `${label}.center`);
            return;
        case 'camera-offset':
        case 'camera-fade':
        case 'screen-space-size':
            if (module.range !== undefined) validateVector(module.range, 2, `${label}.range`);
            return;
        case 'custom-channel':
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(module.name)) {
                throw new TypeError(`${label}.name is invalid`);
            }
            {
                const components =
                    module.valueType === 'float'
                        ? 1
                        : module.valueType === 'vec2'
                          ? 2
                          : module.valueType === 'vec3'
                            ? 3
                            : 4;
                const valueComponents = typeof module.value === 'number' ? 1 : module.value.length;
                if (valueComponents !== components) {
                    throw new TypeError(
                        `${label}.value must contain ${String(components)} component(s) for ${module.valueType}`
                    );
                }
            }
            return;
        case 'vector-field':
            requireFinite(module.strength, `${label}.strength`);
            return;
        case 'collision':
            if (module.colliders.length === 0) {
                throw new RangeError(`${label}.colliders must not be empty`);
            }
            module.colliders.forEach((collider, index) => {
                validateCollider(collider, `${label}.colliders[${String(index)}]`);
            });
            for (const [name, value] of [
                ['bounce', module.bounce ?? 0.5],
                ['friction', module.friction ?? 0],
                ['radiusScale', module.radiusScale ?? 1],
                ['lifetimeLoss', module.lifetimeLoss ?? 0]
            ] as const) {
                requireFinite(value, `${label}.${name}`);
                if (value < 0 || (name !== 'radiusScale' && value > 1)) {
                    throw new RangeError(`${label}.${name} is outside its supported range`);
                }
            }
            return;
        case 'trigger':
            if (module.volumes.length === 0 || module.volumes.length > 32) {
                throw new RangeError(`${label}.volumes must contain between 1 and 32 entries`);
            }
            module.volumes.forEach((collider, index) => {
                validateCollider(collider, `${label}.volumes[${String(index)}]`);
            });
            return;
        case 'scene-depth-collision':
            requireFinite(module.thickness ?? 0.001, `${label}.thickness`);
            requireFinite(module.bounce ?? 0.5, `${label}.bounce`);
            requireFinite(module.friction ?? 0, `${label}.friction`);
            if ((module.thickness ?? 0.001) <= 0) {
                throw new RangeError(`${label}.thickness must be positive`);
            }
            if ((module.bounce ?? 0.5) < 0 || (module.bounce ?? 0.5) > 1) {
                throw new RangeError(`${label}.bounce must be between zero and one`);
            }
            if ((module.friction ?? 0) < 0 || (module.friction ?? 0) > 1) {
                throw new RangeError(`${label}.friction must be between zero and one`);
            }
            return;
        case 'sub-emitter':
            if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(module.event)) {
                throw new TypeError(`${label}.event is invalid`);
            }
            if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(module.emitter)) {
                throw new TypeError(`${label}.emitter is invalid`);
            }
            if (
                module.count !== undefined &&
                (!Number.isSafeInteger(module.count) || module.count < 1)
            ) {
                throw new RangeError(`${label}.count must be a positive safe integer`);
            }
            return;
    }
}

function collectAttributes(emitter: ParticleEmitterDefinition): Set<ParticleAttributeName> {
    const attributes = new Set<ParticleAttributeName>([
        'stable-id',
        'generation',
        'alive',
        'age',
        'lifetime',
        'normalized-age',
        'position',
        'previous-position',
        'velocity'
    ]);
    if (emitter.renderers.length > 0) {
        attributes.add('size');
        attributes.add('rotation');
        attributes.add('color');
        if (emitter.renderers.some(renderer => renderer.type === 'sprite')) {
            attributes.add('sprite-frame');
        }
        if (emitter.renderers.some(renderer => renderer.type === 'mesh')) {
            attributes.add('mesh-index');
        }
        if (
            emitter.renderers.some(
                renderer => renderer.type === 'ribbon' || renderer.type === 'trail'
            )
        ) {
            attributes.add('ribbon-id');
        }
    }
    for (const module of emitter.modules) {
        switch (module.type) {
            case 'noise':
                attributes.add('spawn-position');
                if (module.mode === 'position-offset') attributes.add('noise-offset');
                break;
            case 'size-over-lifetime':
            case 'size-by-speed':
                attributes.add('size');
                attributes.add('base-size');
                break;
            case 'rotation-over-lifetime':
            case 'rotation-by-speed':
                attributes.add('rotation');
                attributes.add('base-rotation');
                break;
            case 'color-over-lifetime':
            case 'color-by-speed':
            case 'alpha-over-lifetime':
                attributes.add('color');
                attributes.add('base-color');
                break;
            case 'frame-over-lifetime':
            case 'texture-sheet':
                attributes.add('sprite-frame');
                break;
            case 'custom-channel':
                attributes.add(`custom:${module.name}`);
                break;
            case 'trigger':
                attributes.add('collision-state');
                break;
            default:
                break;
        }
    }
    if (emitter.initialize.mass !== undefined) attributes.add('mass');
    return attributes;
}

function customShape(
    emitter: ParticleEmitterDefinition,
    name: ParticleAttributeName
): AttributeShape {
    if (!name.startsWith('custom:')) {
        const shape = ATTRIBUTE_SHAPES[name];
        if (!shape) throw new Error(`Particle attribute ${name} has no layout shape`);
        return shape;
    }
    const channel = emitter.modules.find(
        module => module.type === 'custom-channel' && `custom:${module.name}` === name
    );
    if (channel?.type !== 'custom-channel') {
        throw new Error(`Particle custom attribute ${name} lost its module`);
    }
    const components =
        channel.valueType === 'float'
            ? 1
            : channel.valueType === 'vec2'
              ? 2
              : channel.valueType === 'vec3'
                ? 3
                : 4;
    return { storage: 'f32', components };
}

function buildAttributeLayout(emitter: ParticleEmitterDefinition): {
    readonly attributes: readonly Readonly<ParticleAttributeLayout>[];
    readonly byteLength: number;
} {
    const names = [...collectAttributes(emitter)].sort();
    let byteOffset = 0;
    const attributes = names.map(name => {
        const shape = customShape(emitter, name);
        byteOffset = align(byteOffset, 16);
        const byteLength = align(emitter.capacity * shape.components * 4, 16);
        const attribute = Object.freeze({
            name,
            storage: shape.storage,
            components: shape.components,
            byteOffset,
            byteLength
        });
        byteOffset += byteLength;
        return attribute;
    });
    return { attributes: Object.freeze(attributes), byteLength: byteOffset };
}

function collectLUTs(emitter: ParticleEmitterDefinition): {
    readonly curves: readonly Readonly<ParticleCurveLUT>[];
    readonly gradients: readonly Readonly<ParticleGradientLUT>[];
} {
    const curves: ParticleCurveLUT[] = [];
    const gradients: ParticleGradientLUT[] = [];
    const seenCurves = new Set<ParticleCurve>();
    const seenGradients = new Set<ParticleGradient>();
    for (const module of emitter.modules) {
        const curve = 'curve' in module ? module.curve : undefined;
        if (curve instanceof ParticleCurve && !seenCurves.has(curve)) {
            seenCurves.add(curve);
            curves.push(Object.freeze({ curve, values: curve.bake() }));
        }
        const gradient = 'gradient' in module ? module.gradient : undefined;
        if (gradient instanceof ParticleGradient && !seenGradients.has(gradient)) {
            seenGradients.add(gradient);
            gradients.push(Object.freeze({ gradient, values: gradient.bake() }));
        }
    }
    return { curves: Object.freeze(curves), gradients: Object.freeze(gradients) };
}

function selectPlanKind(
    emitter: ParticleEmitterDefinition,
    environment: Readonly<ParticleCompilationEnvironment>,
    statelessDiagnostics: readonly string[]
): ParticleCompiledEmitterPlan['kind'] {
    if (emitter.execution === 'stateless') {
        if (statelessDiagnostics.length > 0) {
            throw new TypeError(
                `Particle emitter ${emitter.name} is not stateless-compatible: ${statelessDiagnostics.join(', ')}`
            );
        }
        return 'stateless';
    }
    if (emitter.execution === 'gpu') {
        if (environment.backend === 'webgl2') {
            throw new TypeError(
                `Particle emitter ${emitter.name} explicitly requires WebGPU execution`
            );
        }
        return 'gpu-stateful';
    }
    if (emitter.execution === 'cpu') return 'cpu-stateful';
    if (emitter.modules.some(module => module.type === 'trigger')) return 'cpu-stateful';
    if (statelessDiagnostics.length === 0) return 'stateless';
    if (
        environment.backend === 'webgpu' &&
        emitter.capacity >= (environment.preferGPUAboveCapacity ?? Number.POSITIVE_INFINITY)
    ) {
        return 'gpu-stateful';
    }
    return 'cpu-stateful';
}

function validateEmitter(
    emitter: ParticleEmitterDefinition,
    environment: Readonly<ParticleCompilationEnvironment>
): void {
    validateScalar(emitter.emission.rateOverTime, `${emitter.name}.emission.rateOverTime`);
    validateScalar(emitter.emission.rateOverDistance, `${emitter.name}.emission.rateOverDistance`);
    for (const [index, burst] of (emitter.emission.bursts ?? []).entries()) {
        requireFinite(burst.time, `${emitter.name}.bursts[${String(index)}].time`);
        if (burst.time < 0 || !Number.isSafeInteger(burst.count) || burst.count < 0) {
            throw new RangeError(`${emitter.name}.bursts[${String(index)}] is invalid`);
        }
        const cycles = burst.cycles ?? 1;
        const interval = burst.interval ?? 0;
        if (!Number.isSafeInteger(cycles) || cycles < 1 || cycles > 65_536) {
            throw new RangeError(
                `${emitter.name}.bursts[${String(index)}].cycles must be between 1 and 65536`
            );
        }
        requireFinite(interval, `${emitter.name}.bursts[${String(index)}].interval`);
        if (interval < 0 || (cycles > 1 && interval === 0)) {
            throw new RangeError(
                `${emitter.name}.bursts[${String(index)}].interval must be positive when cycles exceeds one`
            );
        }
    }
    validateShape(emitter.shape, `${emitter.name}.shape`);
    validateScalar(emitter.initialize.lifetime, `${emitter.name}.initialize.lifetime`);
    validateScalar(emitter.initialize.speed, `${emitter.name}.initialize.speed`);
    validateScalar(emitter.initialize.size, `${emitter.name}.initialize.size`);
    validateScalar(emitter.initialize.rotation, `${emitter.name}.initialize.rotation`);
    validateScalar(emitter.initialize.mass, `${emitter.name}.initialize.mass`);
    validateIntegerScalar(emitter.initialize.meshIndex, `${emitter.name}.initialize.meshIndex`);
    validateIntegerScalar(emitter.initialize.ribbonId, `${emitter.name}.initialize.ribbonId`);
    validateVectorValue(emitter.initialize.position, `${emitter.name}.initialize.position`);
    validateVectorValue(emitter.initialize.direction, `${emitter.name}.initialize.direction`);
    validateColorValue(emitter.initialize.color, `${emitter.name}.initialize.color`);
    for (const [index, module] of emitter.modules.entries()) {
        validateModule(module, `${emitter.name}.modules[${String(index)}]`);
    }
    const customChannels = new Set<string>();
    for (const module of emitter.modules) {
        if (module.type !== 'custom-channel') continue;
        if (customChannels.has(module.name)) {
            throw new TypeError(
                `Particle emitter ${emitter.name} has duplicate custom channel ${module.name}`
            );
        }
        customChannels.add(module.name);
    }
    if (emitter.modules.filter(module => module.type === 'trigger').length > 1) {
        throw new RangeError(`${emitter.name} supports one trigger module with up to 32 volumes`);
    }
    const usesSceneDepthCollision = emitter.modules.some(
        module => module.type === 'scene-depth-collision'
    );
    const usesVectorField = emitter.modules.some(module => module.type === 'vector-field');
    const usesTrigger = emitter.modules.some(module => module.type === 'trigger');
    const usesCameraRendering = emitter.modules.some(
        module =>
            module.type === 'camera-offset' ||
            module.type === 'camera-fade' ||
            module.type === 'screen-space-size'
    );
    const usesSoftParticles = emitter.renderers.some(
        renderer =>
            (renderer.type === 'sprite' ||
                renderer.type === 'ribbon' ||
                renderer.type === 'trail') &&
            renderer.softParticle !== undefined
    );
    if ((usesSceneDepthCollision || usesSoftParticles) && emitter.execution !== 'gpu') {
        throw new TypeError(
            `Particle emitter ${emitter.name} scene-depth interaction requires explicit GPU execution`
        );
    }
    if (usesVectorField && emitter.execution !== 'gpu') {
        throw new TypeError(
            `Particle emitter ${emitter.name} vector-field sampling requires explicit GPU execution`
        );
    }
    if (usesTrigger && emitter.execution === 'gpu') {
        throw new TypeError(
            `Particle emitter ${emitter.name} trigger modules require CPU execution`
        );
    }
    if (emitter.execution === 'gpu' && emitter.overflow === 'replace-oldest') {
        throw new TypeError(
            `Particle emitter ${emitter.name} GPU execution does not support replace-oldest overflow`
        );
    }
    if (usesCameraRendering && emitter.renderers.some(renderer => renderer.type !== 'sprite')) {
        throw new TypeError(
            `Particle emitter ${emitter.name} camera rendering modules require sprite-only renderers`
        );
    }
    for (const [index, renderer] of emitter.renderers.entries()) {
        const rendererLabel = `${emitter.name}.renderers[${String(index)}]`;
        if ('coverage' in renderer) {
            const coverage = renderer.coverage ?? 'transparent';
            if (coverage !== 'transparent' && renderer.blend !== undefined) {
                throw new TypeError(`${rendererLabel}.blend requires transparent coverage`);
            }
            if (coverage === 'masked') {
                const cutoff = renderer.alphaCutoff ?? 0.5;
                requireFinite(cutoff, `${rendererLabel}.alphaCutoff`);
                if (cutoff < 0 || cutoff > 1) {
                    throw new RangeError(
                        `${rendererLabel}.alphaCutoff must be between zero and one`
                    );
                }
            }
        }
        if (renderer.type === 'mesh') {
            if (
                renderer.lighting === 'lambert' &&
                environment.advancedQuality?.litParticles === false
            ) {
                throw new TypeError(`${rendererLabel} requires disabled lit-particle quality`);
            }
            if (renderer.meshes.length === 0 || renderer.meshes.length > 16) {
                throw new RangeError(
                    `${rendererLabel}.meshes must contain between 1 and 16 assets`
                );
            }
            renderer.meshes.forEach((asset, assetIndex) => {
                validateParticleGeometry(
                    asset.geometry,
                    `${rendererLabel}.meshes[${String(assetIndex)}].geometry`
                );
            });
            const meshIndex = emitter.initialize.meshIndex;
            const resolvedMeshIndex =
                meshIndex === undefined ? undefined : resolveParticleParameter(meshIndex);
            const maximumIndex =
                resolvedMeshIndex === undefined
                    ? 0
                    : typeof resolvedMeshIndex === 'number'
                      ? resolvedMeshIndex
                      : resolvedMeshIndex.max;
            if (maximumIndex >= renderer.meshes.length) {
                throw new RangeError(
                    `${emitter.name}.initialize.meshIndex exceeds renderer mesh buckets`
                );
            }
            if (
                renderer.motionVectors === true &&
                (renderer.coverage ?? 'transparent') === 'transparent'
            ) {
                throw new TypeError(
                    `${rendererLabel}.motionVectors requires opaque or masked coverage`
                );
            }
            if (
                renderer.motionVectors === true &&
                environment.advancedQuality?.motionVectors === false
            ) {
                throw new TypeError(`${rendererLabel} requires disabled motion-vector quality`);
            }
            if (renderer.motionVectors === true && emitter.execution === 'gpu') {
                throw new TypeError(
                    `${rendererLabel}.motionVectors is currently supported by portable CPU mesh output only`
                );
            }
        } else if (renderer.type === 'ribbon' || renderer.type === 'trail') {
            if (environment.advancedQuality?.ribbons === false) {
                throw new TypeError(`${rendererLabel} requires disabled ribbon quality`);
            }
            if (
                renderer.lighting === 'lambert' &&
                environment.advancedQuality?.litParticles === false
            ) {
                throw new TypeError(`${rendererLabel} requires disabled lit-particle quality`);
            }
            requireFinite(renderer.widthScale ?? 1, `${rendererLabel}.widthScale`);
            requireFinite(renderer.tilesPerUnit ?? 1, `${rendererLabel}.tilesPerUnit`);
            if ((renderer.widthScale ?? 1) <= 0 || (renderer.tilesPerUnit ?? 1) <= 0) {
                throw new RangeError(`${rendererLabel} widthScale/tilesPerUnit must be positive`);
            }
            if ((renderer.sort ?? 'none') !== 'none') {
                throw new TypeError(
                    `${rendererLabel}.sort cannot reorder ribbon topology; sort renderer groups instead`
                );
            }
        }
        const soft =
            renderer.type === 'sprite' || renderer.type === 'ribbon' || renderer.type === 'trail'
                ? renderer.softParticle
                : undefined;
        if (soft === undefined) continue;
        requireFinite(
            soft.distance,
            `${emitter.name}.renderers[${String(index)}].softParticle.distance`
        );
        requireFinite(
            soft.contrast ?? 1,
            `${emitter.name}.renderers[${String(index)}].softParticle.contrast`
        );
        if (soft.distance <= 0 || (soft.contrast ?? 1) <= 0) {
            throw new RangeError(
                `${emitter.name} soft-particle distance/contrast must be positive`
            );
        }
        if (renderer.depthWrite === true) {
            throw new TypeError(`${emitter.name} soft particles cannot enable depthWrite`);
        }
    }
    if (emitter.bounds.mode === 'manual') {
        validateVector(emitter.bounds.min, 3, `${emitter.name}.bounds.min`);
        validateVector(emitter.bounds.max, 3, `${emitter.name}.bounds.max`);
        for (let component = 0; component < 3; component += 1) {
            if ((emitter.bounds.min[component] ?? 0) > (emitter.bounds.max[component] ?? 0)) {
                throw new RangeError(`${emitter.name}.bounds min must not exceed max`);
            }
        }
    }
    if (particleEmitterRequiresManualBounds(emitter) && emitter.bounds.mode !== 'manual') {
        throw new TypeError(`Particle emitter ${emitter.name} requires manual bounds`);
    }
    if (emitter.execution === 'gpu' && emitter.bounds.mode === 'dynamic') {
        throw new TypeError(
            `Particle emitter ${emitter.name} cannot use dynamic bounds with GPU execution`
        );
    }
}

/** Compile immutable particle definitions before any RHI frame begins. */
export function compileParticleSystemDefinition(
    definition: ParticleSystemDefinition,
    environment: Readonly<ParticleCompilationEnvironment> = {}
): Readonly<ParticleCompiledPlan> {
    const emitterNames = new Set(definition.emitters.map(emitter => emitter.name));
    for (const emitter of definition.emitters) {
        for (const module of emitter.modules) {
            if (module.type === 'sub-emitter' && !emitterNames.has(module.emitter)) {
                throw new TypeError(
                    `Particle emitter ${emitter.name} routes ${module.event} to missing emitter ${module.emitter}`
                );
            }
        }
    }
    const emitters = definition.emitters.map((emitter, index) => {
        validateEmitter(emitter, environment);
        const layout = buildAttributeLayout(emitter);
        const luts = collectLUTs(emitter);
        const statelessModules = analyzeParticleStatelessEligibility(emitter);
        const diagnostics = particleStatelessBlockingDiagnostics(statelessModules);
        const kind = selectPlanKind(emitter, environment, diagnostics);
        const layoutHash = hashParticleDefinition({
            capacity: emitter.capacity,
            attributes: layout.attributes
        });
        return Object.freeze({
            definition: emitter,
            emitterId: (Number.parseInt(emitter.hash, 16) ^ index) >>> 0,
            kind,
            attributes: layout.attributes,
            attributeByteLength: layout.byteLength,
            layoutHash,
            curveLUTs: luts.curves,
            gradientLUTs: luts.gradients,
            bounds: Object.freeze(deriveParticleEmitterBounds(emitter)),
            statelessEligible: diagnostics.length === 0,
            statelessDiagnostics: diagnostics,
            statelessModules,
            persistentStateByteLength:
                kind === 'stateless' ? 0 : layout.byteLength * (kind === 'gpu-stateful' ? 2 : 1)
        });
    });
    for (const source of emitters) {
        if (source.kind !== 'gpu-stateful') continue;
        for (const module of source.definition.modules) {
            if (module.type !== 'sub-emitter') continue;
            const target = emitters.find(candidate => candidate.definition.name === module.emitter);
            if (target?.kind !== 'gpu-stateful') {
                throw new TypeError(
                    `GPU particle emitter ${source.definition.name} cannot route ${module.event} through CPU emitter ${module.emitter}`
                );
            }
            if (
                Object.values(target.definition.initialize).some(
                    value => value instanceof ParticleParameter
                )
            ) {
                throw new TypeError(
                    `GPU particle sub-emitter ${module.emitter} cannot use runtime-bound initialization because event routing is GPU-resident`
                );
            }
        }
    }
    return Object.freeze({
        definition,
        hash: hashParticleDefinition({
            definition: definition.hash,
            backend: environment.backend ?? 'portable',
            threshold: environment.preferGPUAboveCapacity ?? 'none',
            advancedQuality: environment.advancedQuality ?? 'default',
            layouts: emitters.map(emitter => emitter.layoutHash)
        }),
        emitters: Object.freeze(emitters)
    });
}
