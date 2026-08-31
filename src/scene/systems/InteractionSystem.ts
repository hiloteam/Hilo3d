import type { Entity } from '../../ecs/Entity';
import type { ComponentStore } from '../../ecs/Component';
import { defineWorldResource } from '../../ecs/Resource';
import {
    WORLD_SYSTEM_API_VERSION,
    type WorldSystem,
    type WorldSystemRuntime
} from '../../ecs/System';
import { getTransformStore, Hierarchy, type TransformStore } from '../components/Transform';
import {
    PointerCapture,
    PointerTarget,
    type PointerCaptureValue,
    type PointerTargetValue
} from '../components/Interaction';
import type World from '../../ecs/World';

export type PointerEventType =
    'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'pointerenter' | 'pointerleave';

/** Raw input after a picking implementation has resolved the target Entity. */
export interface PointerInput {
    readonly type: PointerEventType;
    readonly pointerId: number;
    readonly target: Entity | null;
    readonly x: number;
    readonly y: number;
    readonly button?: number;
    readonly buttons?: number;
}

/** One centralized event delivery; currentTarget reflects explicit hierarchy propagation. */
export interface PointerEventDelivery extends PointerInput {
    readonly target: Entity;
    readonly currentTarget: Entity;
}

/** Allocation-bounded pointer input, delivery, and capture queues. */
export class InteractionRuntime {
    private readonly inputs: PointerInput[] = [];
    private readonly deliveries: PointerEventDelivery[] = [];
    private readonly captures = new Map<number, Entity>();

    enqueue(input: PointerInput): void {
        if (!Number.isSafeInteger(input.pointerId) || input.pointerId < 0) {
            throw new RangeError('Pointer id must be a non-negative safe integer.');
        }
        if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
            throw new RangeError('Pointer coordinates must be finite.');
        }
        this.inputs.push(Object.freeze({ ...input }));
    }

    capture(pointerId: number, entity: Entity): void {
        this.captures.set(pointerId, entity);
    }

    release(pointerId: number): void {
        this.captures.delete(pointerId);
    }

    drain(): readonly PointerEventDelivery[] {
        const result = this.deliveries.slice();
        this.deliveries.length = 0;
        return Object.freeze(result);
    }

    /** @internal */
    process(
        world: World,
        targets: ComponentStore<PointerTargetValue>,
        captureTargets: ComponentStore<PointerCaptureValue>,
        transforms: TransformStore
    ): void {
        let index = 0;
        while (index < this.inputs.length) {
            const input = this.inputs[index];
            index++;
            if (!input) continue;
            let captured = this.captures.get(input.pointerId);
            if (captured !== undefined && !world.isAlive(captured)) {
                this.captures.delete(input.pointerId);
                captured = undefined;
            }
            const target = captured ?? input.target;
            if (target !== null && world.isAlive(target)) {
                const targetIndex = world.entityIndex(target);
                if (targets.has(targetIndex)) {
                    const policy = targets.get(targetIndex);
                    if (policy.enabled !== false) {
                        this.pushDelivery(input, target, target);
                        if (input.type === 'pointerdown' && captureTargets.has(targetIndex)) {
                            if (captureTargets.get(targetIndex).enabled !== false) {
                                this.capture(input.pointerId, target);
                            }
                        }
                        if (policy.propagation === 'ancestors' && transforms.has(targetIndex)) {
                            let parentIndex = transforms.parentIndexOf(targetIndex);
                            while (parentIndex >= 0) {
                                if (targets.has(parentIndex)) {
                                    const ancestor = world.entityAt(parentIndex);
                                    if (targets.get(parentIndex).enabled !== false) {
                                        this.pushDelivery(input, target, ancestor);
                                    }
                                }
                                parentIndex = transforms.has(parentIndex)
                                    ? transforms.parentIndexOf(parentIndex)
                                    : -1;
                            }
                        }
                    }
                }
            }
            if (input.type === 'pointerup' || input.type === 'pointercancel') {
                this.captures.delete(input.pointerId);
            }
        }
        this.inputs.length = 0;
    }

    /** @internal */
    pushDelivery(input: PointerInput, target: Entity, currentTarget: Entity): void {
        this.deliveries.push(Object.freeze({ ...input, target, currentTarget }));
    }

    /** @internal */
    clear(): void {
        this.inputs.length = 0;
        this.deliveries.length = 0;
        this.captures.clear();
    }
}

export const INTERACTION_RUNTIME = defineWorldResource<InteractionRuntime>(
    'hilo3d/interaction-runtime'
);

/** Create centralized pointer queue/capture/propagation processing. */
export function createInteractionSystem(): WorldSystem {
    return {
        descriptor: {
            id: 'hilo3d/interaction',
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: 'input',
            provides: [INTERACTION_RUNTIME],
            access: { reads: [PointerTarget, PointerCapture, Hierarchy] }
        },
        setup(context): WorldSystemRuntime {
            const targets = context.world.getStore(PointerTarget);
            const captures = context.world.getStore(PointerCapture);
            context.world.getStore(Hierarchy);
            const transforms = getTransformStore(context.world);
            const runtime = new InteractionRuntime();
            context.provide(INTERACTION_RUNTIME, runtime);
            return {
                execute(execution): void {
                    runtime.process(execution.world, targets, captures, transforms);
                },
                destroy(): void {
                    runtime.clear();
                }
            };
        }
    };
}
