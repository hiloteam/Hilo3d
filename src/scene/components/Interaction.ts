import { defineComponent } from '../../ecs/Component';

export type PointerPropagation = 'target-only' | 'ancestors';

/** Opt-in interaction policy; Entity has no embedded dispatcher. */
export interface PointerTargetValue {
    readonly enabled?: boolean;
    readonly propagation?: PointerPropagation;
    readonly cursor?: string | null;
}

/** Marks an Entity as eligible for explicit pointer capture. */
export interface PointerCaptureValue {
    readonly enabled?: boolean;
}

export const PointerTarget = defineComponent<PointerTargetValue>('hilo3d/pointer-target');
export const PointerCapture = defineComponent<PointerCaptureValue>('hilo3d/pointer-capture');
