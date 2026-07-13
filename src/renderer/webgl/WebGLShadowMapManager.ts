import type Camera from '../../camera/Camera';
import CubeLightShadow from './shadow/CubeLightShadow';
import type Light from '../../light/Light';
import type { LightShadowOptions } from '../../light/Light';
import {
    setLightShadowBindingProvider,
    type default as LightManager,
    type LightShadowBinding
} from '../../light/LightManager';
import LightShadow from './shadow/LightShadow';
import {
    clearLightShadows,
    getLightShadow,
    pruneLightShadows,
    setLightShadow
} from './shadow/LightShadowRegistry';
import PointLight from '../../light/PointLight';
import type WebGLRenderer from './WebGLRenderer';
import type { RendererViewport } from '../common/Renderer';

function pointShadowSize(shadow: LightShadowOptions, renderer: WebGLRenderer): number {
    if (
        shadow.width !== undefined &&
        shadow.height !== undefined &&
        shadow.width !== shadow.height
    ) {
        throw new RangeError('Point-light cube shadows require equal width and height.');
    }
    const size = shadow.width ?? shadow.height ?? Math.min(renderer.width, renderer.height);
    if (!Number.isSafeInteger(size) || size <= 0) {
        throw new RangeError('Point-light cube shadow size must be a positive integer.');
    }
    const gl = renderer.gl;
    const maxCubeMapSize: unknown = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
    const maxRenderbufferSize: unknown = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    if (typeof maxCubeMapSize !== 'number' || typeof maxRenderbufferSize !== 'number') {
        throw new Error('WebGL2 did not expose cube shadow size limits.');
    }
    const maximumSize = Math.min(maxCubeMapSize, maxRenderbufferSize);
    if (size > maximumSize) {
        throw new RangeError(
            `Point-light cube shadow size ${String(size)} exceeds the WebGL2 limit ${String(maximumSize)}.`
        );
    }
    return size;
}

function createShadowRuntime(
    manager: LightManager,
    light: Light,
    renderer: WebGLRenderer,
    shadow: LightShadowOptions,
    beginCameraPass: (camera: Camera, viewport?: RendererViewport) => void
): LightShadow {
    if (!light.isDirectionalLight && !light.isSpotLight && !(light instanceof PointLight)) {
        throw new Error(`${light.constructor.name} does not support shadow maps.`);
    }

    const pointSize = light instanceof PointLight ? pointShadowSize(shadow, renderer) : null;
    const parameters = {
        light,
        renderer,
        width: pointSize ?? shadow.width ?? renderer.width,
        height: pointSize ?? shadow.height ?? renderer.height,
        debug: shadow.debug ?? false,
        ...(shadow.cameraInfo ? { cameraInfo: shadow.cameraInfo } : {})
    };
    const runtime =
        light instanceof PointLight
            ? new CubeLightShadow({ ...parameters, light }, beginCameraPass)
            : new LightShadow(parameters, beginCameraPass);
    if ('minBias' in shadow) runtime.minBias = shadow.minBias;
    if ('maxBias' in shadow) runtime.maxBias = shadow.maxBias;
    setLightShadow(manager, light, runtime);
    return runtime;
}

function renderLightShadow(
    manager: LightManager,
    light: Light,
    renderer: WebGLRenderer,
    camera: Camera,
    beginCameraPass: (camera: Camera, viewport?: RendererViewport) => void
): void {
    if (!light.shadow) return;
    const runtime =
        getLightShadow(manager, light) ??
        createShadowRuntime(manager, light, renderer, light.shadow, beginCameraPass);
    runtime.createShadowMap(camera);
}

/** WebGL-only shadow orchestration kept outside the backend-neutral public light classes. */
export function renderWebGLShadowMaps(
    manager: LightManager,
    renderer: WebGLRenderer,
    camera: Camera,
    beginCameraPass: (camera: Camera, viewport?: RendererViewport) => void
): void {
    setLightShadowBindingProvider(manager, light => getWebGLLightShadowBinding(manager, light));
    const activeLights = new Set<Light>();
    if (manager.shadowEnabled) {
        for (const light of [
            ...manager.directionalLights,
            ...manager.spotLights,
            ...manager.pointLights,
            ...manager.areaLights
        ]) {
            if (light.shadow) activeLights.add(light);
        }
    }
    pruneLightShadows(manager, activeLights);
    if (!manager.shadowEnabled) return;
    for (const light of manager.directionalLights)
        renderLightShadow(manager, light, renderer, camera, beginCameraPass);
    for (const light of manager.spotLights)
        renderLightShadow(manager, light, renderer, camera, beginCameraPass);
    for (const light of manager.pointLights)
        renderLightShadow(manager, light, renderer, camera, beginCameraPass);
    for (const light of manager.areaLights)
        renderLightShadow(manager, light, renderer, camera, beginCameraPass);
}

/** Release all WebGL shadow allocations retained by one renderer. */
export function releaseWebGLShadowMaps(manager: LightManager): void {
    clearLightShadows(manager);
}

/** Resolve WebGL-only shadow allocations through the backend-neutral light packing hook. */
export function getWebGLLightShadowBinding(
    manager: LightManager,
    light: Light
): LightShadowBinding | null {
    const shadow = getLightShadow(manager, light);
    const texture = shadow?.framebuffer?.texture;
    const camera = shadow?.camera;
    if (!shadow || !texture || !camera) return null;
    return {
        texture,
        width: shadow.width,
        height: shadow.height,
        minBias: shadow.minBias,
        maxBias: shadow.maxBias,
        camera
    };
}
