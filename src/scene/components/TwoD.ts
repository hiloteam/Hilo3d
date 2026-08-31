import { defineComponent } from '../../ecs/Component';
import PlaneGeometry from '../../geometry/PlaneGeometry';
import type Color from '../../math/Color';
import SpriteFrame from '../../2d/SpriteFrame';
import SpriteMaterial from '../../2d/SpriteMaterial';
import type Texture from '../../texture/Texture';
import { ChangedComponentStore } from './Rendering';

const SHARED_SPRITE_GEOMETRY = new PlaneGeometry({ width: 1, height: 1 });

/** Batched sprite renderer data composed with LocalTransform and RenderOrder. */
export interface SpriteRendererValue {
    readonly frame?: SpriteFrame;
    readonly texture?: Texture;
    readonly material?: SpriteMaterial;
    readonly width?: number;
    readonly height?: number;
    readonly anchorX?: number;
    readonly anchorY?: number;
    readonly tint?: Color | readonly [number, number, number, number];
}

/** Time-based frame sequence; SpriteAnimationSystem updates SpriteRenderer only on frame changes. */
export interface SpriteAnimationValue {
    readonly frames: readonly SpriteFrame[];
    readonly frameRate?: number;
    readonly loop?: boolean;
    readonly playing?: boolean;
    readonly currentFrame?: number;
}

/** Canvas text authoring data rasterized by CanvasTextSystem. */
export interface CanvasTextValue {
    readonly text: string;
    readonly font?: string;
    readonly fillStyle?: string;
    readonly padding?: number;
    readonly resolution?: number;
}

export interface NormalizedSpriteRendererValue {
    readonly geometry: PlaneGeometry;
    readonly material: SpriteMaterial;
    readonly uvRect: Float32Array;
    readonly sizeAnchor: Float32Array;
    readonly tint: Float32Array;
}

function positive(value: number | undefined, fallback: number, label: string): number {
    const result = value ?? fallback;
    if (!Number.isFinite(result) || result <= 0) {
        throw new RangeError(`${label} must be finite and positive.`);
    }
    return result;
}

function finite(value: number | undefined, fallback: number, label: string): number {
    const result = value ?? fallback;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite.`);
    return result;
}

function normalizeSprite(value: SpriteRendererValue): NormalizedSpriteRendererValue {
    const frame =
        value.frame ??
        (value.texture ? SpriteFrame.fromTexture(value.texture) : undefined) ??
        (value.material ? SpriteFrame.fromTexture(value.material.texture) : undefined);
    if (!frame) throw new TypeError('SpriteRenderer requires a frame, texture, or material.');
    const uvRect = new Float32Array(4);
    frame.writeUVRect(uvRect);
    const tintInput = value.tint;
    const tint = new Float32Array([
        tintInput && 'r' in tintInput ? tintInput.r : (tintInput?.[0] ?? 1),
        tintInput && 'g' in tintInput ? tintInput.g : (tintInput?.[1] ?? 1),
        tintInput && 'b' in tintInput ? tintInput.b : (tintInput?.[2] ?? 1),
        tintInput && 'a' in tintInput ? tintInput.a : (tintInput?.[3] ?? 1)
    ]);
    return Object.freeze({
        geometry: SHARED_SPRITE_GEOMETRY,
        material: value.material ?? SpriteMaterial.forTexture(frame.texture),
        uvRect,
        sizeAnchor: new Float32Array([
            positive(value.width, frame.width, 'Sprite width'),
            positive(value.height, frame.height, 'Sprite height'),
            finite(value.anchorX, 0.5, 'Sprite anchorX'),
            finite(value.anchorY, 0.5, 'Sprite anchorY')
        ]),
        tint
    });
}

function normalizeAnimation(value: SpriteAnimationValue): SpriteAnimationValue {
    if (value.frames.length === 0 || value.frames.some(frame => !(frame instanceof SpriteFrame))) {
        throw new TypeError('SpriteAnimation frames must contain SpriteFrame resources.');
    }
    const frameRate = positive(value.frameRate, 12, 'Sprite frameRate');
    const currentFrame = value.currentFrame ?? 0;
    if (
        !Number.isSafeInteger(currentFrame) ||
        currentFrame < 0 ||
        currentFrame >= value.frames.length
    ) {
        throw new RangeError('SpriteAnimation currentFrame is out of range.');
    }
    return {
        frames: Object.freeze([...value.frames]),
        frameRate,
        loop: value.loop ?? true,
        playing: value.playing ?? true,
        currentFrame
    };
}

function normalizeText(value: CanvasTextValue): CanvasTextValue {
    const padding = value.padding ?? 0;
    const resolution = value.resolution ?? 1;
    if (
        !Number.isFinite(padding) ||
        padding < 0 ||
        !Number.isFinite(resolution) ||
        resolution <= 0
    ) {
        throw new RangeError('CanvasText padding/resolution values are invalid.');
    }
    return Object.freeze({
        text: value.text,
        font: value.font ?? '16px sans-serif',
        fillStyle: value.fillStyle ?? '#ffffff',
        padding,
        resolution
    });
}

export const SpriteRenderer = defineComponent<NormalizedSpriteRendererValue>(
    'hilo3d/sprite-renderer',
    initialCapacity =>
        new ChangedComponentStore(initialCapacity, value => {
            if (
                !(value.geometry instanceof PlaneGeometry) ||
                !(value.material instanceof SpriteMaterial) ||
                value.uvRect.length !== 4 ||
                value.sizeAnchor.length !== 4 ||
                value.tint.length !== 4
            ) {
                throw new TypeError('SpriteRenderer requires createSpriteRenderer() output.');
            }
            return value;
        })
);

/** Normalize authoring data before adding SpriteRenderer to a World. */
export function createSpriteRenderer(value: SpriteRendererValue): NormalizedSpriteRendererValue {
    return normalizeSprite(value);
}

export const SpriteAnimation = defineComponent<SpriteAnimationValue>(
    'hilo3d/sprite-animation',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeAnimation)
);

export const CanvasText = defineComponent<CanvasTextValue>(
    'hilo3d/canvas-text',
    initialCapacity => new ChangedComponentStore(initialCapacity, normalizeText)
);
