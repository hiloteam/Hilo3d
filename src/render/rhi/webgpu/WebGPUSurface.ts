import type { RHISurface, RHISurfaceConfiguration, RHITextureFormat } from '../RHI';
import { DEFAULT_TEXTURE_USAGE, WebGPUDestroyableObject, owners } from './WebGPUBase';
import type { WebGPUDevice } from './WebGPUDevice';
import type { WebGPUTexture } from './WebGPUResources';

function nativeSurfaceConfiguration(
    configuration: RHISurfaceConfiguration,
    device: WebGPUDevice
): GPUCanvasConfiguration {
    return {
        device: device.nativeHandle,
        format: configuration.format,
        ...(configuration.usage === undefined ? {} : { usage: configuration.usage }),
        ...(configuration.alphaMode === undefined ? {} : { alphaMode: configuration.alphaMode })
    };
}

function nativeTextureNumber(texture: GPUTexture, property: string, fallback: number): number {
    const value: unknown = Reflect.get(texture, property);
    return typeof value === 'number' ? value : fallback;
}

export class WebGPUSurface extends WebGPUDestroyableObject implements RHISurface {
    readonly canvas: HTMLCanvasElement;
    readonly #nativeContext: GPUCanvasContext;
    #device: WebGPUDevice;
    #format: RHITextureFormat;
    #configuration: RHISurfaceConfiguration;
    #configured = false;

    constructor(
        device: WebGPUDevice,
        nativeContext: GPUCanvasContext,
        canvas: HTMLCanvasElement,
        configuration: RHISurfaceConfiguration
    ) {
        super('WebGPU surface');
        this.#device = device;
        this.#nativeContext = nativeContext;
        this.canvas = canvas;
        this.#format = configuration.format;
        this.#configuration = configuration;
        owners.set(this, device);
        this.#nativeContext.configure(nativeSurfaceConfiguration(configuration, device));
        this.#configured = true;
    }

    get width(): number {
        return this.canvas.width;
    }

    get height(): number {
        return this.canvas.height;
    }

    get format(): RHITextureFormat {
        return this.#format;
    }

    /** @internal */
    get nativeContext(): GPUCanvasContext {
        return this.#nativeContext;
    }

    /** @internal */
    get nativeHandle(): GPUCanvasContext {
        return this.#nativeContext;
    }

    /** One-hop renderer swap-chain access without allocating a portable texture wrapper. */
    getCurrentNativeTexture(): GPUTexture {
        this.assertAlive('WebGPU surface');
        if (!this.#configured) throw new Error('WebGPU surface is not configured');
        return this.#nativeContext.getCurrentTexture();
    }

    configure(configuration: RHISurfaceConfiguration): void {
        this.assertAlive('WebGPU surface');
        this.#nativeContext.configure(nativeSurfaceConfiguration(configuration, this.#device));
        this.#configuration = configuration;
        this.#format = configuration.format;
        this.#configured = true;
    }

    resize(width: number, height: number): void {
        this.assertAlive('WebGPU surface');
        if (
            !Number.isSafeInteger(width) ||
            width < 0 ||
            !Number.isSafeInteger(height) ||
            height < 0
        ) {
            throw new RangeError('WebGPU surface dimensions must be non-negative safe integers');
        }
        this.canvas.width = width;
        this.canvas.height = height;
        // Reconfiguration is explicit so implementations that invalidate swap chains on resize
        // observe the same deterministic lifecycle.
        if (this.#configured) {
            this.#nativeContext.configure(
                nativeSurfaceConfiguration(this.#configuration, this.#device)
            );
        }
    }

    getCurrentTexture(): WebGPUTexture {
        this.assertAlive('WebGPU surface');
        if (!this.#configured) throw new Error('WebGPU surface is not configured');
        const nativeTexture = this.#nativeContext.getCurrentTexture();
        const nativeDimension: unknown = Reflect.get(nativeTexture, 'dimension');
        const nativeFormat: unknown = Reflect.get(nativeTexture, 'format');
        return this.#device.wrapTexture(nativeTexture, {
            label: nativeTexture.label,
            size: {
                width: nativeTextureNumber(nativeTexture, 'width', this.width),
                height: nativeTextureNumber(nativeTexture, 'height', this.height),
                depthOrArrayLayers: nativeTextureNumber(nativeTexture, 'depthOrArrayLayers', 1)
            },
            mipLevelCount: nativeTextureNumber(nativeTexture, 'mipLevelCount', 1),
            sampleCount: nativeTextureNumber(nativeTexture, 'sampleCount', 1),
            dimension:
                nativeDimension === '1d' || nativeDimension === '2d' || nativeDimension === '3d'
                    ? nativeDimension
                    : '2d',
            format:
                typeof nativeFormat === 'string'
                    ? (nativeFormat as RHITextureFormat)
                    : this.#format,
            usage: nativeTextureNumber(
                nativeTexture,
                'usage',
                this.#configuration.usage ?? DEFAULT_TEXTURE_USAGE
            )
        });
    }

    /** Replace the device after loss while retaining the canvas/context and configuration. @internal */
    replaceDevice(device: WebGPUDevice): void {
        this.assertAlive('WebGPU surface');
        this.#nativeContext.configure(nativeSurfaceConfiguration(this.#configuration, device));
        this.#device = device;
        this.#configured = true;
        owners.set(this, device);
    }

    /** Temporarily unconfigure the swap chain while a replacement device is requested. @internal */
    suspend(): void {
        this.assertAlive('WebGPU surface');
        if (!this.#configured) return;
        this.#nativeContext.unconfigure();
        this.#configured = false;
    }

    destroy(): void {
        if (!this.markDestroyed()) return;
        if (this.#configured) this.#nativeContext.unconfigure();
        this.#configured = false;
    }
}
