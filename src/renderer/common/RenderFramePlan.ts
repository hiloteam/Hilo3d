import type Camera from '../../camera/Camera';
import Light from '../../light/Light';
import type LightManager from '../../light/LightManager';
import Mesh from '../../core/Mesh';
import Node from '../../core/Node';
import type RenderList from './RenderList';
import type { RendererScene } from './Renderer';

/**
 * Reusable, backend-neutral result of scene traversal for one render pass.
 *
 * The arrays and set intentionally retain their storage between frames. Backends may inspect the
 * plan while recording shadows and draw commands, but must not retain its contents after the next
 * call to {@link RenderFramePlanner.build}.
 */
export interface RenderFramePlan {
    readonly meshes: readonly Mesh[];
    readonly lights: readonly Light[];
    readonly shadowLights: ReadonlySet<Light>;
}

/** Collects visible scene objects once and feeds the shared render/light queues. */
export class RenderFramePlanner {
    private readonly meshes: Mesh[] = [];
    private readonly lights: Light[] = [];
    private readonly shadowLights = new Set<Light>();
    private readonly plan: RenderFramePlan = Object.freeze({
        meshes: this.meshes,
        lights: this.lights,
        shadowLights: this.shadowLights
    });

    build(
        stage: RendererScene,
        camera: Camera,
        renderList: RenderList,
        lightManager: LightManager
    ): RenderFramePlan {
        this.meshes.length = 0;
        this.lights.length = 0;
        this.shadowLights.clear();
        renderList.reset();
        lightManager.reset();

        stage.traverse(node => {
            if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
            if (node instanceof Mesh) {
                if (!node.isDestroyed) this.meshes.push(node);
            } else if (node instanceof Light) {
                this.lights.push(node);
            }
            return Node.TRAVERSE_STOP_NONE;
        });

        for (const mesh of this.meshes) renderList.addMesh(mesh, camera);
        renderList.sort();
        for (const light of this.lights) {
            lightManager.addLight(light);
            if (lightManager.shadowEnabled && light.enabled && light.shadow !== null) {
                this.shadowLights.add(light);
            }
        }
        return this.plan;
    }
}
