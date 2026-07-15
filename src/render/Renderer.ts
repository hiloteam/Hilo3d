import RendererCore, {
    type RendererBackend,
    type RendererContract,
    type RendererFrame,
    type RendererFrameCallback,
    type RendererResourceDiagnostics,
    type RendererResourceManager,
    type RendererScene,
    type RendererViewport,
    type TextureCompressionFormat
} from './RendererCore';
import {
    constructRenderer,
    createRenderer,
    isRendererBackendSupported
} from './internal/RendererFactory';
import type {
    RendererAdapterPowerPreference,
    RendererAutoOptions,
    RendererCommonOptions,
    RendererContextPowerPreference,
    RendererCreateOptions,
    RendererExplicitOptions,
    RendererFeatureName,
    RendererOptions,
    RendererOptionsMap,
    RendererSupportOptions,
    RendererWebGL2Options,
    RendererWebGPUOptions
} from './RendererOptions';

/**
 * The only public renderer entry point.
 *
 * Construction returns the selected backend driver directly. There is no render-call proxy or
 * additional dispatch in the frame hot path.
 */
export class Renderer<
    Backend extends RendererBackend = RendererBackend
> implements RendererContract {
    declare readonly backend: Backend;
    declare readonly className: 'Renderer';
    declare readonly ready: RendererContract['ready'];
    declare readonly isReady: RendererContract['isReady'];
    declare readonly renderInfo: RendererContract['renderInfo'];
    declare readonly lightManager: RendererContract['lightManager'];
    declare readonly resourceManager: RendererContract['resourceManager'];
    declare readonly renderTarget: RendererContract['renderTarget'];
    declare width: RendererContract['width'];
    declare height: RendererContract['height'];
    declare pixelRatio: RendererContract['pixelRatio'];
    declare domElement: RendererContract['domElement'];
    declare useInstanced: RendererContract['useInstanced'];
    declare forceMaterial: RendererContract['forceMaterial'];
    declare clearColor: RendererContract['clearColor'];
    declare readonly resize: RendererContract['resize'];
    declare readonly setOffset: RendererContract['setOffset'];
    declare readonly getViewport: RendererContract['getViewport'];
    declare readonly render: RendererContract['render'];
    declare readonly renderFrame: RendererContract['renderFrame'];
    declare readonly supportsTextureCompression: RendererContract['supportsTextureCompression'];
    declare readonly createRenderTarget: RendererContract['createRenderTarget'];
    declare readonly setRenderTarget: (
        ...args: Parameters<RendererContract['setRenderTarget']>
    ) => this;
    declare readonly present: RendererContract['present'];
    declare readonly renderToTarget: RendererContract['renderToTarget'];
    declare readonly onInit: (callback: (renderer: this) => void) => void;
    declare readonly waitForIdle: RendererContract['waitForIdle'];
    declare readonly getExtension: RendererContract['getExtension'];
    declare readonly releaseGPUResources: RendererContract['releaseGPUResources'];
    declare readonly destroy: RendererContract['destroy'];
    declare readonly on: (...args: Parameters<RendererContract['on']>) => this;
    declare readonly off: (...args: Parameters<RendererContract['off']>) => this;

    constructor(options: RendererOptions<Backend> = {} as RendererOptions<Backend>) {
        return constructRenderer(options) as unknown as Renderer<Backend>;
    }

    /** Construct, resolve an optional `auto` policy, and await backend readiness. */
    static create(options?: RendererAutoOptions): Promise<Renderer>;
    static create(options: RendererWebGL2Options): Promise<Renderer<'webgl2'>>;
    static create(options: RendererWebGPUOptions): Promise<Renderer<'webgpu'>>;
    static create<Backend extends RendererBackend>(
        options: RendererOptions<Backend>
    ): Promise<Renderer<Backend>>;
    static create(options: RendererCreateOptions = {}): Promise<Renderer> {
        return createRenderer(options) as unknown as Promise<Renderer>;
    }

    /** Probe one backend without constructing a Renderer. */
    static isBackendSupported(backend: 'webgl2', options?: RendererWebGL2Options): Promise<boolean>;
    static isBackendSupported(
        backend: 'webgpu',
        options?: RendererSupportOptions
    ): Promise<boolean>;
    static isBackendSupported(
        backend: 'webgl2' | 'webgpu',
        options: RendererWebGL2Options | RendererSupportOptions = {}
    ): Promise<boolean> {
        if (backend === 'webgpu') {
            return isRendererBackendSupported(backend, options as RendererSupportOptions);
        }
        return isRendererBackendSupported(backend, options as RendererWebGL2Options);
    }

    static [Symbol.hasInstance](value: unknown): boolean {
        return value instanceof RendererCore;
    }
}

export type {
    RendererAdapterPowerPreference,
    RendererAutoOptions,
    RendererCommonOptions,
    RendererContextPowerPreference,
    RendererCreateOptions,
    RendererExplicitOptions,
    RendererFeatureName,
    RendererOptions,
    RendererOptionsMap,
    RendererSupportOptions,
    RendererWebGL2Options,
    RendererWebGPUOptions
};

export type {
    RendererBackend,
    RendererContract,
    RendererFrame,
    RendererFrameCallback,
    RendererResourceDiagnostics,
    RendererResourceManager,
    RendererScene,
    RendererViewport,
    TextureCompressionFormat
};

export default Renderer;
