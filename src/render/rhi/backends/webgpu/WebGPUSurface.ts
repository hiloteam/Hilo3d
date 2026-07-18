import type { RHINormalizedTextureDescriptor, RHITexture } from '../../core/RHIResources';
import type {
    RHINormalizedSurfaceConfiguration,
    RHISurface,
    RHISurfaceConfiguration,
    RHISurfaceState
} from '../../core/RHISurface';
import {
    RHIValidationError,
    normalizeRHISurfaceConfiguration,
    normalizeRHITextureDescriptor
} from '../../core/RHIValidation';
import { WebGPUDestroyableObject } from './WebGPUBase';
import type { WebGPUDevice } from './WebGPUDevice';
import { WebGPUTexture } from './WebGPUResources';
import { RHITextureUsage } from '../../core/RHITypes';

function nativeConfiguration(
    configuration: Readonly<RHINormalizedSurfaceConfiguration>,
    device: WebGPUDevice
): GPUCanvasConfiguration {
    return {
        device: device.nativeHandle,
        format: configuration.format,
        usage: configuration.usage,
        alphaMode: configuration.alphaMode,
        colorSpace: configuration.colorSpace
    };
}

export class WebGPUSurface extends WebGPUDestroyableObject implements RHISurface {
    readonly canvas: HTMLCanvasElement;
    readonly #nativeContext: GPUCanvasContext;
    #surfaceState: RHISurfaceState = 'unconfigured';
    #configuration: Readonly<RHINormalizedSurfaceConfiguration> | null = null;
    #currentTexture: WebGPUTexture | null = null;
    #depthStencilTexture: WebGPUTexture | null = null;

    constructor(owner: WebGPUDevice, nativeContext: GPUCanvasContext, canvas: HTMLCanvasElement) {
        super(owner, 'WebGPU surface');
        this.#nativeContext = nativeContext;
        this.canvas = canvas;
    }

    get state(): RHISurfaceState {
        return this.#surfaceState;
    }

    get configuration(): Readonly<RHINormalizedSurfaceConfiguration> | null {
        return this.#configuration;
    }

    /** @internal */
    get nativeHandle(): GPUCanvasContext {
        return this.#nativeContext;
    }

    configure(configuration: RHISurfaceConfiguration): void {
        this.owner.assertUsable(this, 'surface');
        if (this.#surfaceState === 'acquired') {
            throw new RHIValidationError(
                'invalid-state',
                'cannot configure while a surface texture is acquired',
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
        const nextDepthStencilTexture =
            normalized.depthStencilFormat === null
                ? null
                : this.owner.createTexture({
                      label: 'WebGPU surface depth/stencil',
                      lifetime: 'persistent',
                      size: { width: normalized.width, height: normalized.height },
                      format: normalized.depthStencilFormat,
                      usage: RHITextureUsage.RENDER_ATTACHMENT
                  });
        try {
            this.canvas.width = normalized.width;
            this.canvas.height = normalized.height;
            this.#nativeContext.configure(nativeConfiguration(normalized, this.owner));
        } catch (error) {
            nextDepthStencilTexture?.destroy();
            throw error;
        }
        const previousDepthStencilTexture = this.#depthStencilTexture;
        this.#depthStencilTexture = nextDepthStencilTexture;
        this.#configuration = normalized;
        this.#surfaceState = 'configured';
        previousDepthStencilTexture?.destroy();
    }

    getCurrentTexture(): RHITexture {
        this.owner.assertUsable(this, 'surface');
        const configuration = this.#configuration;
        if (configuration === null || this.#surfaceState !== 'configured') {
            throw new RHIValidationError(
                'invalid-state',
                `surface is ${this.#surfaceState}`,
                'surface'
            );
        }
        const nativeTexture = this.#nativeContext.getCurrentTexture();
        const descriptor: Readonly<RHINormalizedTextureDescriptor> = normalizeRHITextureDescriptor(
            {
                label: 'WebGPU surface texture',
                lifetime: 'frame',
                size: { width: configuration.width, height: configuration.height },
                mipLevelCount: 1,
                sampleCount: 1,
                dimension: '2d',
                format: configuration.format,
                usage: configuration.usage
            },
            this.owner.capabilities
        );
        this.#currentTexture = new WebGPUTexture(this.owner, nativeTexture, descriptor, false);
        this.#surfaceState = 'acquired';
        return this.#currentTexture;
    }

    getDepthStencilTexture(): RHITexture | null {
        this.owner.assertUsable(this, 'surface');
        if (this.#surfaceState !== 'configured' && this.#surfaceState !== 'acquired') {
            throw new RHIValidationError(
                'invalid-state',
                `surface is ${this.#surfaceState}`,
                'surface'
            );
        }
        return this.#depthStencilTexture;
    }

    present(): void {
        this.owner.assertUsable(this, 'surface');
        if (this.#surfaceState !== 'acquired' || this.#currentTexture === null) {
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
        // Browser WebGPU presents implicitly; this explicit portable boundary invalidates the
        // acquired frame texture without inventing a native present command.
        this.#currentTexture.destroy();
        this.#currentTexture = null;
        this.#surfaceState = 'configured';
    }

    override destroy(): void {
        if (this.destroyed) return;
        this.#currentTexture?.destroy();
        this.#currentTexture = null;
        this.#depthStencilTexture?.destroy();
        this.#depthStencilTexture = null;
        this.#configuration = null;
        if (this.#surfaceState !== 'unconfigured') this.#nativeContext.unconfigure();
        this.#surfaceState = 'destroyed';
        super.destroy();
    }
}
