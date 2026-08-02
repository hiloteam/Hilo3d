import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import Material from '../../../src/material/BasicMaterial';
import { MeshDrawRevisionTracker } from '../../../src/render/renderer/MeshDrawRevisionTracker';
import type { RHIMeshDrawTargetDescriptor } from '../../../src/render/renderer/RHIDescriptorMapping';
import { describe, expect, it } from 'vitest';

const target: RHIMeshDrawTargetDescriptor = {
    colorFormats: ['rgba8unorm'],
    depthStencilFormat: 'depth24plus',
    sampleCount: 1
};

function createMesh(): {
    readonly mesh: Mesh;
    readonly geometry: Geometry;
    readonly vertices: GeometryData;
    readonly indices: GeometryData;
    readonly material: Material;
} {
    const vertices = new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3);
    const indices = new GeometryData(new Uint16Array([0, 1, 2]), 1);
    const geometry = new Geometry({ vertices, indices });
    const material = new Material();
    return { mesh: new Mesh({ geometry, material }), geometry, vertices, indices, material };
}

function capture(
    tracker: MeshDrawRevisionTracker,
    mesh: Mesh,
    overrides: Partial<{
        shaderToken: number;
        resourceBindings: number;
        target: RHIMeshDrawTargetDescriptor;
        deviceGeneration: number;
        vertexLayoutIdentity: object;
    }> = {}
) {
    return tracker.capture({
        mesh,
        shaderToken: overrides.shaderToken ?? 10,
        resourceBindings: overrides.resourceBindings ?? 20,
        ...(overrides.vertexLayoutIdentity === undefined
            ? {}
            : { vertexLayoutIdentity: overrides.vertexLayoutIdentity }),
        target: overrides.target ?? target,
        deviceGeneration: overrides.deviceGeneration ?? 1
    });
}

describe('MeshDrawRevisionTracker', () => {
    it('returns the same revision object for an exact steady-state snapshot', () => {
        const tracker = new MeshDrawRevisionTracker();
        const { mesh } = createMesh();
        const first = capture(tracker, mesh);

        expect(capture(tracker, mesh)).toBe(first);
        expect(first.deviceGeneration).toBe(1);
        expect(
            [
                first.geometry,
                first.materialVariant,
                first.renderState,
                first.resourceBindings,
                first.target
            ].every(Number.isSafeInteger)
        ).toBe(true);
    });

    it('detects direct geometry layout, storage, index, and topology mutations', () => {
        const tracker = new MeshDrawRevisionTracker();
        const { mesh, geometry, vertices, indices } = createMesh();
        let previous = capture(tracker, mesh);

        vertices.stride = 12;
        let current = capture(tracker, mesh);
        expect(current.geometry).not.toBe(previous.geometry);
        expect(current.materialVariant).toBe(previous.materialVariant);

        previous = current;
        indices.data = new Uint16Array([2, 1, 0]);
        current = capture(tracker, mesh);
        expect(current.geometry).not.toBe(previous.geometry);

        previous = current;
        geometry.mode += 1;
        current = capture(tracker, mesh);
        expect(current.geometry).not.toBe(previous.geometry);
    });

    it('invalidates geometry when a reflected multi-stream plan identity changes', () => {
        const tracker = new MeshDrawRevisionTracker();
        const { mesh } = createMesh();
        const firstPlan = {};
        const secondPlan = {};
        const first = capture(tracker, mesh, { vertexLayoutIdentity: firstPlan });

        expect(capture(tracker, mesh, { vertexLayoutIdentity: firstPlan })).toBe(first);
        const changed = capture(tracker, mesh, { vertexLayoutIdentity: secondPlan });
        expect(changed.geometry).not.toBe(first.geometry);
        expect(changed.materialVariant).toBe(first.materialVariant);
        expect(changed.resourceBindings).toBe(first.resourceBindings);
    });

    it('separates immutable definition replacement from instance-data invalidation', () => {
        const tracker = new MeshDrawRevisionTracker();
        const { mesh } = createMesh();
        const first = capture(tracker, mesh);

        const material = new Material({ state: { depthWrite: false } });
        mesh.material = material;
        const renderState = capture(tracker, mesh);
        expect(renderState.renderState).not.toBe(first.renderState);
        expect(renderState.materialVariant).not.toBe(first.materialVariant);

        material.invalidateData();
        const materialRevision = capture(tracker, mesh);
        expect(materialRevision.materialVariant).not.toBe(renderState.materialVariant);
        expect(materialRevision.renderState).toBe(renderState.renderState);

        const shaderRevision = capture(tracker, mesh, { shaderToken: 11 });
        expect(shaderRevision.materialVariant).not.toBe(materialRevision.materialVariant);
        expect(shaderRevision.renderState).toBe(materialRevision.renderState);
    });

    it('tracks binding, target, and device revisions independently', () => {
        const tracker = new MeshDrawRevisionTracker();
        const { mesh } = createMesh();
        const first = capture(tracker, mesh);
        const binding = capture(tracker, mesh, { resourceBindings: 21 });
        expect(binding.resourceBindings).not.toBe(first.resourceBindings);
        expect(binding.target).toBe(first.target);

        const nextTarget: RHIMeshDrawTargetDescriptor = {
            colorFormats: ['bgra8unorm'],
            depthStencilFormat: 'depth24plus',
            sampleCount: 4
        };
        const targetRevision = capture(tracker, mesh, {
            resourceBindings: 21,
            target: nextTarget
        });
        expect(targetRevision.target).not.toBe(binding.target);
        expect(targetRevision.resourceBindings).toBe(binding.resourceBindings);

        const sameTargetValues = capture(tracker, mesh, {
            resourceBindings: 21,
            target: { ...nextTarget, colorFormats: ['bgra8unorm'] }
        });
        expect(sameTargetValues).toBe(targetRevision);

        const mrtTarget = capture(tracker, mesh, {
            resourceBindings: 21,
            target: {
                colorFormats: ['bgra8unorm', 'rgba16float'],
                depthStencilFormat: 'depth24plus',
                sampleCount: 4
            }
        });
        expect(mrtTarget.target).not.toBe(targetRevision.target);

        const depthOnlyTarget = capture(tracker, mesh, {
            resourceBindings: 21,
            target: {
                colorFormats: [],
                depthStencilFormat: 'depth24plus',
                sampleCount: 1
            }
        });
        expect(depthOnlyTarget.target).not.toBe(mrtTarget.target);

        const deviceRevision = capture(tracker, mesh, {
            resourceBindings: 21,
            target: {
                colorFormats: [],
                depthStencilFormat: 'depth24plus',
                sampleCount: 1
            },
            deviceGeneration: 2
        });
        expect(deviceRevision.deviceGeneration).toBe(2);
        expect(deviceRevision.target).toBe(depthOnlyTarget.target);
    });

    it('rejects incomplete meshes and invalid tokens', () => {
        const tracker = new MeshDrawRevisionTracker();
        const { mesh } = createMesh();
        expect(() => capture(tracker, mesh, { shaderToken: -1 })).toThrow(/Shader token/u);
        mesh.geometry = null;
        expect(() => capture(tracker, mesh)).toThrow(/position stream/u);
    });
});
