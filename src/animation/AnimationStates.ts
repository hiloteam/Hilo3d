import math from '../math/math';
import Quaternion from '../math/Quaternion';
import Euler from '../math/Euler';
import Vector3 from '../math/Vector3';
import { requireNumber } from '../math/numberArray';
import type Node from '../core/Node';
import MorphGeometry from '../geometry/MorphGeometry';
import { getIndexFromSortedArray } from '../utils/util';

const tempQuaternions = [
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion(),
    new Quaternion()
];
const tempEuler = new Euler();
const tempNumbers: number[] = [];

export const STATE_TYPES = Object.freeze({
    TRANSLATE: 'Translation',
    POSITION: 'Translation',
    TRANSLATION: 'Translation',
    SCALE: 'Scale',
    ROTATE: 'Rotation',
    ROTATION: 'Rotation',
    QUATERNION: 'Quaternion',
    WEIGHTS: 'Weights'
});

export type BuiltInAnimationStateType = (typeof STATE_TYPES)[keyof typeof STATE_TYPES];
export type AnimationStateType = BuiltInAnimationStateType | (string & {});
export type AnimationStateHandler = (node: Node, state: unknown) => void;
export type AnimationInterpolationType = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

const NORMALIZED_STATE_TYPES: Record<string, BuiltInAnimationStateType> = {
    TRANSLATE: STATE_TYPES.TRANSLATE,
    POSITION: STATE_TYPES.POSITION,
    TRANSLATION: STATE_TYPES.TRANSLATION,
    SCALE: STATE_TYPES.SCALE,
    ROTATE: STATE_TYPES.ROTATE,
    ROTATION: STATE_TYPES.ROTATION,
    QUATERNION: STATE_TYPES.QUATERNION,
    WEIGHTS: STATE_TYPES.WEIGHTS
};

export interface AnimationStatesParameters {
    nodeName?: string;
    type?: AnimationStateType;
    interpolationType?: AnimationInterpolationType;
    keyTime?: number[];
    states?: unknown[];
}

export type InterpolatedValue = number | number[] | Vector3 | Quaternion;
export type InterpolationFunction = (
    first: unknown,
    second?: unknown,
    ratio?: number,
    timeRange?: number
) => InterpolatedValue;

function compareNumbers(first: number, second: number): number {
    return first - second;
}

function isArrayLikeValue(value: unknown): value is ArrayLike<unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const length: unknown = Reflect.get(value, 'length');
    return typeof length === 'number' && Number.isSafeInteger(length) && length >= 0;
}

function toNumberArray(value: unknown): number[] {
    if (!isArrayLikeValue(value)) {
        throw new TypeError('Animation state must be a numeric array.');
    }

    const result: number[] = [];
    for (let index = 0; index < value.length; index++) {
        const item = value[index];
        if (typeof item !== 'number') {
            throw new TypeError(`Animation state value at index ${String(index)} is not numeric.`);
        }
        result.push(item);
    }
    return result;
}

function cubicSpline(
    point0: ArrayLike<number>,
    tangent0: ArrayLike<number>,
    point1: ArrayLike<number>,
    tangent1: ArrayLike<number>,
    timeRange: number,
    ratio: number
): number[] {
    const ratioSquared = ratio * ratio;
    const ratioCubed = ratioSquared * ratio;
    const factor1 = 2 * ratioCubed - 3 * ratioSquared + 1;
    const factor2 = ratioCubed - 2 * ratioSquared + ratio;
    const factor3 = -2 * ratioCubed + 3 * ratioSquared;
    const factor4 = ratioCubed - ratioSquared;

    tempNumbers.length = 0;
    for (let index = 0; index < point0.length; index++) {
        tempNumbers[index] =
            requireNumber(point0, index) * factor1 +
            factor2 * requireNumber(tangent0, index) * timeRange +
            requireNumber(point1, index) * factor3 +
            factor4 * requireNumber(tangent1, index) * timeRange;
    }
    return tempNumbers;
}

const INTERPOLATION: Record<AnimationInterpolationType, InterpolationFunction> = {
    LINEAR(first, second, ratio = 0) {
        if (second === undefined) {
            if (
                typeof first === 'number' ||
                Array.isArray(first) ||
                first instanceof Vector3 ||
                first instanceof Quaternion
            ) {
                return first;
            }
            throw new TypeError('Unsupported animation state value.');
        }
        if (first instanceof Quaternion && second instanceof Quaternion) {
            return first.slerp(second, ratio);
        }
        if (first instanceof Vector3 && second instanceof Vector3) {
            return first.lerp(second, ratio);
        }
        if (isArrayLikeValue(first) && isArrayLikeValue(second)) {
            const firstValues = toNumberArray(first);
            const secondValues = toNumberArray(second);
            return firstValues.map((value, index) => {
                return value + ratio * (requireNumber(secondValues, index) - value);
            });
        }
        if (typeof first === 'number' && typeof second === 'number') {
            return first + ratio * (second - first);
        }
        throw new TypeError('Animation keyframes must have compatible value types.');
    },

    STEP(first) {
        return INTERPOLATION.LINEAR(first);
    },

    CUBICSPLINE(first, second, ratio = 0, timeRange = 0) {
        const firstFrame = Array.from(isArrayLikeValue(first) ? first : []);
        if (firstFrame.length === 0 || firstFrame.length % 3 !== 0) {
            throw new TypeError(
                'Cubic spline keyframes must contain input tangent, value and output tangent.'
            );
        }

        const itemLength = firstFrame.length / 3;
        if (second === undefined) {
            const value =
                itemLength === 1 ? firstFrame[1] : firstFrame.slice(itemLength, itemLength * 2);
            return INTERPOLATION.LINEAR(value);
        }

        const secondFrame = Array.from(isArrayLikeValue(second) ? second : []);
        if (secondFrame.length !== firstFrame.length) {
            throw new TypeError('Cubic spline keyframes must use the same component count.');
        }

        const point0 =
            itemLength === 1 ? firstFrame[1] : firstFrame.slice(itemLength, itemLength * 2);
        const tangent0 = itemLength === 1 ? firstFrame[2] : firstFrame.slice(itemLength * 2);
        const point1 =
            itemLength === 1 ? secondFrame[1] : secondFrame.slice(itemLength, itemLength * 2);
        const tangent1 = itemLength === 1 ? secondFrame[0] : secondFrame.slice(0, itemLength);

        if (
            point0 instanceof Vector3 &&
            tangent0 instanceof Vector3 &&
            point1 instanceof Vector3 &&
            tangent1 instanceof Vector3
        ) {
            return point0.hermite(
                point0,
                tangent0.scale(timeRange),
                point1,
                tangent1.scale(timeRange),
                ratio
            );
        }
        if (
            point0 instanceof Quaternion &&
            tangent0 instanceof Quaternion &&
            point1 instanceof Quaternion &&
            tangent1 instanceof Quaternion
        ) {
            point0.fromArray(
                cubicSpline(
                    point0.elements,
                    tangent0.elements,
                    point1.elements,
                    tangent1.elements,
                    timeRange,
                    ratio
                )
            );
            return point0.normalize();
        }

        const point0Values = typeof point0 === 'number' ? [point0] : toNumberArray(point0);
        const tangent0Values = typeof tangent0 === 'number' ? [tangent0] : toNumberArray(tangent0);
        const point1Values = typeof point1 === 'number' ? [point1] : toNumberArray(point1);
        const tangent1Values = typeof tangent1 === 'number' ? [tangent1] : toNumberArray(tangent1);
        const result = cubicSpline(
            point0Values,
            tangent0Values,
            point1Values,
            tangent1Values,
            timeRange,
            ratio
        );
        return itemLength === 1 ? requireNumber(result, 0) : result;
    }
};

/** A typed animation channel targeting one property of a scene node. */
class AnimationStates {
    static readonly interpolation = INTERPOLATION;
    static readonly StateType = STATE_TYPES;
    private static readonly extraTypes: Record<string, string> = {};
    private static readonly extraHandlers: Record<string, AnimationStateHandler> = {};

    static getType(name: string): AnimationStateType {
        const normalized = name.toUpperCase();
        const builtIn = NORMALIZED_STATE_TYPES[normalized];
        return builtIn ?? AnimationStates.extraTypes[normalized] ?? name;
    }

    static registerStateHandler(name: string, handler: AnimationStateHandler): void {
        AnimationStates.extraTypes[name.toUpperCase()] = name;
        AnimationStates.extraHandlers[name] = handler;
    }

    readonly id: string;
    readonly isAnimationStates = true;
    readonly className = 'AnimationStates';
    nodeName = '';
    type: AnimationStateType = '';
    interpolationType: AnimationInterpolationType = 'LINEAR';
    keyTime: number[] = [];
    states: unknown[] = [];
    private originalWeightIndices: number[] = [];

    constructor(params: AnimationStatesParameters = {}) {
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
    }

    findIndexByTime(time: number): [number, number] {
        if (this.keyTime.length === 0) return [0, 0];
        const indexArr = getIndexFromSortedArray(this.keyTime, time, compareNumbers);
        const low = Math.max(0, indexArr[0]);
        const high = Math.min(this.keyTime.length - 1, indexArr[1]);
        return [low, high];
    }

    getStateByIndex(index: number): unknown {
        if (this.keyTime.length === 0) return undefined;
        const itemLength = this.states.length / this.keyTime.length;
        if (itemLength === 1) return this.states[index];
        return this.states.slice(index * itemLength, index * itemLength + itemLength);
    }

    private convertRotationState(state: unknown, quaternion: boolean, offset = 0): unknown {
        if (isArrayLikeValue(state) && isArrayLikeValue(state[0])) {
            return Array.from(state, (value, index) => {
                const target = tempQuaternions[offset + index];
                if (!target)
                    throw new RangeError(
                        'Animation cubic spline contains too many tangent values.'
                    );
                return quaternion
                    ? target.fromArray(toNumberArray(value))
                    : target.fromEuler(tempEuler.fromArray(toNumberArray(value)));
            });
        }
        const target = tempQuaternions[offset];
        if (!target) throw new RangeError('Animation quaternion scratch value is unavailable.');
        return quaternion
            ? target.fromArray(toNumberArray(state))
            : target.fromEuler(tempEuler.fromArray(toNumberArray(state)));
    }

    getState(time: number): unknown {
        if (this.keyTime.length === 0) return undefined;
        const [firstIndex, secondIndex] = this.findIndexByTime(time);
        const firstTime = requireNumber(this.keyTime, firstIndex);
        const secondTime = requireNumber(this.keyTime, secondIndex);
        let firstState = this.getStateByIndex(firstIndex);

        if (this.interpolationType === 'STEP' || firstIndex === secondIndex) {
            const result = this.interpolation(firstState);
            if (this.type === STATE_TYPES.ROTATION) {
                return tempQuaternions[0]?.fromEuler(tempEuler.fromArray(toNumberArray(result)))
                    .elements;
            }
            return result instanceof Vector3 || result instanceof Quaternion
                ? result.elements
                : result;
        }

        let secondState = this.getStateByIndex(secondIndex);
        const timeRange = secondTime - firstTime;
        const ratio = timeRange === 0 ? 0 : (time - firstTime) / timeRange;
        if (this.type === STATE_TYPES.ROTATION) {
            firstState = this.convertRotationState(firstState, false);
            secondState = this.convertRotationState(secondState, false, 3);
        } else if (this.type === STATE_TYPES.QUATERNION) {
            firstState = this.convertRotationState(firstState, true);
            secondState = this.convertRotationState(secondState, true, 3);
        }

        const result = this.interpolation(firstState, secondState, ratio, timeRange);
        return result instanceof Vector3 || result instanceof Quaternion ? result.elements : result;
    }

    interpolation(
        first: unknown,
        second?: unknown,
        ratio?: number,
        timeRange?: number
    ): InterpolatedValue {
        return INTERPOLATION[this.interpolationType](first, second, ratio, timeRange);
    }

    updateNodeTranslation(node: Node, value: unknown): void {
        const values = toNumberArray(value);
        node.setPosition(
            requireNumber(values, 0),
            requireNumber(values, 1),
            requireNumber(values, 2)
        );
    }

    updateNodeScale(node: Node, value: unknown): void {
        const values = toNumberArray(value);
        node.setScale(requireNumber(values, 0), requireNumber(values, 1), requireNumber(values, 2));
    }

    updateNodeQuaternion(node: Node, value: unknown): void {
        node.quaternion.fromArray(toNumberArray(value));
    }

    updateNodeWeights(node: Node, value: unknown): void {
        const weights = typeof value === 'number' ? [value] : toNumberArray(value);
        this.originalWeightIndices = weights.map((_, index) => index);

        for (let index = 0; index < weights.length; index++) {
            for (let next = index + 1; next < weights.length; next++) {
                if (requireNumber(weights, next) > requireNumber(weights, index)) {
                    const weight = requireNumber(weights, index);
                    weights[index] = requireNumber(weights, next);
                    weights[next] = weight;
                    const originalIndex = requireNumber(this.originalWeightIndices, index);
                    this.originalWeightIndices[index] = requireNumber(
                        this.originalWeightIndices,
                        next
                    );
                    this.originalWeightIndices[next] = originalIndex;
                }
            }
        }

        node.traverse(mesh => {
            const geometry: unknown = Reflect.get(mesh, 'geometry');
            if (geometry instanceof MorphGeometry) {
                geometry.update(weights, this.originalWeightIndices);
            }
        });
    }

    updateNodeState(time: number, node?: Node): void {
        if (!node) return;
        const type = this.type === STATE_TYPES.ROTATION ? STATE_TYPES.QUATERNION : this.type;
        const state = this.getState(time);
        if (state === undefined) return;

        switch (type) {
            case STATE_TYPES.TRANSLATION:
                this.updateNodeTranslation(node, state);
                return;
            case STATE_TYPES.SCALE:
                this.updateNodeScale(node, state);
                return;
            case STATE_TYPES.QUATERNION:
                this.updateNodeQuaternion(node, state);
                return;
            case STATE_TYPES.WEIGHTS:
                this.updateNodeWeights(node, state);
                return;
            default: {
                const handler = AnimationStates.extraHandlers[type];
                if (handler) {
                    handler.call(this, node, state);
                } else {
                    throw new RangeError(`Unknown animation state type: ${type}`);
                }
            }
        }
    }

    clone(): AnimationStates {
        return new AnimationStates({
            keyTime: this.keyTime,
            states: this.states,
            type: this.type,
            nodeName: this.nodeName,
            interpolationType: this.interpolationType
        });
    }
}

export default AnimationStates;
