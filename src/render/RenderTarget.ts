import type Texture from '../texture/Texture';
import type { RendererBackend } from './Renderer';
import type { CameraDepthMode } from '../camera/Camera';

export type RenderTargetSampleCount = 1 | 4;

export type RenderTargetColorFormat =
    'rgba8unorm' | 'rgba8unorm-srgb' | 'rgba16float' | 'rgba32float';

export type RenderTargetDepthStencilFormat =
    | 'depth16unorm'
    | 'depth24plus'
    | 'depth24plus-stencil8'
    | 'depth32float'
    | 'depth32float-stencil8';

export type RenderTargetLoadOp = 'clear' | 'load';
export type RenderTargetStoreOp = 'store' | 'discard';
export type RenderTargetCompareFunction =
    | 'never'
    | 'less'
    | 'equal'
    | 'less-equal'
    | 'greater'
    | 'not-equal'
    | 'greater-equal'
    | 'always';

/** Backend-neutral linear color used by render-pass attachment operations. */
export interface RenderTargetColor {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

export interface RenderTargetColorAttachmentOptions {
    readonly format?: RenderTargetColorFormat;
    readonly clearValue?: RenderTargetColor;
    readonly loadOp?: RenderTargetLoadOp;
    readonly storeOp?: RenderTargetStoreOp;
    readonly label?: string;
}

export interface RenderTargetDepthStencilAttachmentOptions {
    readonly format?: RenderTargetDepthStencilFormat;
    /** Expose the depth aspect as an engine Texture. Multisampled depth cannot be sampled. */
    readonly sampled?: boolean;
    /** Projection/depth-buffer convention. Defaults to `standard`. */
    readonly depthMode?: CameraDepthMode;
    readonly compare?: RenderTargetCompareFunction;
    readonly depthClearValue?: number;
    readonly depthLoadOp?: RenderTargetLoadOp;
    readonly depthStoreOp?: RenderTargetStoreOp;
    readonly stencilClearValue?: number;
    readonly stencilLoadOp?: RenderTargetLoadOp;
    readonly stencilStoreOp?: RenderTargetStoreOp;
    readonly label?: string;
}

/** Modern render-target description shared by WebGL 2 and WebGPU. */
export interface RenderTargetParameters {
    readonly width: number;
    readonly height: number;
    /** Defaults to one sampleable rgba8unorm attachment. An empty array creates a depth-only target. */
    readonly colorAttachments?: readonly RenderTargetColorAttachmentOptions[];
    /** Defaults to a non-sampled depth24plus-stencil8 attachment. */
    readonly depthStencilAttachment?: RenderTargetDepthStencilAttachmentOptions | false;
    /** Both backends guarantee single-sample and four-sample targets. */
    readonly sampleCount?: RenderTargetSampleCount;
    readonly label?: string;
}

export interface RenderTargetSelectionOptions {
    /** Present attachment zero after each render. */
    readonly present?: boolean;
    /** Destroy the target when it is replaced or when the renderer is destroyed. */
    readonly takeOwnership?: boolean;
}

export interface RenderTargetReadColorAttachmentOptions {
    readonly attachmentIndex?: number;
    /** Top-left texture-space origin. */
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
}

/** Tightly packed native-format texel bytes, with rows ordered from top to bottom. */
export interface RenderTargetColorAttachmentReadback {
    readonly data: Uint8Array;
    readonly format: RenderTargetColorFormat;
    readonly width: number;
    readonly height: number;
    readonly bytesPerPixel: number;
    readonly bytesPerRow: number;
}

/** Public render-target surface with no native WebGL or WebGPU handles. */
export interface RenderTarget {
    readonly backend: RendererBackend;
    readonly label: string;
    readonly sampleCount: RenderTargetSampleCount;
    readonly colorAttachmentCount: number;
    readonly colorFormats: readonly RenderTargetColorFormat[];
    readonly depthStencilFormat: RenderTargetDepthStencilFormat | null;
    readonly isDestroyed: boolean;
    readonly width: number;
    readonly height: number;
    /** Stable attachment identity for this target's lifetime, including resize and recovery. */
    getColorTexture(index?: number): Texture<unknown>;
    /** Stable sampled-depth identity for this target's lifetime, including resize and recovery. */
    getDepthTexture(): Texture<unknown> | null;
    readColorAttachment(
        options?: RenderTargetReadColorAttachmentOptions
    ): Promise<RenderTargetColorAttachmentReadback>;
    resize(width: number, height: number): void;
    destroy(): void;
}

export interface NormalizedRenderTargetColorAttachment {
    readonly format: RenderTargetColorFormat;
    readonly clearValue: RenderTargetColor;
    readonly loadOp: RenderTargetLoadOp;
    readonly storeOp: RenderTargetStoreOp;
    readonly label: string;
}

export interface NormalizedRenderTargetDepthStencilAttachment {
    readonly format: RenderTargetDepthStencilFormat;
    readonly sampled: boolean;
    readonly depthMode: CameraDepthMode;
    readonly compare: RenderTargetCompareFunction;
    readonly depthClearValue: number;
    readonly depthLoadOp: RenderTargetLoadOp;
    readonly depthStoreOp: RenderTargetStoreOp;
    readonly stencilClearValue: number;
    readonly stencilLoadOp: RenderTargetLoadOp;
    readonly stencilStoreOp: RenderTargetStoreOp;
    readonly label: string;
}

export interface NormalizedRenderTargetParameters {
    readonly width: number;
    readonly height: number;
    readonly colorAttachments: readonly NormalizedRenderTargetColorAttachment[];
    readonly depthStencilAttachment: NormalizedRenderTargetDepthStencilAttachment | null;
    readonly sampleCount: RenderTargetSampleCount;
    readonly label: string;
}

function positiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive integer`);
    }
}

function finiteColor(value: RenderTargetColor, name: string): void {
    if (![value.r, value.g, value.b, value.a].every(Number.isFinite)) {
        throw new RangeError(`${name} must contain finite RGBA components`);
    }
}

function loadOp(value: unknown, name: string): asserts value is RenderTargetLoadOp {
    if (value !== 'clear' && value !== 'load') {
        throw new TypeError(`${name} must be "clear" or "load"`);
    }
}

function storeOp(value: unknown, name: string): asserts value is RenderTargetStoreOp {
    if (value !== 'store' && value !== 'discard') {
        throw new TypeError(`${name} must be "store" or "discard"`);
    }
}

export function renderTargetFormatHasStencil(format: RenderTargetDepthStencilFormat): boolean {
    return format === 'depth24plus-stencil8' || format === 'depth32float-stencil8';
}

/** Validate once before either backend allocates native resources. */
export function normalizeRenderTargetParameters(
    parameters: RenderTargetParameters
): NormalizedRenderTargetParameters {
    positiveInteger(parameters.width, 'Render-target width');
    positiveInteger(parameters.height, 'Render-target height');
    const sampleCount: unknown = parameters.sampleCount ?? 1;
    if (sampleCount !== 1 && sampleCount !== 4) {
        throw new RangeError('Render-target sampleCount must be 1 or 4');
    }
    const label = parameters.label ?? 'RenderTarget';
    const colorAttachments = (parameters.colorAttachments ?? [{}]).map((attachment, index) => {
        const clearValue = attachment.clearValue ?? { r: 0, g: 0, b: 0, a: 0 };
        const resolvedLoadOp = attachment.loadOp ?? 'clear';
        const resolvedStoreOp = attachment.storeOp ?? (sampleCount > 1 ? 'discard' : 'store');
        finiteColor(clearValue, `Color attachment ${String(index)} clearValue`);
        loadOp(resolvedLoadOp, `Color attachment ${String(index)} loadOp`);
        storeOp(resolvedStoreOp, `Color attachment ${String(index)} storeOp`);
        return Object.freeze({
            format: attachment.format ?? 'rgba8unorm',
            clearValue: Object.freeze({ ...clearValue }),
            loadOp: resolvedLoadOp,
            storeOp: resolvedStoreOp,
            label: attachment.label ?? `${label}.color[${String(index)}]`
        });
    });
    const depthOptions = parameters.depthStencilAttachment;
    const depthStencilAttachment =
        depthOptions === false
            ? null
            : (() => {
                  const options = depthOptions ?? {};
                  const format = options.format ?? 'depth24plus-stencil8';
                  const sampled = options.sampled ?? false;
                  const depthMode: unknown = options.depthMode ?? 'standard';
                  if (depthMode !== 'standard' && depthMode !== 'reversed') {
                      throw new TypeError('Depth mode must be "standard" or "reversed"');
                  }
                  if (sampled && sampleCount > 1) {
                      throw new TypeError(
                          'A multisampled depth attachment cannot be resolved into a sampleable depth texture'
                      );
                  }
                  if (!sampled && options.compare !== undefined) {
                      throw new TypeError('Depth comparison sampling requires sampled: true');
                  }
                  const depthClearValue =
                      options.depthClearValue ?? (depthMode === 'reversed' ? 0 : 1);
                  const stencilClearValue = options.stencilClearValue ?? 0;
                  if (
                      !Number.isFinite(depthClearValue) ||
                      depthClearValue < 0 ||
                      depthClearValue > 1
                  ) {
                      throw new RangeError('Depth clear value must be a finite number in [0, 1]');
                  }
                  if (
                      !Number.isInteger(stencilClearValue) ||
                      stencilClearValue < 0 ||
                      stencilClearValue > 0xffffffff
                  ) {
                      throw new RangeError(
                          'Stencil clear value must be an unsigned 32-bit integer'
                      );
                  }
                  const depthLoadOp = options.depthLoadOp ?? 'clear';
                  const depthStoreOp = options.depthStoreOp ?? 'store';
                  const stencilLoadOp = options.stencilLoadOp ?? 'clear';
                  const stencilStoreOp = options.stencilStoreOp ?? 'store';
                  loadOp(depthLoadOp, 'Depth loadOp');
                  storeOp(depthStoreOp, 'Depth storeOp');
                  loadOp(stencilLoadOp, 'Stencil loadOp');
                  storeOp(stencilStoreOp, 'Stencil storeOp');
                  const stencilOperationsSpecified =
                      options.stencilClearValue !== undefined ||
                      options.stencilLoadOp !== undefined ||
                      options.stencilStoreOp !== undefined;
                  if (!renderTargetFormatHasStencil(format) && stencilOperationsSpecified) {
                      throw new TypeError(
                          `Stencil operations require a depth/stencil format; received ${format}`
                      );
                  }
                  return Object.freeze({
                      format,
                      sampled,
                      depthMode,
                      compare:
                          options.compare ??
                          (depthMode === 'reversed' ? 'greater-equal' : 'less-equal'),
                      depthClearValue,
                      depthLoadOp,
                      depthStoreOp,
                      stencilClearValue,
                      stencilLoadOp,
                      stencilStoreOp,
                      label: options.label ?? `${label}.depthStencil`
                  });
              })();
    if (colorAttachments.length === 0 && depthStencilAttachment === null) {
        throw new TypeError('A render target requires at least one attachment');
    }
    return Object.freeze({
        width: parameters.width,
        height: parameters.height,
        colorAttachments: Object.freeze(colorAttachments),
        depthStencilAttachment,
        sampleCount,
        label
    });
}
