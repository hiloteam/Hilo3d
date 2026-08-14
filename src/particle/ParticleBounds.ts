import type { Bounds } from '../geometry/Geometry';
import type ParticleEmitterDefinition from './ParticleEmitterDefinition';
import type { ParticleModule, ParticleScalarValue, ParticleVector3Value } from './ParticleTypes';

function scalarMaximum(value: ParticleScalarValue | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    return typeof value === 'number'
        ? Math.abs(value)
        : Math.max(Math.abs(value.min), Math.abs(value.max));
}

function vectorMaximum(value: ParticleVector3Value | undefined): number {
    if (value === undefined) return 0;
    const maximum = (vector: readonly number[]): number => Math.hypot(...vector);
    if ('min' in value) return Math.max(maximum(value.min), maximum(value.max));
    return maximum(value);
}

function moduleAcceleration(module: ParticleModule): number {
    switch (module.type) {
        case 'force-over-lifetime':
        case 'gravity':
        case 'wind':
            return vectorMaximum(module.force);
        case 'radial-force':
        case 'orbital-force':
        case 'vortex-force':
        case 'point-attraction':
        case 'line-attraction':
            return scalarMaximum(module.strength, 0);
        case 'noise':
            return module.mode === 'force' ? vectorMaximum(module.strength) : 0;
        default:
            return 0;
    }
}

function shapeExtent(emitter: ParticleEmitterDefinition): readonly [number, number, number] {
    const shape = emitter.shape;
    switch (shape.type) {
        case 'point':
            return [0, 0, 0];
        case 'line':
        case 'edge':
            return [
                Math.max(Math.abs(shape.start[0]), Math.abs(shape.end[0])),
                Math.max(Math.abs(shape.start[1]), Math.abs(shape.end[1])),
                Math.max(Math.abs(shape.start[2]), Math.abs(shape.end[2]))
            ];
        case 'box':
            return [shape.size[0] / 2, shape.size[1] / 2, shape.size[2] / 2];
        case 'circle':
        case 'disc':
            return [shape.radius, shape.radius, 0];
        case 'sphere':
        case 'hemisphere':
            return [shape.radius, shape.radius, shape.radius];
        case 'cone': {
            const radius = Math.max(
                shape.radius,
                Math.tan((shape.angle * Math.PI) / 180) * (shape.length ?? 1)
            );
            return [radius, shape.length ?? 1, radius];
        }
        case 'torus':
        case 'donut': {
            const radius = shape.radius + shape.tubeRadius;
            return [radius, shape.tubeRadius, radius];
        }
    }
}

function rendererRadius(emitter: ParticleEmitterDefinition): number {
    let radiusScale = 0.5;
    for (const renderer of emitter.renderers) {
        if (renderer.type === 'mesh') {
            for (const asset of renderer.meshes) {
                radiusScale = Math.max(radiusScale, asset.geometry.getLocalSphereBounds().radius);
            }
        } else if (renderer.type === 'ribbon' || renderer.type === 'trail') {
            radiusScale = Math.max(radiusScale, (renderer.widthScale ?? 1) * 0.5);
        }
    }
    return scalarMaximum(emitter.initialize.size, 1) * radiusScale;
}

/** Return whether conservative automatic bounds are impossible for this emitter. */
export function particleEmitterRequiresManualBounds(emitter: ParticleEmitterDefinition): boolean {
    return emitter.modules.some(module => module.type === 'vector-field');
}

/** Derive conservative local bounds for analytic fixed modules. */
export function deriveParticleEmitterBounds(emitter: ParticleEmitterDefinition): Bounds {
    if (emitter.bounds.mode === 'manual') {
        const [xMin, yMin, zMin] = emitter.bounds.min;
        const [xMax, yMax, zMax] = emitter.bounds.max;
        return {
            x: (xMin + xMax) * 0.5,
            y: (yMin + yMax) * 0.5,
            z: (zMin + zMax) * 0.5,
            width: xMax - xMin,
            height: yMax - yMin,
            depth: zMax - zMin,
            xMin,
            xMax,
            yMin,
            yMax,
            zMin,
            zMax
        };
    }
    if (particleEmitterRequiresManualBounds(emitter)) {
        throw new TypeError(
            `Particle emitter ${emitter.name} requires manual bounds because vector-field sampling is not conservatively bounded`
        );
    }
    const extent = shapeExtent(emitter);
    const lifetime = scalarMaximum(emitter.initialize.lifetime, 1);
    const speed = scalarMaximum(emitter.initialize.speed, 0);
    const initialOffset = vectorMaximum(emitter.initialize.position);
    const acceleration = emitter.modules.reduce(
        (sum, module) => sum + moduleAcceleration(module),
        0
    );
    const noiseOffset = emitter.modules.reduce((maximum, module) => {
        if (module.type !== 'noise' || module.mode !== 'position-offset') return maximum;
        return Math.max(maximum, vectorMaximum(module.strength));
    }, 0);
    const size = rendererRadius(emitter);
    const travel =
        initialOffset +
        speed * lifetime +
        0.5 * acceleration * lifetime * lifetime +
        noiseOffset +
        size;
    const x = extent[0] + travel;
    const y = extent[1] + travel;
    const z = extent[2] + travel;
    return {
        x: 0,
        y: 0,
        z: 0,
        width: x * 2,
        height: y * 2,
        depth: z * 2,
        xMin: -x,
        xMax: x,
        yMin: -y,
        yMax: y,
        zMin: -z,
        zMax: z
    };
}
