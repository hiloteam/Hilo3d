import { DEFAULT_2D_LAYER } from '../camera/Camera2D';
import Mesh, { type MeshParameters } from '../core/Mesh';
import PlaneGeometry from '../geometry/PlaneGeometry';
import Matrix4 from '../math/Matrix4';
import Ray from '../math/Ray';
import type Vector3 from '../math/Vector3';
import Color from '../math/Color';
import type Texture from '../texture/Texture';
import SpriteFrame from './SpriteFrame';
import SpriteMaterial from './SpriteMaterial';

const sharedSpriteGeometry = new PlaneGeometry({ width: 1, height: 1 });
const localRay = new Ray();
const inverseWorld = new Matrix4();
const spritePlaneNormal = [0, 0, 1] as const;

export interface SpriteParameters extends Omit<
    MeshParameters,
    'geometry' | 'material' | 'useInstanced' | 'frustumTest'
> {
    /** Full texture shorthand when no explicit frame list is supplied. */
    texture?: Texture;
    /** Initial frame shorthand. */
    frame?: SpriteFrame;
    /** Sequence frames, normally from one shared texture atlas. */
    frames?: readonly SpriteFrame[];
    /** Optional customized material. Sprites sharing a material can batch together. */
    material?: SpriteMaterial;
    /** Logical display width. Defaults to the initial frame width. */
    width?: number;
    /** Logical display height. Defaults to the initial frame height. */
    height?: number;
    /** Horizontal anchor in normalized local coordinates. Defaults to the visual center (`0.5`). */
    anchorX?: number;
    /** Vertical anchor in normalized local coordinates. Defaults to the visual center (`0.5`). */
    anchorY?: number;
    /** Per-instance color multiplier. */
    tint?: Color;
    /** Default animation rate when frames do not carry an explicit duration. */
    frameRate?: number;
    /** Whether sequence playback wraps at the end. */
    loop?: boolean;
    /** Start sequence playback immediately when more than one frame exists. */
    autoPlay?: boolean;
}

export interface SpriteFrameUpdateOptions {
    /** Resize the logical Sprite bounds to the new frame. Defaults to `false`. */
    resize?: boolean;
}

export interface SpriteFramesUpdateOptions extends SpriteFrameUpdateOptions {
    /** Frame to display after replacement. Defaults to zero. */
    currentFrame?: number;
    /** Start playback after replacement. Defaults to `false`. */
    autoPlay?: boolean;
}

function positiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive finite number.`);
    }
}

function finite(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

function resolveFrames(params: SpriteParameters): SpriteFrame[] {
    if (params.frames !== undefined) {
        if (params.frames.length === 0) {
            throw new RangeError('Sprite.frames must contain at least one frame.');
        }
        for (const frame of params.frames) {
            if (!(frame instanceof SpriteFrame)) {
                throw new TypeError('Sprite.frames must contain only SpriteFrame instances.');
            }
        }
        return [...params.frames];
    }
    if (params.frame !== undefined) {
        if (!(params.frame instanceof SpriteFrame)) {
            throw new TypeError('Sprite.frame must be a SpriteFrame.');
        }
        return [params.frame];
    }
    if (params.texture !== undefined) return [SpriteFrame.fromTexture(params.texture)];
    if (params.material !== undefined) return [SpriteFrame.fromTexture(params.material.texture)];
    throw new TypeError('Sprite requires texture, frame, or frames.');
}

function resolveNodeParameters(
    params: SpriteParameters
): Omit<MeshParameters, 'geometry' | 'material' | 'useInstanced' | 'frustumTest'> {
    const result = { ...params };
    for (const property of [
        'texture',
        'frame',
        'frames',
        'material',
        'width',
        'height',
        'anchorX',
        'anchorY',
        'tint',
        'frameRate',
        'loop',
        'autoPlay'
    ] as const) {
        Reflect.deleteProperty(result, property);
    }
    return result;
}

/**
 * Batched 2D sprite with atlas frames, per-instance tint/anchor/size, animation, and CPU hit tests.
 *
 * Sprites use one shared quad geometry and opt into the renderer's portable instance path. They
 * render by Node `sortingLayer`, then `zIndex`, then stable scene-tree order. Adjacent Sprites using
 * the same SpriteMaterial are grouped into draws of at most 128 instances on both backends without
 * allowing batching to change that display order.
 */
class Sprite extends Mesh {
    static override readonly typeName: string = 'Sprite';
    readonly isSprite = true;
    override className = 'Sprite';
    declare material: SpriteMaterial;
    readonly frames: SpriteFrame[];
    readonly tint: Color;
    readonly spriteUVRect = new Float32Array(4);
    readonly spriteSizeAnchor = new Float32Array([1, 1, 0.5, 0.5]);
    get spriteTint(): ArrayLike<number> {
        return this.tint.elements;
    }
    private frameRateValue = 12;
    private elapsedInFrame = 0;
    private currentFrameValue = 0;
    private autoSize = true;
    playing = false;
    loop = true;

    constructor(params: SpriteParameters) {
        const frames = resolveFrames(params);
        const initialFrame = frames[0];
        if (!initialFrame) throw new Error('Sprite lost its initial frame.');
        super({
            ...resolveNodeParameters(params),
            layer: params.layer ?? DEFAULT_2D_LAYER,
            geometry: sharedSpriteGeometry,
            material: params.material ?? SpriteMaterial.forTexture(initialFrame.texture),
            useInstanced: true,
            // The shared unit geometry does not describe the instance-sized bounds.
            frustumTest: false
        });
        if (frames.length > 1) this.enableUpdateHook();
        this.frames = frames;
        this.tint = params.tint
            ? new Color(params.tint.r, params.tint.g, params.tint.b, params.tint.a)
            : new Color(1, 1, 1, 1);
        this.loop = params.loop ?? true;
        this.frameRate = params.frameRate ?? 12;
        this.autoSize = params.width === undefined && params.height === undefined;
        this.spriteSizeAnchor[0] = params.width ?? initialFrame.width;
        this.spriteSizeAnchor[1] = params.height ?? initialFrame.height;
        this.anchorX = params.anchorX ?? 0.5;
        this.anchorY = params.anchorY ?? 0.5;
        this.applyFrame(0, false);
        this.playing = (params.autoPlay ?? true) && frames.length > 1;
    }

    /** Current frame index. */
    get currentFrame(): number {
        return this.currentFrameValue;
    }

    /** Logical display width before Node scale. */
    get width(): number {
        return this.spriteSizeAnchor[0] ?? 0;
    }
    set width(value: number) {
        positiveFinite(value, 'Sprite.width');
        this.spriteSizeAnchor[0] = value;
        this.autoSize = false;
    }

    /** Logical display height before Node scale. */
    get height(): number {
        return this.spriteSizeAnchor[1] ?? 0;
    }
    set height(value: number) {
        positiveFinite(value, 'Sprite.height');
        this.spriteSizeAnchor[1] = value;
        this.autoSize = false;
    }

    /** Horizontal normalized anchor. */
    get anchorX(): number {
        return this.spriteSizeAnchor[2] ?? 0.5;
    }
    set anchorX(value: number) {
        finite(value, 'Sprite.anchorX');
        this.spriteSizeAnchor[2] = value;
    }

    /** Vertical normalized anchor. */
    get anchorY(): number {
        return this.spriteSizeAnchor[3] ?? 0.5;
    }
    set anchorY(value: number) {
        finite(value, 'Sprite.anchorY');
        this.spriteSizeAnchor[3] = value;
    }

    /** Frames per second used for frames without `SpriteFrame.duration`. */
    get frameRate(): number {
        return this.frameRateValue;
    }
    set frameRate(value: number) {
        positiveFinite(value, 'Sprite.frameRate');
        this.frameRateValue = value;
    }

    /** Start or resume sequence playback. */
    play(): this {
        this.playing = this.frames.length > 1;
        if (this.playing) this.enableUpdateHook();
        return this;
    }

    /** Pause sequence playback without changing the frame. */
    pause(): this {
        this.playing = false;
        return this;
    }

    /** Stop playback and return to frame zero. */
    stop(): this {
        this.playing = false;
        this.elapsedInFrame = 0;
        return this.gotoFrame(0);
    }

    /**
     * Display a frame immediately.
     * @param index - Integer frame index.
     */
    gotoFrame(index: number): this {
        this.applyFrame(index, true);
        this.elapsedInFrame = 0;
        return this;
    }

    /**
     * Replace the complete texture and display it as one frame.
     * @param texture - New complete-frame texture.
     * @param options - Optional logical-size update.
     */
    setTexture(texture: Texture, options: SpriteFrameUpdateOptions = {}): this {
        return this.setFrame(SpriteFrame.fromTexture(texture), options);
    }

    /**
     * Replace the active source with one atlas frame.
     * @param frame - New frame.
     * @param options - Optional logical-size update.
     */
    setFrame(frame: SpriteFrame, options: SpriteFrameUpdateOptions = {}): this {
        const replacementOptions: SpriteFramesUpdateOptions = {
            currentFrame: 0,
            autoPlay: false
        };
        if (options.resize !== undefined) replacementOptions.resize = options.resize;
        return this.setFrames([frame], replacementOptions);
    }

    /**
     * Replace the animation sequence without recreating the Sprite.
     *
     * Existing UV, size, and tint arrays are mutated in place so renderer-side instance storage
     * remains reusable.
     * @param frames - Non-empty replacement sequence.
     * @param options - Initial frame, playback, and resize behavior.
     */
    setFrames(frames: readonly SpriteFrame[], options: SpriteFramesUpdateOptions = {}): this {
        const replacement = resolveFrames({ frames });
        const currentFrame = options.currentFrame ?? 0;
        if (
            !Number.isSafeInteger(currentFrame) ||
            currentFrame < 0 ||
            currentFrame >= replacement.length
        ) {
            throw new RangeError(
                `Sprite replacement frame index ${String(currentFrame)} is out of range.`
            );
        }
        this.frames.splice(0, this.frames.length, ...replacement);
        if (options.resize !== undefined) this.autoSize = options.resize;
        this.elapsedInFrame = 0;
        this.playing = (options.autoPlay ?? false) && replacement.length > 1;
        if (replacement.length > 1) this.enableUpdateHook();
        this.applyFrame(currentFrame, true);
        return this;
    }

    override update(dt: number): void {
        if (!this.playing || this.frames.length < 2 || !Number.isFinite(dt) || dt <= 0) return;
        this.elapsedInFrame += dt;
        let remainingTransitions = 10_000;
        while (remainingTransitions-- > 0) {
            const frame = this.frames[this.currentFrameValue];
            if (!frame) throw new Error('Sprite animation frame storage is incomplete.');
            const duration = frame.duration ?? 1000 / this.frameRateValue;
            if (this.elapsedInFrame < duration) return;
            this.elapsedInFrame -= duration;
            const next = this.currentFrameValue + 1;
            if (next < this.frames.length) {
                this.applyFrame(next, true);
                continue;
            }
            if (this.loop) {
                this.applyFrame(0, true);
                this.fire('loop');
                continue;
            }
            this.playing = false;
            this.elapsedInFrame = 0;
            this.fire('complete');
            return;
        }
        throw new RangeError('Sprite animation delta produced too many frame transitions.');
    }

    override raycast(ray: Ray, _sort = true): Vector3[] | null {
        if (!this.visible) return null;
        inverseWorld.invert(this.worldMatrix);
        localRay.copy(ray);
        localRay.transformMat4(inverseWorld);
        const point = localRay.intersectsPlane(spritePlaneNormal, 0);
        if (!point) return null;
        const left = -this.anchorX * this.width;
        const top = -this.anchorY * this.height;
        if (
            point.x < left ||
            point.x > left + this.width ||
            point.y < top ||
            point.y > top + this.height
        ) {
            return null;
        }
        point.transformMat4(this.worldMatrix);
        return [point];
    }

    private applyFrame(index: number, notify: boolean): void {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.frames.length) {
            throw new RangeError(`Sprite frame index ${String(index)} is out of range.`);
        }
        const frame = this.frames[index];
        if (!frame) throw new Error('Sprite frame storage is incomplete.');
        frame.writeUVRect(this.spriteUVRect);
        const currentMaterial = this.material;
        if (
            !(currentMaterial instanceof SpriteMaterial) ||
            currentMaterial.texture !== frame.texture
        ) {
            this.material = SpriteMaterial.forTexture(frame.texture);
        }
        if (this.autoSize) {
            this.spriteSizeAnchor[0] = frame.width;
            this.spriteSizeAnchor[1] = frame.height;
        }
        this.currentFrameValue = index;
        if (notify) this.fire('framechange', index);
    }
}

export default Sprite;
