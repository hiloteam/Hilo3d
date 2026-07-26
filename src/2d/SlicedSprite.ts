import { DEFAULT_2D_LAYER } from '../camera/Camera2D';
import Node, { type NodeParameters } from '../core/Node';
import type Texture from '../texture/Texture';
import Sprite from './Sprite';
import SpriteFrame from './SpriteFrame';

export interface SlicedSpriteInsets {
    /** Fixed source pixels at the left edge. */
    left: number;
    /** Fixed source pixels at the right edge. */
    right: number;
    /** Fixed source pixels at the top edge. */
    top: number;
    /** Fixed source pixels at the bottom edge. */
    bottom: number;
}

export interface SlicedSpriteParameters extends NodeParameters {
    /** Source atlas frame. */
    frame?: SpriteFrame;
    /** Complete source texture shorthand. */
    texture?: Texture;
    /** Fixed corner and edge sizes in source pixels. */
    insets: SlicedSpriteInsets;
    /** Logical display width. Defaults to the source frame width. */
    width?: number;
    /** Logical display height. Defaults to the source frame height. */
    height?: number;
    /** Horizontal normalized anchor. Defaults to zero. */
    anchorX?: number;
    /** Vertical normalized anchor. Defaults to zero. */
    anchorY?: number;
}

function positive(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive finite number.`);
    }
}

function finite(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
}

function resolveFrame(params: SlicedSpriteParameters): SpriteFrame {
    if (params.frame) return params.frame;
    if (params.texture) return SpriteFrame.fromTexture(params.texture);
    throw new TypeError('SlicedSprite requires frame or texture.');
}

function validateInsets(frame: SpriteFrame, insets: SlicedSpriteInsets): void {
    positive(insets.left, 'SlicedSprite.insets.left');
    positive(insets.right, 'SlicedSprite.insets.right');
    positive(insets.top, 'SlicedSprite.insets.top');
    positive(insets.bottom, 'SlicedSprite.insets.bottom');
    if (insets.left + insets.right >= frame.width) {
        throw new RangeError('SlicedSprite horizontal insets must leave a positive center width.');
    }
    if (insets.top + insets.bottom >= frame.height) {
        throw new RangeError('SlicedSprite vertical insets must leave a positive center height.');
    }
}

function resolveNodeParameters(params: SlicedSpriteParameters): NodeParameters {
    const result = { ...params };
    for (const property of [
        'frame',
        'texture',
        'insets',
        'width',
        'height',
        'anchorX',
        'anchorY'
    ] as const) {
        Reflect.deleteProperty(result, property);
    }
    return result;
}

/**
 * Nine-slice panel that preserves source corners while stretching edges and center.
 *
 * The nine child Sprites share one atlas material and remain adjacent, allowing the normal Sprite
 * batcher to submit the panel as one instanced draw when display ordering permits.
 */
class SlicedSprite extends Node {
    static override readonly typeName: string = 'SlicedSprite';
    readonly isSlicedSprite = true;
    override className = 'SlicedSprite';
    readonly insets: Readonly<SlicedSpriteInsets>;
    readonly parts: readonly Sprite[];
    private readonly frameSlices = new WeakMap<SpriteFrame, readonly SpriteFrame[]>();
    private frameValue: SpriteFrame;
    private widthValue: number;
    private heightValue: number;
    private anchorXValue: number;
    private anchorYValue: number;

    constructor(params: SlicedSpriteParameters) {
        const frame = resolveFrame(params);
        validateInsets(frame, params.insets);
        const width = params.width ?? frame.width;
        const height = params.height ?? frame.height;
        positive(width, 'SlicedSprite.width');
        positive(height, 'SlicedSprite.height');
        if (width < params.insets.left + params.insets.right) {
            throw new RangeError('SlicedSprite.width must fit its horizontal insets.');
        }
        if (height < params.insets.top + params.insets.bottom) {
            throw new RangeError('SlicedSprite.height must fit its vertical insets.');
        }
        super(resolveNodeParameters(params));
        this.frameValue = frame;
        this.insets = Object.freeze({ ...params.insets });
        this.widthValue = width;
        this.heightValue = height;
        this.anchorXValue = params.anchorX ?? 0;
        this.anchorYValue = params.anchorY ?? 0;
        finite(this.anchorXValue, 'SlicedSprite.anchorX');
        finite(this.anchorYValue, 'SlicedSprite.anchorY');

        const frames = this.createFrames(frame);
        const layer = params.layer ?? DEFAULT_2D_LAYER;
        const parts = frames.map(
            partFrame =>
                new Sprite({
                    frame: partFrame,
                    anchorX: 0,
                    anchorY: 0,
                    layer,
                    ...(params.sortingLayer === undefined
                        ? {}
                        : { sortingLayer: params.sortingLayer }),
                    ...(params.zIndex === undefined ? {} : { zIndex: params.zIndex }),
                    ...(params.useHandCursor === undefined
                        ? {}
                        : { useHandCursor: params.useHandCursor }),
                    autoPlay: false
                })
        );
        this.parts = Object.freeze(parts);
        for (const part of parts) this.addChild(part);
        this.layoutParts();
    }

    /** Active source atlas frame. */
    get frame(): SpriteFrame {
        return this.frameValue;
    }

    /** Logical panel width. */
    get width(): number {
        return this.widthValue;
    }
    set width(value: number) {
        this.setSize(value, this.heightValue);
    }

    /** Logical panel height. */
    get height(): number {
        return this.heightValue;
    }
    set height(value: number) {
        this.setSize(this.widthValue, value);
    }

    /** Horizontal normalized anchor. */
    get anchorX(): number {
        return this.anchorXValue;
    }
    set anchorX(value: number) {
        finite(value, 'SlicedSprite.anchorX');
        this.anchorXValue = value;
        this.layoutParts();
    }

    /** Vertical normalized anchor. */
    get anchorY(): number {
        return this.anchorYValue;
    }
    set anchorY(value: number) {
        finite(value, 'SlicedSprite.anchorY');
        this.anchorYValue = value;
        this.layoutParts();
    }

    /** Resize the logical panel while preserving fixed corners. */
    setSize(width: number, height: number): this {
        positive(width, 'SlicedSprite.width');
        positive(height, 'SlicedSprite.height');
        if (width < this.insets.left + this.insets.right) {
            throw new RangeError('SlicedSprite.width must fit its horizontal insets.');
        }
        if (height < this.insets.top + this.insets.bottom) {
            throw new RangeError('SlicedSprite.height must fit its vertical insets.');
        }
        this.widthValue = width;
        this.heightValue = height;
        this.layoutParts();
        return this;
    }

    /** Replace the atlas frame without recreating panel nodes or batch instance arrays. */
    setFrame(frame: SpriteFrame): this {
        validateInsets(frame, this.insets);
        this.frameValue = frame;
        const frames = this.createFrames(frame);
        for (let index = 0; index < this.parts.length; index += 1) {
            const part = this.parts[index];
            const partFrame = frames[index];
            if (part && partFrame) part.setFrame(partFrame, { resize: true });
        }
        this.layoutParts();
        return this;
    }

    private createFrames(frame: SpriteFrame): readonly SpriteFrame[] {
        const cached = this.frameSlices.get(frame);
        if (cached) return cached;
        const columns = [
            frame.x,
            frame.x + this.insets.left,
            frame.x + frame.width - this.insets.right
        ];
        const rows = [
            frame.y,
            frame.y + this.insets.top,
            frame.y + frame.height - this.insets.bottom
        ];
        const widths = [
            this.insets.left,
            frame.width - this.insets.left - this.insets.right,
            this.insets.right
        ];
        const heights = [
            this.insets.top,
            frame.height - this.insets.top - this.insets.bottom,
            this.insets.bottom
        ];
        const frames: SpriteFrame[] = [];
        for (let row = 0; row < 3; row += 1) {
            for (let column = 0; column < 3; column += 1) {
                const x = columns[column];
                const y = rows[row];
                const width = widths[column];
                const height = heights[row];
                if (
                    x === undefined ||
                    y === undefined ||
                    width === undefined ||
                    height === undefined
                ) {
                    throw new Error('SlicedSprite internal grid is incomplete.');
                }
                frames.push(
                    new SpriteFrame({
                        texture: frame.texture,
                        x,
                        y,
                        width,
                        height
                    })
                );
            }
        }
        const result = Object.freeze(frames);
        this.frameSlices.set(frame, result);
        return result;
    }

    private layoutParts(): void {
        const widths = [
            this.insets.left,
            this.widthValue - this.insets.left - this.insets.right,
            this.insets.right
        ];
        const heights = [
            this.insets.top,
            this.heightValue - this.insets.top - this.insets.bottom,
            this.insets.bottom
        ];
        const originX = -this.anchorXValue * this.widthValue;
        const originY = -this.anchorYValue * this.heightValue;
        let index = 0;
        let y = originY;
        for (let row = 0; row < 3; row += 1) {
            let x = originX;
            for (let column = 0; column < 3; column += 1) {
                const part = this.parts[index];
                const width = widths[column];
                const height = heights[row];
                if (part && width !== undefined && height !== undefined) {
                    part.setPosition(x, y, 0);
                    part.width = width;
                    part.height = height;
                    x += width;
                }
                index += 1;
            }
            y += heights[row] ?? 0;
        }
    }
}

export default SlicedSprite;
