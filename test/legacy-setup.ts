import * as Hilo3d from '../src/Hilo3d';
import WebGL2Driver from '../src/render/internal/webgl2/WebGL2Driver';
import type WebGLState from '../src/render/internal/webgl2/WebGLState';

/**
 * Explicit opt-in fixture for tests that still cover the rollback-only renderer implementation.
 * The global Vitest setup deliberately does not create this driver so RHI v2 remains the default
 * production and test path during the final legacy-removal phase.
 */
export interface LegacyTestEnvironment {
    camera: Hilo3d.PerspectiveCamera;
    renderer: WebGL2Driver;
    gl: WebGL2RenderingContext;
    state: WebGLState;
    geometry: Hilo3d.MorphGeometry;
    material: Hilo3d.Material;
    mesh: Hilo3d.Mesh;
    fog: Hilo3d.Fog;
}

let environment: LegacyTestEnvironment | undefined;

export function createHilo3dEnvironment(forceNew = false): LegacyTestEnvironment {
    if (!environment || forceNew) {
        const renderer = new WebGL2Driver({
            domElement: document.createElement('canvas'),
            width: 64,
            height: 64
        });
        renderer.initContext();
        const camera = new Hilo3d.PerspectiveCamera();
        const { gl, state } = renderer;
        const material = new Hilo3d.Material();
        const geometry = new Hilo3d.MorphGeometry();
        const mesh = new Hilo3d.Mesh({ material, geometry });
        const fog = new Hilo3d.Fog();

        environment = {
            camera,
            renderer,
            gl,
            state,
            geometry,
            material,
            mesh,
            fog
        };
    }

    return environment;
}

export const testEnv = createHilo3dEnvironment();
