import Texture from '../texture/Texture';

export interface SpriteFrameParameters {
    /** Atlas texture containing this frame. */
    texture: Texture;
    /** Left edge in source pixels. */
    x?: number;
    /** Top edge in source pixels. */
    y?: number;
    /** Frame width in source pixels. Defaults to the remaining texture width. */
    width?: number;
    /** Frame height in source pixels. Defaults to the remaining texture height. */
    height?: number;
    /** Optional per-frame duration in milliseconds. */
    duration?: number;
}

function finiteNonNegative(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be a finite non-negative number.`);
    }
}

function positive(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive finite number.`);
    }
}

/**
 * One rectangular texture-atlas frame.
 *
 * Pixel coordinates use the conventional top-left image origin. UV conversion accounts for the
 * texture's `flipY` policy so the same frame data works through WebGL2 and WebGPU.
 */
class SpriteFrame {
    readonly texture: Texture;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly duration: number | null;

    constructor(params: SpriteFrameParameters) {
        if (!(params.texture instanceof Texture)) {
            throw new TypeError('SpriteFrame.texture must be a Texture.');
        }
        const textureWidth = params.texture.origWidth;
        const textureHeight = params.texture.origHeight;
        positive(textureWidth, 'SpriteFrame texture width');
        positive(textureHeight, 'SpriteFrame texture height');
        const x = params.x ?? 0;
        const y = params.y ?? 0;
        finiteNonNegative(x, 'SpriteFrame.x');
        finiteNonNegative(y, 'SpriteFrame.y');
        const width = params.width ?? textureWidth - x;
        const height = params.height ?? textureHeight - y;
        positive(width, 'SpriteFrame.width');
        positive(height, 'SpriteFrame.height');
        if (x + width > textureWidth || y + height > textureHeight) {
            throw new RangeError('SpriteFrame rectangle must fit inside its texture.');
        }
        const duration = params.duration ?? null;
        if (duration !== null) positive(duration, 'SpriteFrame.duration');
        this.texture = params.texture;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.duration = duration;
    }

    /** Create a frame covering the complete texture. */
    static fromTexture(texture: Texture): SpriteFrame {
        return new SpriteFrame({ texture });
    }

    /**
     * Write the normalized `[u, v, width, height]` transform consumed by SpriteMaterial.
     * @param target - Reusable four-component output.
     */
    writeUVRect(target: Float32Array): Float32Array {
        if (target.length < 4) {
            throw new RangeError('SpriteFrame UV output must contain at least four components.');
        }
        const textureWidth = this.texture.origWidth;
        const textureHeight = this.texture.origHeight;
        positive(textureWidth, 'SpriteFrame texture width');
        positive(textureHeight, 'SpriteFrame texture height');
        target[0] = this.x / textureWidth;
        target[2] = this.width / textureWidth;
        if (this.texture.flipY) {
            target[1] = this.y / textureHeight;
            target[3] = this.height / textureHeight;
        } else {
            target[1] = (this.y + this.height) / textureHeight;
            target[3] = -this.height / textureHeight;
        }
        return target;
    }
}

export default SpriteFrame;
