import { defineComponent } from '../../ecs/Component';
import type { DirectionalLightShadowOptions } from '../../light/DirectionalLight';
import type { LightShadowOptions, PointLightShadowOptions } from '../../light/Light';
import type { SpotLightCookie, SpotLightIESProfile } from '../../light/SpotLight';
import { ChangedComponentStore } from './Rendering';

/** Linear RGB color used by light component data. */
export type LightColor = readonly [number, number, number];

/** Data shared by every light component. */
export interface LightComponentValue {
    readonly color?: LightColor;
    readonly amount?: number;
    readonly enabled?: boolean;
    readonly constantAttenuation?: number;
    readonly linearAttenuation?: number;
    readonly quadraticAttenuation?: number;
    readonly range?: number;
    readonly lightLayerMask?: number;
}

export type AmbientLightValue = LightComponentValue;

export interface DirectionalLightValue extends LightComponentValue {
    readonly direction?: readonly [number, number, number];
    readonly shadow?: DirectionalLightShadowOptions | null;
}

export interface PointLightValue extends LightComponentValue {
    readonly shadow?: PointLightShadowOptions | null;
}

export interface SpotLightValue extends LightComponentValue {
    readonly direction?: readonly [number, number, number];
    readonly cutoff?: number;
    readonly outerCutoff?: number;
    readonly cookie?: Readonly<SpotLightCookie> | null;
    readonly iesProfile?: Readonly<SpotLightIESProfile> | null;
    readonly shadow?: LightShadowOptions | null;
}

export interface AreaLightValue extends LightComponentValue {
    readonly width?: number;
    readonly height?: number;
}

function finite(value: number | undefined, fallback: number, label: string): number {
    const result = value ?? fallback;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite.`);
    return result;
}

function nonNegative(value: number | undefined, fallback: number, label: string): number {
    const result = finite(value, fallback, label);
    if (result < 0) throw new RangeError(`${label} must be non-negative.`);
    return result;
}

function positive(value: number | undefined, fallback: number, label: string): number {
    const result = finite(value, fallback, label);
    if (result <= 0) throw new RangeError(`${label} must be positive.`);
    return result;
}

function vector3(
    value: readonly [number, number, number] | undefined,
    fallback: readonly [number, number, number],
    label: string,
    requireNonZero = false
): readonly [number, number, number] {
    const x = finite(value?.[0], fallback[0], `${label} x`);
    const y = finite(value?.[1], fallback[1], `${label} y`);
    const z = finite(value?.[2], fallback[2], `${label} z`);
    if (requireNonZero && Math.hypot(x, y, z) === 0) {
        throw new RangeError(`${label} cannot be zero.`);
    }
    return Object.freeze([x, y, z]);
}

function common(value: LightComponentValue): Required<LightComponentValue> {
    const mask = value.lightLayerMask ?? 0xffffffff;
    if (!Number.isSafeInteger(mask) || mask < 0 || mask > 0xffffffff) {
        throw new RangeError('Light lightLayerMask must be an unsigned 32-bit integer.');
    }
    return {
        color: vector3(value.color, [1, 1, 1], 'Light color'),
        amount: nonNegative(value.amount, 1, 'Light amount'),
        enabled: value.enabled ?? true,
        constantAttenuation: nonNegative(value.constantAttenuation, 1, 'Light constantAttenuation'),
        linearAttenuation: nonNegative(value.linearAttenuation, 0, 'Light linearAttenuation'),
        quadraticAttenuation: nonNegative(
            value.quadraticAttenuation,
            0,
            'Light quadraticAttenuation'
        ),
        range: nonNegative(value.range, 0, 'Light range'),
        lightLayerMask: mask >>> 0
    };
}

function shadow<T extends LightShadowOptions>(value: T | null | undefined): T | null {
    if (value === null || value === undefined) return null;
    return Object.freeze({
        ...value,
        ...(value.cameraInfo === undefined
            ? {}
            : { cameraInfo: Object.freeze({ ...value.cameraInfo }) })
    });
}

function normalizeAmbient(value: AmbientLightValue): AmbientLightValue {
    return Object.freeze(common(value));
}

function normalizeDirectional(value: DirectionalLightValue): DirectionalLightValue {
    return Object.freeze({
        ...common(value),
        direction: vector3(value.direction, [0, 0, 1], 'DirectionalLight direction', true),
        shadow: shadow(value.shadow)
    });
}

function normalizePoint(value: PointLightValue): PointLightValue {
    return Object.freeze({ ...common(value), shadow: shadow(value.shadow) });
}

function normalizeSpot(value: SpotLightValue): SpotLightValue {
    const cutoff = finite(value.cutoff, 12.5, 'SpotLight cutoff');
    const outerCutoff = finite(value.outerCutoff, 17.5, 'SpotLight outerCutoff');
    if (cutoff < 0 || cutoff > 180 || outerCutoff < 0 || outerCutoff > 180) {
        throw new RangeError('SpotLight cone angles must be between zero and 180 degrees.');
    }
    return Object.freeze({
        ...common(value),
        direction: vector3(value.direction, [0, 0, 1], 'SpotLight direction', true),
        cutoff,
        outerCutoff,
        cookie:
            value.cookie === undefined || value.cookie === null
                ? null
                : Object.freeze({ ...value.cookie }),
        iesProfile:
            value.iesProfile === undefined || value.iesProfile === null
                ? null
                : Object.freeze({ ...value.iesProfile }),
        shadow: shadow(value.shadow)
    });
}

function normalizeArea(value: AreaLightValue): AreaLightValue {
    return Object.freeze({
        ...common(value),
        width: positive(value.width, 10, 'AreaLight width'),
        height: positive(value.height, 10, 'AreaLight height')
    });
}

/** Global ambient light component. */
export const AmbientLight = defineComponent<AmbientLightValue>(
    'hilo3d/ambient-light',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeAmbient)
);

/** Directional light component. Combine with LocalTransform. */
export const DirectionalLight = defineComponent<DirectionalLightValue>(
    'hilo3d/directional-light',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeDirectional)
);

/** Point light component. Combine with LocalTransform. */
export const PointLight = defineComponent<PointLightValue>(
    'hilo3d/point-light',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizePoint)
);

/** Spot light component. Combine with LocalTransform. */
export const SpotLight = defineComponent<SpotLightValue>(
    'hilo3d/spot-light',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeSpot)
);

/** Rectangular LTC area light component. Combine with LocalTransform. */
export const AreaLight = defineComponent<AreaLightValue>(
    'hilo3d/area-light',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeArea)
);
