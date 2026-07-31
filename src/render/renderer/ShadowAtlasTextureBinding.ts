import LightManager from '../../light/LightManager';
import {
    clearDirectionalCascadeState,
    setDirectionalCascadeState
} from '../../light/DirectionalCascadeState';
import Texture from '../../texture/Texture';
import type { ShaderSampledBindingResources } from './ShaderBindGroupResourceCache';
import type { ShadowAtlasLightBlockState, ShadowAtlasScenePlan } from './ShadowAtlasSceneAdapter';
import type { ShadowAtlasResourceRecord } from './ShadowAtlasResourceCache';
import {
    externalTextureBindingRegistry,
    type ExternalTextureBindingProvider,
    type ExternalTextureSamplerKind
} from './ExternalTextureBindingRegistry';

const activeBindings = new WeakMap<LightManager, ShadowAtlasTextureBinding>();

function applyLightBlock(manager: LightManager, state: Readonly<ShadowAtlasLightBlockState>): void {
    manager.shadowAtlasSize = state.atlasSize;
    manager.shadowAtlasRects = state.atlasRects;
    manager.pointShadowMatrices = state.pointMatrices;
    setDirectionalCascadeState(manager, state);
    if (manager.directionalInfo !== null) {
        manager.directionalInfo.shadowMapSize = state.directionalMapSizes;
        manager.directionalInfo.shadowBias = state.directionalBiases;
        manager.directionalInfo.lightSpaceMatrix = state.directionalMatrices;
    }
    if (manager.spotInfo !== null) {
        manager.spotInfo.shadowMapSize = state.spotMapSizes;
        manager.spotInfo.shadowBias = state.spotBiases;
        manager.spotInfo.lightSpaceMatrix = state.spotMatrices;
    }
    if (manager.pointInfo !== null) {
        manager.pointInfo.shadowBias = state.pointBiases;
        manager.pointInfo.cameras = state.pointCameraPlanes;
        // The compatibility field is one matrix per point light. Atlas point shadows instead use
        // six face matrices through u_pointShadowMatrices; aliasing the larger array here would
        // overflow the fixed LightBlock ABI before either backend records a draw.
    }
}

/** Reapply shared-atlas arrays after LightManager.updateInfo rebuilt its packed light records. */
export function refreshShadowAtlasSceneBinding(manager: LightManager): void {
    activeBindings.get(manager)?.refresh(manager);
}

/**
 * Stable engine Texture identity backed by the current recoverable shadow-atlas handles.
 * `update` may replace the record after resize while every material keeps the same Texture.
 */
export class ShadowAtlasTextureBinding implements ExternalTextureBindingProvider {
    readonly texture = new Texture<null>({
        image: null,
        name: 'Shared shadow atlas',
        width: 1,
        height: 1,
        needUpdate: false,
        autoUpdate: false
    });

    #resource: Readonly<ShadowAtlasResourceRecord> | null = null;
    #resources: {
        textureView: ShadowAtlasResourceRecord['view'];
        sampler: ShadowAtlasResourceRecord['comparisonSampler'];
    } | null = null;
    #state: Readonly<ShadowAtlasLightBlockState> | null = null;
    readonly #managers = new Set<LightManager>();
    readonly #unregister: () => void;
    #destroyed = false;

    constructor() {
        this.#unregister = externalTextureBindingRegistry.register(this.texture, this);
    }

    resolve(
        samplerKind: ExternalTextureSamplerKind
    ): Readonly<ShaderSampledBindingResources> | null {
        this.assertAlive();
        if (samplerKind !== 'comparison-sampler') return null;
        const resources = this.#resources;
        if (resources === null) {
            throw new Error('Shadow atlas Texture is not backed by a prepared resource');
        }
        return resources;
    }

    update(resource: Readonly<ShadowAtlasResourceRecord>): void {
        this.assertAlive();
        this.#resource = resource;
        if (this.#resources === null) {
            this.#resources = {
                textureView: resource.view,
                sampler: resource.comparisonSampler
            };
        } else {
            this.#resources.textureView = resource.view;
            this.#resources.sampler = resource.comparisonSampler;
        }
        this.texture.width = resource.width;
        this.texture.height = resource.height;
    }

    attach(manager: LightManager, plan: Readonly<ShadowAtlasScenePlan>): void {
        this.assertAlive();
        if (!(manager instanceof LightManager)) {
            throw new TypeError('Shadow atlas binding requires a real LightManager');
        }
        if (this.#resource === null) {
            throw new Error('Shadow atlas binding requires update() before attach()');
        }
        const previous = activeBindings.get(manager);
        if (previous !== undefined && previous !== this) previous.detach(manager);
        this.#state = plan.lightBlock;
        this.#managers.add(manager);
        activeBindings.set(manager, this);
        this.refresh(manager);
    }

    refresh(manager: LightManager): void {
        this.assertAlive();
        if (!this.#managers.has(manager)) return;
        const state = this.#state;
        if (state === null) throw new Error('Shadow atlas binding lost its LightBlock state');
        manager.shadowAtlas = this.texture;
        applyLightBlock(manager, state);
    }

    detach(manager: LightManager): boolean {
        this.assertAlive();
        if (!this.#managers.delete(manager)) return false;
        if (activeBindings.get(manager) === this) activeBindings.delete(manager);
        clearDirectionalCascadeState(manager);
        if (manager.shadowAtlas === this.texture) {
            manager.shadowAtlas = null;
            manager.shadowAtlasSize = new Float32Array(4);
            manager.shadowAtlasRects = new Float32Array(0);
            manager.pointShadowMatrices = new Float32Array(0);
        }
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const manager of this.#managers) {
            if (activeBindings.get(manager) === this) activeBindings.delete(manager);
            clearDirectionalCascadeState(manager);
            if (manager.shadowAtlas === this.texture) manager.shadowAtlas = null;
        }
        this.#managers.clear();
        this.#unregister();
        this.texture.destroy();
        this.#resource = null;
        this.#resources = null;
        this.#state = null;
        this.#destroyed = true;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('ShadowAtlasTextureBinding is destroyed');
    }
}
