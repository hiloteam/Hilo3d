import { CLAMP_TO_EDGE, LINEAR } from '../constants/webgl';
import type { Renderer } from '../render/Renderer';
import Texture from '../texture/Texture';
import Sprite, { type SpriteParameters } from './Sprite';
import SpriteFrame from './SpriteFrame';

type TextCanvas = HTMLCanvasElement | OffscreenCanvas;
type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Text2DStyle {
    /** CSS canvas font string. */
    font?: string;
    /** Fill color understood by Canvas 2D. */
    fillStyle?: string;
    /** Optional outline color. */
    strokeStyle?: string;
    /** Outline width in logical pixels. */
    strokeWidth?: number;
    /** Horizontal line alignment inside the generated texture. */
    textAlign?: CanvasTextAlign;
    /** Padding around the generated label in logical pixels. */
    padding?: number;
    /** Explicit logical line height. */
    lineHeight?: number;
    /** Canvas backing pixels per logical sprite pixel. */
    resolution?: number;
}

export interface Text2DParameters extends Omit<
    SpriteParameters,
    'texture' | 'frame' | 'frames' | 'material' | 'width' | 'height' | 'autoPlay'
> {
    text?: string;
    style?: Text2DStyle;
}

const DEFAULT_STYLE: Required<Text2DStyle> = Object.freeze({
    font: '16px sans-serif',
    fillStyle: '#ffffff',
    strokeStyle: '#000000',
    strokeWidth: 0,
    textAlign: 'left',
    padding: 0,
    lineHeight: 0,
    resolution: 1
});

function createCanvas(): TextCanvas {
    if (typeof document !== 'undefined') return document.createElement('canvas');
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
    throw new Error('Text2D requires HTMLCanvasElement or OffscreenCanvas support.');
}

function context2D(canvas: TextCanvas): TextContext {
    const context =
        typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement
            ? canvas.getContext('2d')
            : (canvas as OffscreenCanvas).getContext('2d');
    if (!context) throw new Error('Text2D could not create a Canvas 2D context.');
    return context;
}

function positive(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive finite number.`);
    }
}

function nonNegative(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be a finite non-negative number.`);
    }
}

function resolveStyle(style: Text2DStyle = {}): Required<Text2DStyle> {
    const resolved = { ...DEFAULT_STYLE, ...style };
    positive(resolved.resolution, 'Text2D.style.resolution');
    nonNegative(resolved.padding, 'Text2D.style.padding');
    nonNegative(resolved.strokeWidth, 'Text2D.style.strokeWidth');
    nonNegative(resolved.lineHeight, 'Text2D.style.lineHeight');
    return Object.freeze(resolved);
}

interface PreparedText {
    readonly canvas: TextCanvas;
    readonly width: number;
    readonly height: number;
}

function prepareText(
    text: string,
    style: Required<Text2DStyle>,
    canvas = createCanvas()
): PreparedText {
    const context = context2D(canvas);
    context.font = style.font;
    const lines = text.split('\n');
    let contentWidth = 0;
    let measuredLineHeight = 0;
    for (const line of lines) {
        const metrics = context.measureText(line.length === 0 ? ' ' : line);
        contentWidth = Math.max(contentWidth, metrics.width);
        measuredLineHeight = Math.max(
            measuredLineHeight,
            metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
        );
    }
    const fallbackFontSize = Number.parseFloat(/(\d+(?:\.\d+)?)px/u.exec(style.font)?.[1] ?? '16');
    const lineHeight = style.lineHeight || measuredLineHeight || fallbackFontSize;
    const logicalWidth = Math.max(1, contentWidth + style.padding * 2 + style.strokeWidth);
    const logicalHeight = Math.max(
        1,
        lineHeight * Math.max(lines.length, 1) + style.padding * 2 + style.strokeWidth
    );
    canvas.width = Math.max(1, Math.ceil(logicalWidth * style.resolution));
    canvas.height = Math.max(1, Math.ceil(logicalHeight * style.resolution));
    const draw = context2D(canvas);
    draw.setTransform(style.resolution, 0, 0, style.resolution, 0, 0);
    draw.clearRect(0, 0, logicalWidth, logicalHeight);
    draw.font = style.font;
    draw.textBaseline = 'top';
    draw.textAlign = style.textAlign;
    draw.fillStyle = style.fillStyle;
    draw.strokeStyle = style.strokeStyle;
    draw.lineWidth = style.strokeWidth;
    const x =
        style.textAlign === 'center'
            ? logicalWidth * 0.5
            : style.textAlign === 'right' || style.textAlign === 'end'
              ? logicalWidth - style.padding
              : style.padding;
    let y = style.padding;
    for (const line of lines) {
        if (style.strokeWidth > 0) draw.strokeText(line, x, y);
        draw.fillText(line, x, y);
        y += lineHeight;
    }
    return { canvas, width: logicalWidth, height: logicalHeight };
}

function createTextTexture(canvas: TextCanvas, text: string): Texture<TextCanvas> {
    return new Texture<TextCanvas>({
        image: canvas,
        flipY: true,
        premultiplyAlpha: true,
        minFilter: LINEAR,
        magFilter: LINEAR,
        wrapS: CLAMP_TO_EDGE,
        wrapT: CLAMP_TO_EDGE,
        name: `Text2D:${text.slice(0, 32)}`
    });
}

/**
 * Canvas-2D-backed text rendered as one batched-sprite-compatible quad.
 *
 * A label rasterizes only when its text or style changes. It uses a single texture and draw item,
 * avoiding per-glyph scene nodes. Sprite atlases remain the high-throughput path for very large
 * quantities of glyphs.
 */
class Text2D extends Sprite {
    static override readonly typeName: string = 'Text2D';
    readonly isText2D = true;
    override className = 'Text2D';
    private textValue: string;
    private styleValue: Required<Text2DStyle>;
    private readonly textCanvas: TextCanvas;
    private readonly textTexture: Texture<TextCanvas>;

    constructor(params: Text2DParameters = {}) {
        const text = params.text ?? '';
        const style = resolveStyle(params.style);
        const prepared = prepareText(text, style);
        const texture = createTextTexture(prepared.canvas, text);
        const spriteParameters = { ...params };
        Reflect.deleteProperty(spriteParameters, 'text');
        Reflect.deleteProperty(spriteParameters, 'style');
        super({
            ...spriteParameters,
            frame: SpriteFrame.fromTexture(texture),
            width: prepared.width,
            height: prepared.height,
            autoPlay: false
        });
        this.textValue = text;
        this.styleValue = style;
        this.textCanvas = prepared.canvas;
        this.textTexture = texture;
    }

    /** Current string, including newline-separated lines. */
    get text(): string {
        return this.textValue;
    }
    set text(value: string) {
        this.setText(value);
    }

    /** Immutable snapshot of the active raster style. */
    get style(): Readonly<Required<Text2DStyle>> {
        return this.styleValue;
    }

    /** Replace text and rerasterize its Canvas 2D texture. */
    setText(text: string): this {
        if (text === this.textValue) return this;
        this.replaceRaster(text, this.styleValue);
        return this;
    }

    /** Merge style changes and rerasterize. */
    setStyle(style: Text2DStyle): this {
        this.replaceRaster(this.textValue, resolveStyle({ ...this.styleValue, ...style }));
        return this;
    }

    override destroy(renderer?: Renderer, _destroyTextures = false): this {
        void _destroyTextures;
        const texture = this.textTexture;
        super.destroy(renderer, false);
        texture.destroy();
        return this;
    }

    private replaceRaster(text: string, style: Required<Text2DStyle>): void {
        const prepared = prepareText(text, style, this.textCanvas);
        this.textValue = text;
        this.styleValue = style;
        this.textTexture.name = `Text2D:${text.slice(0, 32)}`;
        // Reassigning the retained Canvas raises the monotonic content revision and synchronizes
        // dimensions without changing Texture, SpriteMaterial, shader, or pipeline identity.
        this.textTexture.image = this.textCanvas;
        this.frames.splice(0, this.frames.length, SpriteFrame.fromTexture(this.textTexture));
        this.gotoFrame(0);
        this.width = prepared.width;
        this.height = prepared.height;
    }
}

export default Text2D;
