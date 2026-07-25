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
    /** Maximum content width in logical pixels. Zero disables width constraints. */
    maxWidth?: number;
    /** Automatically wrap measured words and CJK characters at `maxWidth`. */
    wordWrap?: boolean;
    /** Behavior when content exceeds `maxWidth` or `maxLines`. */
    overflow?: 'visible' | 'clip' | 'ellipsis';
    /** Maximum rendered lines. Zero allows any number of lines. */
    maxLines?: number;
    /** Canvas text baseline used inside each logical line box. */
    textBaseline?: CanvasTextBaseline;
    /** Additional space after explicit newline-separated paragraphs. */
    paragraphSpacing?: number;
    /** Additional space between Unicode characters in logical pixels. */
    letterSpacing?: number;
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
    maxWidth: 0,
    wordWrap: true,
    overflow: 'visible',
    maxLines: 0,
    textBaseline: 'top',
    paragraphSpacing: 0,
    letterSpacing: 0,
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
    nonNegative(resolved.maxWidth, 'Text2D.style.maxWidth');
    nonNegative(resolved.paragraphSpacing, 'Text2D.style.paragraphSpacing');
    nonNegative(resolved.letterSpacing, 'Text2D.style.letterSpacing');
    if (!Number.isSafeInteger(resolved.maxLines) || resolved.maxLines < 0) {
        throw new RangeError('Text2D.style.maxLines must be a non-negative safe integer.');
    }
    return Object.freeze(resolved);
}

interface PreparedText {
    readonly canvas: TextCanvas;
    readonly width: number;
    readonly height: number;
}

interface TextLine {
    text: string;
    paragraphEnd: boolean;
}

function measureTextWidth(context: TextContext, text: string, letterSpacing: number): number {
    if (text.length === 0) return 0;
    if (letterSpacing === 0) return context.measureText(text).width;
    const characters = Array.from(text);
    let width = 0;
    for (const character of characters) width += context.measureText(character).width;
    return width + Math.max(0, characters.length - 1) * letterSpacing;
}

function splitOversizedToken(
    context: TextContext,
    token: string,
    maxWidth: number,
    letterSpacing: number
): string[] {
    const pieces: string[] = [];
    let current = '';
    for (const character of Array.from(token)) {
        const candidate = current + character;
        if (current.length > 0 && measureTextWidth(context, candidate, letterSpacing) > maxWidth) {
            pieces.push(current);
            current = character;
        } else {
            current = candidate;
        }
    }
    if (current.length > 0) pieces.push(current);
    return pieces;
}

function wrapParagraph(
    context: TextContext,
    paragraph: string,
    maxWidth: number,
    letterSpacing: number
): string[] {
    if (paragraph.length === 0) return [''];
    const tokens = paragraph.match(
        /\s+|[\u3040-\u30ff\u3400-\u9fff]|[^\s\u3040-\u30ff\u3400-\u9fff]+/gu
    ) ?? [paragraph];
    const lines: string[] = [];
    let current = '';
    for (const token of tokens) {
        const candidate = current + token;
        if (measureTextWidth(context, candidate, letterSpacing) <= maxWidth) {
            current = candidate;
            continue;
        }
        if (current.trimEnd().length > 0) lines.push(current.trimEnd());
        if (measureTextWidth(context, token, letterSpacing) <= maxWidth) {
            current = token.trimStart();
            continue;
        }
        const pieces = splitOversizedToken(context, token.trim(), maxWidth, letterSpacing);
        for (let index = 0; index < pieces.length - 1; index += 1) {
            const piece = pieces[index];
            if (piece !== undefined) lines.push(piece);
        }
        current = pieces.at(-1) ?? '';
    }
    if (current.length > 0 || lines.length === 0) lines.push(current.trimEnd());
    return lines;
}

function ellipsize(
    context: TextContext,
    text: string,
    maxWidth: number,
    letterSpacing: number
): string {
    const ellipsis = '…';
    if (maxWidth <= 0) return `${text}${ellipsis}`;
    const characters = Array.from(text.trimEnd());
    while (
        characters.length > 0 &&
        measureTextWidth(context, `${characters.join('')}${ellipsis}`, letterSpacing) > maxWidth
    ) {
        characters.pop();
    }
    return `${characters.join('')}${ellipsis}`;
}

function layoutLines(context: TextContext, text: string, style: Required<Text2DStyle>): TextLine[] {
    const lines: TextLine[] = [];
    const paragraphs = text.split('\n');
    for (let index = 0; index < paragraphs.length; index += 1) {
        const paragraph = paragraphs[index] ?? '';
        const wrapped =
            style.wordWrap && style.maxWidth > 0
                ? wrapParagraph(context, paragraph, style.maxWidth, style.letterSpacing)
                : [paragraph];
        for (let lineIndex = 0; lineIndex < wrapped.length; lineIndex += 1) {
            lines.push({
                text: wrapped[lineIndex] ?? '',
                paragraphEnd: lineIndex === wrapped.length - 1 && index < paragraphs.length - 1
            });
        }
    }
    const maxLines = style.maxLines;
    if (maxLines > 0 && lines.length > maxLines) {
        lines.length = maxLines;
        if (style.overflow === 'ellipsis') {
            const last = lines[maxLines - 1];
            if (last) {
                last.text = ellipsize(context, last.text, style.maxWidth, style.letterSpacing);
                last.paragraphEnd = false;
            }
        }
    } else if (
        style.overflow === 'ellipsis' &&
        !style.wordWrap &&
        style.maxWidth > 0 &&
        lines.some(
            line => measureTextWidth(context, line.text, style.letterSpacing) > style.maxWidth
        )
    ) {
        for (const line of lines) {
            if (measureTextWidth(context, line.text, style.letterSpacing) > style.maxWidth) {
                line.text = ellipsize(context, line.text, style.maxWidth, style.letterSpacing);
            }
        }
    }
    return lines;
}

function drawLine(
    context: TextContext,
    text: string,
    x: number,
    y: number,
    style: Required<Text2DStyle>
): void {
    if (style.letterSpacing === 0) {
        if (style.strokeWidth > 0) context.strokeText(text, x, y);
        context.fillText(text, x, y);
        return;
    }
    const width = measureTextWidth(context, text, style.letterSpacing);
    let cursor =
        style.textAlign === 'center'
            ? x - width * 0.5
            : style.textAlign === 'right' || style.textAlign === 'end'
              ? x - width
              : x;
    for (const character of Array.from(text)) {
        if (style.strokeWidth > 0) context.strokeText(character, cursor, y);
        context.fillText(character, cursor, y);
        cursor += context.measureText(character).width + style.letterSpacing;
    }
}

function prepareText(
    text: string,
    style: Required<Text2DStyle>,
    canvas = createCanvas()
): PreparedText {
    const context = context2D(canvas);
    context.font = style.font;
    const lines = layoutLines(context, text, style);
    let contentWidth = 0;
    let measuredLineHeight = 0;
    for (const line of lines) {
        const metrics = context.measureText(line.text.length === 0 ? ' ' : line.text);
        contentWidth = Math.max(
            contentWidth,
            measureTextWidth(context, line.text, style.letterSpacing)
        );
        measuredLineHeight = Math.max(
            measuredLineHeight,
            metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
        );
    }
    const fallbackFontSize = Number.parseFloat(/(\d+(?:\.\d+)?)px/u.exec(style.font)?.[1] ?? '16');
    const lineHeight = style.lineHeight || measuredLineHeight || fallbackFontSize;
    const constrainedWidth =
        style.maxWidth > 0 && (style.wordWrap || style.overflow !== 'visible')
            ? style.maxWidth
            : contentWidth;
    const logicalWidth = Math.max(1, constrainedWidth + style.padding * 2 + style.strokeWidth);
    let paragraphSpacing = 0;
    for (const line of lines) {
        if (line.paragraphEnd) paragraphSpacing += style.paragraphSpacing;
    }
    const logicalHeight = Math.max(
        1,
        lineHeight * Math.max(lines.length, 1) +
            paragraphSpacing +
            style.padding * 2 +
            style.strokeWidth
    );
    canvas.width = Math.max(1, Math.ceil(logicalWidth * style.resolution));
    canvas.height = Math.max(1, Math.ceil(logicalHeight * style.resolution));
    const draw = context2D(canvas);
    draw.setTransform(style.resolution, 0, 0, style.resolution, 0, 0);
    draw.clearRect(0, 0, logicalWidth, logicalHeight);
    draw.font = style.font;
    draw.textBaseline = style.textBaseline;
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
    const baselineOffset =
        style.textBaseline === 'middle'
            ? lineHeight * 0.5
            : style.textBaseline === 'bottom'
              ? lineHeight
              : style.textBaseline === 'alphabetic' || style.textBaseline === 'ideographic'
                ? Math.max(0, context.measureText('Mg').actualBoundingBoxAscent || lineHeight * 0.8)
                : 0;
    let y = style.padding;
    for (const line of lines) {
        drawLine(draw, line.text, x, y + baselineOffset, style);
        y += lineHeight;
        if (line.paragraphEnd) y += style.paragraphSpacing;
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
