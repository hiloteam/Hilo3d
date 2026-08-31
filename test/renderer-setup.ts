import * as Hilo3d from '../src/Hilo3d';
import PerspectiveCamera from '../src/camera/PerspectiveCamera';
import RenderMesh from '../src/core/Mesh';
import { constructRenderer } from '../src/render/internal/RendererFactory';

/** Shared fixture backed by the production WebGL2 RHI path. */
export interface RendererTestEnvironment {
    camera: PerspectiveCamera;
    renderer: Hilo3d.Renderer<'webgl2'>;
    shaderRenderer: Hilo3d.ShaderRenderer;
    geometry: Hilo3d.MorphGeometry;
    material: Hilo3d.BasicMaterial;
    mesh: RenderMesh;
    fog: Hilo3d.Fog;
}

let environment: RendererTestEnvironment | undefined;

export function createHilo3dEnvironment(forceNew = false): RendererTestEnvironment {
    if (!environment || forceNew) {
        const renderer = constructRenderer({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 64,
            height: 64
        }) as Hilo3d.Renderer<'webgl2'>;
        const camera = new PerspectiveCamera();
        const shaderRenderer: Hilo3d.ShaderRenderer = {
            vertexPrecision: 'highp',
            fragmentPrecision: 'highp',
            resourceManager: renderer.resourceManager
        };
        const material = new Hilo3d.BasicMaterial();
        const geometry = new Hilo3d.MorphGeometry();
        const mesh = new RenderMesh({ material, geometry });
        const fog = new Hilo3d.Fog();

        environment = { camera, renderer, shaderRenderer, geometry, material, mesh, fog };
    }

    return environment;
}

export const testEnv = createHilo3dEnvironment();
