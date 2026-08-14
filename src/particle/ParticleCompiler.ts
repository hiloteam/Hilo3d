import { deriveParticleEmitterBounds, particleEmitterRequiresManualBounds } from './ParticleBounds';
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
import type ParticleSystemDefinition from './ParticleSystemDefinition';
import type {
    ParticleColorValue,
    ParticleModule,
    ParticleRange,
    ParticleScalarValue,
    ParticleShapeDefinition,
    ParticleVector3Value
} from './ParticleTypes';

/** Backend capabilities and optional automatic execution threshold used during plan selection. */
export interface ParticleCompilationEnvironment {
    readonly backend?: 'webgl2' | 'webgpu';
    readonly preferGPUAboveCapacity?: number;
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
    'noise-offset': { storage: 'f32', components: 3 }
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

function validateScalar(value: ParticleScalarValue | undefined, label: string): void {
    if (value === undefined) return;
    if (typeof value === 'number') {
        requireFinite(value, label);
        return;
    }
    requireFinite(value.min, `${label}.min`);
    requireFinite(value.max, `${label}.max`);
    if (value.min > value.max) throw new RangeError(`${label}.min must not exceed max`);
}

function validateVectorValue(value: ParticleVector3Value | undefined, label: string): void {
    if (value === undefined) return;
    if (isRange(value)) {
        validateVector(value.min, 3, `${label}.min`);
        validateVector(value.max, 3, `${label}.max`);
    } else {
        validateVector(value, 3, label);
    }
}

function validateColorValue(value: ParticleColorValue | undefined, label: string): void {
    if (value === undefined) return;
    if (isRange(value)) {
        validateVector(value.min, 4, `${label}.min`);
        validateVector(value.max, 4, `${label}.max`);
    } else {
        validateVector(value, 4, label);
    }
}

function validateShape(shape: ParticleShapeDefinition, label: string): void {
    if (shape.arc !== undefined) {
        requireFinite(shape.arc, `${label}.arc`);
        if (shape.arc <= 0 || shape.arc > Math.PI * 2) {
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
            return;
        case 'vector-field':
            requireFinite(module.strength, `${label}.strength`);
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
        attributes.add('sprite-frame');
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

function statelessDiagnostics(emitter: ParticleEmitterDefinition): string[] {
    const diagnostics: string[] = [];
    if (emitter.emission.rateOverDistance !== undefined) diagnostics.push('rate-over-distance');
    for (const module of emitter.modules) {
        if (
            (module.type === 'noise' && module.mode === 'force') ||
            module.type === 'vector-field' ||
            module.type.startsWith('kill-')
        ) {
            diagnostics.push(module.type);
        }
    }
    return diagnostics;
}

function selectPlanKind(
    emitter: ParticleEmitterDefinition,
    environment: Readonly<ParticleCompilationEnvironment>
): ParticleCompiledEmitterPlan['kind'] {
    const stateless = statelessDiagnostics(emitter);
    if (emitter.execution === 'stateless') {
        if (stateless.length > 0) {
            throw new TypeError(
                `Particle emitter ${emitter.name} is not stateless-compatible: ${stateless.join(', ')}`
            );
        }
        throw new TypeError(
            `Particle emitter ${emitter.name} requests the reserved P3 stateless execution mode`
        );
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
    if (
        environment.backend === 'webgpu' &&
        emitter.capacity >= (environment.preferGPUAboveCapacity ?? Number.POSITIVE_INFINITY)
    ) {
        return 'gpu-stateful';
    }
    return 'cpu-stateful';
}

function validateEmitter(emitter: ParticleEmitterDefinition): void {
    validateScalar(emitter.emission.rateOverTime, `${emitter.name}.emission.rateOverTime`);
    validateScalar(emitter.emission.rateOverDistance, `${emitter.name}.emission.rateOverDistance`);
    for (const [index, burst] of (emitter.emission.bursts ?? []).entries()) {
        requireFinite(burst.time, `${emitter.name}.bursts[${String(index)}].time`);
        if (burst.time < 0 || !Number.isSafeInteger(burst.count) || burst.count < 0) {
            throw new RangeError(`${emitter.name}.bursts[${String(index)}] is invalid`);
        }
    }
    validateShape(emitter.shape, `${emitter.name}.shape`);
    validateScalar(emitter.initialize.lifetime, `${emitter.name}.initialize.lifetime`);
    validateScalar(emitter.initialize.speed, `${emitter.name}.initialize.speed`);
    validateScalar(emitter.initialize.size, `${emitter.name}.initialize.size`);
    validateScalar(emitter.initialize.rotation, `${emitter.name}.initialize.rotation`);
    validateScalar(emitter.initialize.mass, `${emitter.name}.initialize.mass`);
    validateVectorValue(emitter.initialize.position, `${emitter.name}.initialize.position`);
    validateVectorValue(emitter.initialize.direction, `${emitter.name}.initialize.direction`);
    validateColorValue(emitter.initialize.color, `${emitter.name}.initialize.color`);
    for (const [index, module] of emitter.modules.entries()) {
        validateModule(module, `${emitter.name}.modules[${String(index)}]`);
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
    const emitters = definition.emitters.map((emitter, index) => {
        validateEmitter(emitter);
        const layout = buildAttributeLayout(emitter);
        const luts = collectLUTs(emitter);
        const diagnostics = Object.freeze(statelessDiagnostics(emitter));
        const layoutHash = hashParticleDefinition({
            capacity: emitter.capacity,
            attributes: layout.attributes
        });
        return Object.freeze({
            definition: emitter,
            emitterId: (Number.parseInt(emitter.hash, 16) ^ index) >>> 0,
            kind: selectPlanKind(emitter, environment),
            attributes: layout.attributes,
            attributeByteLength: layout.byteLength,
            layoutHash,
            curveLUTs: luts.curves,
            gradientLUTs: luts.gradients,
            bounds: Object.freeze(deriveParticleEmitterBounds(emitter)),
            statelessEligible: diagnostics.length === 0,
            statelessDiagnostics: diagnostics
        });
    });
    return Object.freeze({
        definition,
        hash: hashParticleDefinition({
            definition: definition.hash,
            backend: environment.backend ?? 'portable',
            threshold: environment.preferGPUAboveCapacity ?? 'none',
            layouts: emitters.map(emitter => emitter.layoutHash)
        }),
        emitters: Object.freeze(emitters)
    });
}
