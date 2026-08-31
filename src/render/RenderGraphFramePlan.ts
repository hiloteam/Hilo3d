import type Camera from '../camera/Camera';
import type Light from '../light/Light';
import type LightManager from '../light/LightManager';
import type Mesh from '../core/Mesh';
import type RenderList from './RenderList';
import type { RenderWorld } from './world/RenderWorld';

/**
 * Reusable, backend-neutral result of scene traversal for one render pass.
 *
 * The arrays and set intentionally retain their storage between frames. Backends may inspect the
 * plan while recording shadows and draw commands, but must not retain its contents after the next
 * renderer planning pass.
 */
export interface RenderGraphFramePlan {
    readonly meshes: readonly Mesh[];
    readonly lights: readonly Light[];
    readonly shadowLights: ReadonlySet<Light>;
}

/** Collects visible scene objects once and feeds the shared render/light queues. */
export class RenderGraphFramePlanner {
    private readonly meshes: Mesh[] = [];
    private readonly lights: Light[] = [];
    private readonly shadowLights = new Set<Light>();
    private readonly plan: RenderGraphFramePlan = Object.freeze({
        meshes: this.meshes,
        lights: this.lights,
        shadowLights: this.shadowLights
    });

    build(
        renderWorld: RenderWorld,
        camera: Camera,
        renderList: RenderList,
        lightManager: LightManager,
        frustumCulling = true
    ): RenderGraphFramePlan {
        this.meshes.length = 0;
        this.lights.length = 0;
        this.shadowLights.clear();
        renderList.reset();
        lightManager.reset();
        const cameraVisibility = camera.visibility >>> 0;

        for (let index = 0; index < renderWorld.length; index++) {
            const mesh = renderWorld.meshes[index];
            if (mesh && mesh.visible && (cameraVisibility & (mesh.layer >>> 0)) !== 0) {
                this.meshes.push(mesh);
            }
        }
        for (const extension of renderWorld.extensions) {
            const meshes = extension.meshes;
            if (!meshes) continue;
            for (const mesh of meshes) {
                if (mesh.visible && (cameraVisibility & (mesh.layer >>> 0)) !== 0) {
                    this.meshes.push(mesh);
                }
            }
        }
        const extractedLights = renderWorld.lights.lights;
        for (let index = 0; index < renderWorld.lights.length; index++) {
            const light = extractedLights[index];
            if (light && (cameraVisibility & (light.layer >>> 0)) !== 0) {
                this.lights.push(light);
            }
        }

        for (const mesh of this.meshes) renderList.addMesh(mesh, camera, frustumCulling);
        renderList.sort();
        for (const light of this.lights) {
            lightManager.addLight(light);
            if (lightManager.shadowEnabled && light.enabled && light.shadow !== null) {
                this.shadowLights.add(light);
            }
        }
        return this.plan;
    }

    /** Drop frame-owned object references while retaining array and Set capacity. */
    reset(): void {
        this.meshes.length = 0;
        this.lights.length = 0;
        this.shadowLights.clear();
    }
}
