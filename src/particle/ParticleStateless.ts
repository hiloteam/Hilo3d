import type ParticleEmitterDefinition from './ParticleEmitterDefinition';
import type { ParticleModule } from './ParticleTypes';

/** How faithfully a fixed module can be reconstructed without cross-frame particle state. */
export type ParticleStatelessSupport = 'exact' | 'approximated' | 'stateful-only';

/** Asset-level stateless diagnostic retained by the compiled particle plan. */
export interface ParticleStatelessModuleMetadata {
    readonly moduleIndex: number;
    readonly moduleType: ParticleModule['type'] | 'rate-over-distance';
    readonly support: ParticleStatelessSupport;
    readonly reason: string;
}

const EXACT_MODULES = new Set<ParticleModule['type']>([
    'velocity-over-lifetime',
    'force-over-lifetime',
    'gravity',
    'wind',
    'drag',
    'alpha-over-lifetime',
    'size-over-lifetime',
    'rotation-over-lifetime',
    'frame-over-lifetime',
    'color-over-lifetime',
    'size-by-speed',
    'rotation-by-speed',
    'color-by-speed',
    'texture-sheet',
    'camera-offset',
    'camera-fade',
    'screen-space-size',
    'custom-channel'
]);

const APPROXIMATED_MODULES = new Set<ParticleModule['type']>([
    'limit-velocity',
    'radial-force',
    'orbital-force',
    'vortex-force',
    'point-attraction',
    'line-attraction',
    'rotate-around-point',
    'conform-sphere',
    'lifetime-by-emitter-speed'
]);

function metadataForModule(
    module: ParticleModule,
    moduleIndex: number
): ParticleStatelessModuleMetadata {
    if (module.type === 'noise') {
        return Object.freeze({
            moduleIndex,
            moduleType: module.type,
            support: module.mode === 'position-offset' ? 'exact' : 'stateful-only',
            reason:
                module.mode === 'position-offset'
                    ? 'immutable spawn position and absolute age fully determine the display offset'
                    : 'force noise feeds velocity back into later simulation steps'
        });
    }
    if (EXACT_MODULES.has(module.type)) {
        return Object.freeze({
            moduleIndex,
            moduleType: module.type,
            support: 'exact',
            reason: 'absolute age, spawn attributes and baked LUT data fully determine the result'
        });
    }
    if (APPROXIMATED_MODULES.has(module.type)) {
        return Object.freeze({
            moduleIndex,
            moduleType: module.type,
            support: 'approximated',
            reason: 'the stateless generator evaluates a bounded fixed-sample integration'
        });
    }
    return Object.freeze({
        moduleIndex,
        moduleType: module.type,
        support: 'stateful-only',
        reason:
            module.type === 'inherit-emitter-velocity'
                ? 'spawn-time emitter velocity requires transform history'
                : module.type === 'vector-field'
                  ? 'texture-driven force feeds velocity back into later steps'
                  : 'conditional kill behavior changes the surviving spawn interval'
    });
}

/** Analyze the complete fixed module set without compiling renderer or backend objects. */
export function analyzeParticleStatelessEligibility(
    emitter: ParticleEmitterDefinition
): readonly Readonly<ParticleStatelessModuleMetadata>[] {
    const metadata: ParticleStatelessModuleMetadata[] = [];
    if (emitter.emission.rateOverDistance !== undefined) {
        metadata.push(
            Object.freeze({
                moduleIndex: -1,
                moduleType: 'rate-over-distance',
                support: 'stateful-only',
                reason: 'distance emission requires emitter transform history'
            })
        );
    }
    for (const [index, module] of emitter.modules.entries()) {
        metadata.push(metadataForModule(module, index));
    }
    return Object.freeze(metadata);
}

/** Return only the diagnostics that prevent selection of a stateless execution plan. */
export function particleStatelessBlockingDiagnostics(
    metadata: readonly Readonly<ParticleStatelessModuleMetadata>[]
): readonly string[] {
    return Object.freeze(
        metadata
            .filter(entry => entry.support === 'stateful-only')
            .map(entry => `${entry.moduleType}: ${entry.reason}`)
    );
}
