import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Geometry from '../../../src/geometry/Geometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import Material from '../../../src/material/Material';
import { RenderGraphFramePlanner } from '../../../src/render/RenderGraphFramePlan';
import RenderList from '../../../src/render/RenderList';
import type { Renderer } from '../../../src/render/Renderer';

function mesh(): Mesh {
    return new Mesh({ geometry: new Geometry(), material: new Material(), frustumTest: false });
}

describe('RenderGraphFramePlanner', () => {
    it('reuses its plan storage while rebuilding shared mesh and light queues', () => {
        const planner = new RenderGraphFramePlanner();
        const renderList = new RenderList();
        const lightManager = new LightManager();
        const camera = new PerspectiveCamera();
        const stage = new Node();
        const firstMesh = mesh();
        const hiddenParent = new Node({ visible: false });
        const hiddenMesh = mesh();
        const light = new DirectionalLight({ shadow: {} });
        stage.addChild(firstMesh).addChild(hiddenParent).addChild(light);
        hiddenParent.addChild(hiddenMesh);

        const first = planner.build(stage, camera, renderList, lightManager);
        expect(first.meshes).toEqual([firstMesh]);
        expect(first.lights).toEqual([light]);
        expect(first.shadowLights.has(light)).toBe(true);
        expect(renderList.opaqueList).toEqual([firstMesh]);
        expect(lightManager.directionalLights).toEqual([light]);

        firstMesh.destroy({
            resourceManager: {
                destroyMesh(meshToDestroy: Mesh) {
                    expect(meshToDestroy).toBe(firstMesh);
                }
            }
        } as unknown as Renderer);
        stage.addChild(firstMesh);
        const replacement = mesh();
        stage.addChild(replacement);
        const second = planner.build(stage, camera, renderList, lightManager);

        expect(second).toBe(first);
        expect(second.meshes).toEqual([replacement]);
        expect(renderList.opaqueList).toEqual([replacement]);
        expect(lightManager.directionalLights).toEqual([light]);
    });

    it('does not schedule disabled shadow lights', () => {
        const planner = new RenderGraphFramePlanner();
        const renderList = new RenderList();
        const lightManager = new LightManager();
        const camera = new PerspectiveCamera();
        const stage = new Node();
        const light = new DirectionalLight({ enabled: false, shadow: {} });
        stage.addChild(light);

        const plan = planner.build(stage, camera, renderList, lightManager);

        expect(plan.lights).toEqual([light]);
        expect(plan.shadowLights.size).toBe(0);
    });
});
