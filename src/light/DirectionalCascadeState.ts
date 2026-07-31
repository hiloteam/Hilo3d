import type LightManager from './LightManager';

export interface DirectionalCascadeState {
    readonly directionalCascadeSplits: Float32Array;
    readonly directionalCascadeParams: Float32Array;
    readonly directionalCascadeMatrices: Float32Array;
}

const states = new WeakMap<LightManager, Readonly<DirectionalCascadeState>>();

export function setDirectionalCascadeState(
    manager: LightManager,
    state: Readonly<DirectionalCascadeState>
): void {
    states.set(manager, state);
}

export function getDirectionalCascadeState(
    manager: LightManager
): Readonly<DirectionalCascadeState> | undefined {
    return states.get(manager);
}

export function clearDirectionalCascadeState(manager: LightManager): void {
    states.delete(manager);
}
