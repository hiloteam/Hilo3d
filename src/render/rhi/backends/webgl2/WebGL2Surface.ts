import {
    RHITextureUsage,
    RHIValidationError,
    normalizeRHISurfaceConfiguration,
    type RHINormalizedSurfaceConfiguration,
    type RHISurface,
    type RHISurfaceConfiguration,
    type RHISurfaceState
} from '../../core';
import type { WebGL2RHIDevice } from './WebGL2Device';
import { WebGL2DestroyableBase } from './WebGL2Internal';
import { WebGL2Texture } from './WebGL2Resources';

export class WebGL2Surface extends WebGL2DestroyableBase implements RHISurface {
    #state: RHISurfaceState = 'unconfigured';
    #configuration: Readonly<RHINormalizedSurfaceConfiguration> | null = null;
    #externalPresentationConfiguration: Readonly<RHINormalizedSurfaceConfiguration> | null = null;
    #currentTexture: WebGL2Texture | null = null;
    #depthStencilTexture: WebGL2Texture | null = null;

    constructor(
        owner: WebGL2RHIDevice,
        readonly canvas: HTMLCanvasElement
    ) {
        super(owner, 'WebGL2 surface');
    }

    get state(): RHISurfaceState {
        return this.#state;
    }

    get configuration(): Readonly<RHINormalizedSurfaceConfiguration> | null {
        return this.#externalPresentationConfiguration ?? this.#configuration;
    }

    configure(configuration: RHISurfaceConfiguration): void {
        this.assertUsable('surface');
        if (this.#state === 'acquired') {
            throw new RHIValidationError(
                'invalid-state',
                'cannot configure while a surface texture is acquired',
                'surface'
            );
        }
        if (this.#externalPresentationConfiguration !== null) {
            throw new RHIValidationError(
                'invalid-state',
                'cannot configure while external presentation is active',
                'surface'
            );
        }
        if (this.owner.graphicsQueue.state === 'frame-open') {
            throw new RHIValidationError(
                'invalid-state',
                'cannot configure while a frame is open',
                'surface'
            );
        }
        const normalized = normalizeRHISurfaceConfiguration(configuration, this.owner.capabilities);
        if (
            normalized.format !== 'rgba8unorm' &&
            normalized.format !== 'bgra8unorm' &&
            normalized.format !== 'rgba8unorm-srgb' &&
            normalized.format !== 'bgra8unorm-srgb'
        ) {
            throw new RHIValidationError(
                'unsupported-format',
                'WebGL2 default framebuffer requires an 8-bit RGBA surface format',
                'surface.format'
            );
        }
        if ((normalized.usage & ~RHITextureUsage.RENDER_ATTACHMENT) !== 0) {
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 default framebuffer only supports RENDER_ATTACHMENT usage',
                'surface.usage'
            );
        }
        const attributes = this.owner.gl.getContextAttributes();
        const depthStencilFormat = normalized.depthStencilFormat;
        if (depthStencilFormat !== null) {
            if (depthStencilFormat.startsWith('depth') && attributes?.depth !== true) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'WebGL2 surface context has no default depth attachment',
                    'surface.depthStencilFormat'
                );
            }
            if (depthStencilFormat.includes('stencil') && attributes?.stencil !== true) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'WebGL2 surface context has no default stencil attachment',
                    'surface.depthStencilFormat'
                );
            }
        }
        const nextDepthStencilTexture = this.createDepthStencilTexture(normalized);
        this.canvas.width = normalized.width;
        this.canvas.height = normalized.height;
        const previousDepthStencilTexture = this.#depthStencilTexture;
        this.#depthStencilTexture = nextDepthStencilTexture;
        this.#configuration = normalized;
        this.#state = 'configured';
        previousDepthStencilTexture?.destroy();
    }

    getCurrentTexture(): WebGL2Texture {
        this.assertUsable('surface');
        const configuration = this.configuration;
        if (this.#state !== 'configured' || configuration === null) {
            throw new RHIValidationError('invalid-state', `surface is ${this.#state}`, 'surface');
        }
        this.#currentTexture = new WebGL2Texture(
            this.owner,
            {
                label: 'WebGL2 surface texture',
                lifetime: 'frame',
                size: { width: configuration.width, height: configuration.height },
                format: configuration.format,
                usage: configuration.usage,
                viewDimension: '2d'
            },
            { surface: true }
        );
        this.#state = 'acquired';
        return this.#currentTexture;
    }

    getDepthStencilTexture(): WebGL2Texture | null {
        this.assertUsable('surface');
        if (this.#state !== 'configured' && this.#state !== 'acquired') {
            throw new RHIValidationError('invalid-state', `surface is ${this.#state}`, 'surface');
        }
        return this.#depthStencilTexture;
    }

    /** @internal Select an XR/native presentation extent without resizing the context canvas. */
    setExternalPresentationExtent(width: number, height: number): void {
        this.assertPresentationMutationAllowed('select external presentation extent');
        if (!Number.isSafeInteger(width) || width <= 0) {
            throw new RangeError('External presentation width must be a positive safe integer');
        }
        if (!Number.isSafeInteger(height) || height <= 0) {
            throw new RangeError('External presentation height must be a positive safe integer');
        }
        const configured = this.#configuration;
        if (configured === null || this.#state !== 'configured') {
            throw new RHIValidationError('invalid-state', `surface is ${this.#state}`, 'surface');
        }
        const previous = this.configuration;
        if (
            this.#externalPresentationConfiguration !== null &&
            previous?.width === width &&
            previous.height === height
        ) {
            return;
        }
        const next = Object.freeze({ ...configured, width, height });
        const replacement = this.prepareDepthStencilReplacement(previous, next);
        this.#externalPresentationConfiguration = next;
        this.commitDepthStencilReplacement(replacement);
    }

    /** @internal Restore the canvas-owned presentation extent after a native session. */
    clearExternalPresentationExtent(): void {
        this.assertPresentationMutationAllowed('restore system presentation extent');
        const previous = this.#externalPresentationConfiguration;
        if (previous === null) return;
        const configured = this.#configuration;
        if (configured === null || this.#state !== 'configured') {
            throw new RHIValidationError('invalid-state', `surface is ${this.#state}`, 'surface');
        }
        const replacement = this.prepareDepthStencilReplacement(previous, configured);
        this.#externalPresentationConfiguration = null;
        this.commitDepthStencilReplacement(replacement);
    }

    present(): void {
        this.assertUsable('surface');
        if (this.#state !== 'acquired' || this.#currentTexture === null) {
            throw new RHIValidationError(
                'invalid-state',
                'surface has no acquired texture',
                'surface'
            );
        }
        if (this.owner.graphicsQueue.state === 'frame-open') {
            throw new RHIValidationError(
                'invalid-state',
                'cannot present before the frame ends',
                'surface'
            );
        }
        this.#currentTexture.destroy();
        this.#currentTexture = null;
        this.#state = 'configured';
        this.owner.gl.flush();
        this.owner.assertNoNativeError('surface.present');
    }

    protected releaseNative(_contextLost: boolean): void {
        this.#currentTexture?.destroy();
        this.#currentTexture = null;
        this.#depthStencilTexture?.destroy();
        this.#depthStencilTexture = null;
        this.#externalPresentationConfiguration = null;
        this.#configuration = null;
        this.#state = 'destroyed';
    }

    private assertPresentationMutationAllowed(operation: string): void {
        this.assertUsable('surface');
        if (this.owner.graphicsQueue.state !== 'idle') {
            throw new RHIValidationError(
                'invalid-state',
                `cannot ${operation} while the graphics queue is ${this.owner.graphicsQueue.state}`,
                'surface'
            );
        }
    }

    private createDepthStencilTexture(
        configuration: Readonly<RHINormalizedSurfaceConfiguration>
    ): WebGL2Texture | null {
        const format = configuration.depthStencilFormat;
        return format === null
            ? null
            : new WebGL2Texture(
                  this.owner,
                  {
                      label: 'WebGL2 surface depth/stencil',
                      lifetime: 'persistent',
                      size: { width: configuration.width, height: configuration.height },
                      format,
                      usage: RHITextureUsage.RENDER_ATTACHMENT
                  },
                  { surfaceDepthStencil: true }
              );
    }

    private prepareDepthStencilReplacement(
        previous: Readonly<RHINormalizedSurfaceConfiguration> | null,
        next: Readonly<RHINormalizedSurfaceConfiguration>
    ): WebGL2Texture | null | undefined {
        if (
            previous?.width === next.width &&
            previous.height === next.height &&
            previous.depthStencilFormat === next.depthStencilFormat
        ) {
            return undefined;
        }
        return this.createDepthStencilTexture(next);
    }

    private commitDepthStencilReplacement(replacement: WebGL2Texture | null | undefined): void {
        if (replacement === undefined) return;
        const retired = this.#depthStencilTexture;
        this.#depthStencilTexture = replacement;
        retired?.destroy();
    }
}
