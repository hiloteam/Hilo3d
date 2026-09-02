import {
    WORLD_SYSTEM_API_VERSION,
    type WorldSystem,
    type WorldSystemRuntime
} from '../../ecs/System';
import type { ComponentStore } from '../../ecs/Component';
import { getTransformStore, LocalTransform } from '../components/Transform';
import { Animator, AnimatorStore, MorphPose, type AnimationChannel } from '../components/Animation';
import { ChangedComponentStore } from '../components/Rendering';

function quaternionLength(x: number, y: number, z: number, w: number): number {
    let scale = Math.abs(x);
    const absoluteY = Math.abs(y);
    const absoluteZ = Math.abs(z);
    const absoluteW = Math.abs(w);
    if (absoluteY > scale) scale = absoluteY;
    if (absoluteZ > scale) scale = absoluteZ;
    if (absoluteW > scale) scale = absoluteW;
    if (scale === 0) return 0;
    const normalizedX = x / scale;
    const normalizedY = y / scale;
    const normalizedZ = z / scale;
    const normalizedW = w / scale;
    return (
        scale *
        Math.sqrt(
            normalizedX * normalizedX +
                normalizedY * normalizedY +
                normalizedZ * normalizedZ +
                normalizedW * normalizedW
        )
    );
}

function requireChangedStore<T>(store: ComponentStore<T>, name: string): ChangedComponentStore<T> {
    if (!isChangedStore(store)) {
        throw new TypeError(`${name} requires a change-tracked component store.`);
    }
    return store;
}

function isChangedStore<T>(store: ComponentStore<T>): store is ChangedComponentStore<T> {
    return store instanceof ChangedComponentStore;
}

function sample(channel: AnimationChannel, time: number, output: Float32Array): void {
    const keyCount = channel.times.length;
    let lower = 0;
    let upper = keyCount;
    while (lower < upper) {
        const middle = lower + ((upper - lower) >>> 1);
        if ((channel.times[middle] ?? 0) < time) lower = middle + 1;
        else upper = middle;
    }
    let right = lower;
    if (right === 0 || channel.interpolation === 'step') {
        const key = right === 0 ? 0 : right - 1;
        const valueOffset =
            channel.interpolation === 'cubic-spline'
                ? (key * 3 + 1) * channel.width
                : key * channel.width;
        for (let index = 0; index < channel.width; index++) {
            output[index] = channel.values[valueOffset + index] ?? 0;
        }
        return;
    }
    if (right >= keyCount) right = keyCount - 1;
    const left = right - 1;
    const leftTime = channel.times[left] ?? 0;
    const rightTime = channel.times[right] ?? leftTime;
    const alpha = rightTime === leftTime ? 0 : (time - leftTime) / (rightTime - leftTime);
    if (channel.interpolation === 'cubic-spline') {
        const duration = rightTime - leftTime;
        const alpha2 = alpha * alpha;
        const alpha3 = alpha2 * alpha;
        const h00 = 2 * alpha3 - 3 * alpha2 + 1;
        const h10 = alpha3 - 2 * alpha2 + alpha;
        const h01 = -2 * alpha3 + 3 * alpha2;
        const h11 = alpha3 - alpha2;
        for (let index = 0; index < channel.width; index++) {
            const leftValue = channel.values[(left * 3 + 1) * channel.width + index] ?? 0;
            const leftTangent = channel.values[(left * 3 + 2) * channel.width + index] ?? 0;
            const rightValue = channel.values[(right * 3 + 1) * channel.width + index] ?? leftValue;
            const rightTangent = channel.values[right * 3 * channel.width + index] ?? 0;
            output[index] =
                h00 * leftValue +
                h10 * duration * leftTangent +
                h01 * rightValue +
                h11 * duration * rightTangent;
        }
    } else {
        for (let index = 0; index < channel.width; index++) {
            const leftValue = channel.values[left * channel.width + index] ?? 0;
            const rightValue = channel.values[right * channel.width + index] ?? leftValue;
            output[index] = leftValue + (rightValue - leftValue) * alpha;
        }
    }
    if (channel.property === 'rotation' && channel.width === 4) {
        const length = quaternionLength(
            output[0] ?? 0,
            output[1] ?? 0,
            output[2] ?? 0,
            output[3] ?? 1
        );
        if (length > Number.EPSILON) {
            for (let index = 0; index < 4; index++) output[index] = (output[index] ?? 0) / length;
        }
    }
}

/** Create the batch animation System. */
export function createAnimationSystem(): WorldSystem {
    return {
        descriptor: {
            id: 'hilo3d/animation',
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: 'animation',
            access: { reads: [Animator], writes: [LocalTransform, MorphPose] }
        },
        setup(context): WorldSystemRuntime {
            const store = context.world.getStore(Animator);
            if (!(store instanceof AnimatorStore)) {
                throw new TypeError('Animator requires its SoA AnimatorStore.');
            }
            const transforms = getTransformStore(context.world);
            const morphs = requireChangedStore(context.world.getStore(MorphPose), 'MorphPose');
            let sampleValue = new Float32Array(4);
            return {
                execute(execution): void {
                    const deltaSeconds = execution.deltaTimeMilliseconds / 1000;
                    for (let denseIndex = 0; denseIndex < store.length; denseIndex++) {
                        const clip = store.clipAtDenseIndex(denseIndex);
                        const time = store.advanceAtDenseIndex(denseIndex, deltaSeconds);
                        let channelIndex = 0;
                        while (channelIndex < clip.channels.length) {
                            const channel = clip.channels[channelIndex];
                            channelIndex++;
                            if (!channel) continue;
                            if (!execution.world.isAlive(channel.target)) continue;
                            const entityIndex = execution.world.entityIndex(channel.target);
                            if (sampleValue.length < channel.width) {
                                sampleValue = new Float32Array(channel.width);
                            }
                            sample(channel, time, sampleValue);
                            if (channel.property === 'translation' && transforms.has(entityIndex)) {
                                transforms.setPosition(
                                    entityIndex,
                                    sampleValue[0] ?? 0,
                                    sampleValue[1] ?? 0,
                                    sampleValue[2] ?? 0
                                );
                            } else if (
                                channel.property === 'rotation' &&
                                transforms.has(entityIndex)
                            ) {
                                transforms.setRotation(
                                    entityIndex,
                                    sampleValue[0] ?? 0,
                                    sampleValue[1] ?? 0,
                                    sampleValue[2] ?? 0,
                                    sampleValue[3] ?? 1
                                );
                            } else if (
                                channel.property === 'scale' &&
                                transforms.has(entityIndex)
                            ) {
                                transforms.setScale(
                                    entityIndex,
                                    sampleValue[0] ?? 1,
                                    sampleValue[1] ?? 1,
                                    sampleValue[2] ?? 1
                                );
                            } else if (channel.property === 'weights' && morphs.has(entityIndex)) {
                                const weights = morphs.get(entityIndex).weights;
                                const count = Math.min(weights.length, channel.width);
                                for (let index = 0; index < count; index++) {
                                    weights[index] = sampleValue[index] ?? 0;
                                }
                                morphs.markChangedEntity(entityIndex);
                            }
                        }
                    }
                }
            };
        }
    };
}
