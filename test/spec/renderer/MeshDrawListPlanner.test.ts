import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import Material from '../../../src/material/Material';
import Vector3 from '../../../src/math/Vector3';
import {
    MeshDrawListPlanner,
    type MeshDrawListPlan
} from '../../../src/render/renderer/MeshDrawListPlanner';
import type { Renderer } from '../../../src/render/Renderer';

function material(id: string, renderOrder = 0, transparent = false): Material {
    const value = new Material({ renderOrder, transparent });
    Reflect.set(value, 'id', id);
    return value;
}

function geometry(id: string): Geometry {
    const value = new Geometry();
    Reflect.set(value, 'id', id);
    return value;
}

function mesh(
    id: string,
    meshMaterial: Material,
    meshGeometry: Geometry,
    useInstanced = false
): Mesh {
    return Object.assign(
        new Mesh({ material: meshMaterial, geometry: meshGeometry, useInstanced }),
        { id }
    );
}

function destroyMesh(value: Mesh): void {
    value.destroy({
        resourceManager: {
            destroyMesh(meshToDestroy: Mesh) {
                expect(meshToDestroy).toBe(value);
            }
        }
    } as unknown as Renderer);
}

function expectEmpty(plan: Readonly<MeshDrawListPlan>): void {
    expect(plan.opaqueMeshes).toEqual([]);
    expect(plan.transparentMeshes).toEqual([]);
    expect(plan.instancedBatches).toEqual([]);
}

describe('MeshDrawListPlanner', () => {
    it('classifies direct and explicitly instanced meshes and sorts every queue', () => {
        const planner = new MeshDrawListPlanner();
        const opaqueEarly = mesh('mesh-opaque-early', material('mat-early', -2), geometry('g-1'));
        const opaqueLate = mesh('mesh-opaque-late', material('mat-late', 2), geometry('g-2'));
        const transparentDirect = mesh(
            'mesh-transparent',
            material('mat-transparent', 1, true),
            geometry('g-3')
        );
        const instancedMaterial = material('mat-instanced', 0);
        const instancedGeometry = geometry('g-instanced');
        const instancedA = mesh('mesh-instanced-a', instancedMaterial, instancedGeometry, true);
        const instancedB = mesh('mesh-instanced-b', instancedMaterial, instancedGeometry, true);
        const transparentInstanced = mesh(
            'mesh-instanced-transparent',
            material('mat-instanced-transparent', 0, true),
            geometry('g-instanced-transparent'),
            true
        );

        const plan = planner.build([
            opaqueLate,
            instancedB,
            transparentDirect,
            transparentInstanced,
            instancedA,
            opaqueEarly
        ]);

        expect(plan.opaqueMeshes).toEqual([opaqueEarly, opaqueLate]);
        expect(plan.transparentMeshes).toEqual([transparentDirect]);
        expect(plan.instancedBatches).toHaveLength(2);
        expect(plan.instancedBatches[0]).toMatchObject({
            material: instancedMaterial,
            geometry: instancedGeometry,
            renderOrder: 0,
            transparent: false,
            meshes: [instancedB, instancedA]
        });
        expect(plan.instancedBatches[1]).toMatchObject({
            material: transparentInstanced.material,
            geometry: transparentInstanced.geometry,
            renderOrder: 0,
            transparent: true,
            meshes: [transparentInstanced]
        });
        for (const owner of [
            opaqueEarly,
            opaqueLate,
            transparentDirect,
            instancedA,
            instancedB,
            transparentInstanced
        ]) {
            expect(planner.hasOwner(owner)).toBe(true);
        }
    });

    it('uses identities for deterministic opaque ordering and preserves transparent tie order', () => {
        const planner = new MeshDrawListPlanner();
        const materialA = material('material-a');
        const materialB = material('material-b');
        const geometryA = geometry('geometry-a');
        const geometryB = geometry('geometry-b');
        const opaqueMaterialB = mesh('mesh-b', materialB, geometryA);
        const opaqueGeometryB = mesh('mesh-c', materialA, geometryB);
        const opaqueMeshB = mesh('mesh-b', materialA, geometryA);
        const opaqueMeshA = mesh('mesh-a', materialA, geometryA);
        const transparentMaterial = material('transparent', 4, true);
        const transparentA = mesh('transparent-a', transparentMaterial, geometryA);
        const transparentB = mesh('transparent-b', transparentMaterial, geometryA);

        const first = planner.build([
            opaqueMaterialB,
            opaqueGeometryB,
            opaqueMeshB,
            opaqueMeshA,
            transparentB,
            transparentA
        ]);
        expect(first.opaqueMeshes).toEqual([
            opaqueMeshA,
            opaqueMeshB,
            opaqueGeometryB,
            opaqueMaterialB
        ]);
        expect(first.transparentMeshes).toEqual([transparentB, transparentA]);

        const second = planner.build([
            transparentA,
            opaqueGeometryB,
            opaqueMeshA,
            opaqueMaterialB,
            opaqueMeshB,
            transparentB
        ]);
        expect(second).toBe(first);
        expect(second.opaqueMeshes).toEqual([
            opaqueMeshA,
            opaqueMeshB,
            opaqueGeometryB,
            opaqueMaterialB
        ]);
        expect(second.transparentMeshes).toEqual([transparentA, transparentB]);
    });

    it('reuses result, batch, diagnostics, and high-water records without steady allocations', () => {
        const planner = new MeshDrawListPlanner();
        const directOpaque = mesh('opaque', material('opaque'), geometry('opaque'));
        const directTransparent = mesh(
            'transparent',
            material('transparent', 0, true),
            geometry('transparent')
        );
        const sharedMaterial = material('instanced');
        const sharedGeometry = geometry('instanced');
        const instancedA = mesh('instanced-a', sharedMaterial, sharedGeometry, true);
        const instancedB = mesh('instanced-b', sharedMaterial, sharedGeometry, true);
        const input = [directOpaque, directTransparent, instancedA, instancedB];

        const first = planner.build(input);
        const opaqueArray = first.opaqueMeshes;
        const transparentArray = first.transparentMeshes;
        const batchArray = first.instancedBatches;
        const batch = first.instancedBatches[0];
        const batchMeshes = batch?.meshes;
        const diagnostics = planner.diagnostics();
        const allocationCount = diagnostics.storageAllocationCount;

        for (let iteration = 0; iteration < 32; iteration += 1) {
            const next = planner.build(input);
            expect(next).toBe(first);
            expect(next.opaqueMeshes).toBe(opaqueArray);
            expect(next.transparentMeshes).toBe(transparentArray);
            expect(next.instancedBatches).toBe(batchArray);
            expect(next.instancedBatches[0]).toBe(batch);
            expect(next.instancedBatches[0]?.meshes).toBe(batchMeshes);
            expect(planner.diagnostics()).toBe(diagnostics);
            expect(diagnostics.storageAllocationCount).toBe(allocationCount);
        }

        expect(diagnostics).toMatchObject({
            activeOwnerCount: 4,
            activeInstancedBatchCount: 1,
            inputCapacity: 4,
            opaqueCapacity: 1,
            transparentCapacity: 1,
            instancedBatchCapacity: 1,
            largestInstancedBatchCapacity: 2,
            ownerRecordCapacity: 4,
            geometryGroupCapacity: 1
        });

        const replacementMaterial = material('replacement-instanced');
        const replacementGeometry = geometry('replacement-instanced');
        const replacementInput = [
            mesh('replacement-opaque', material('replacement-opaque'), geometry('replacement-o')),
            mesh(
                'replacement-transparent',
                material('replacement-transparent', 0, true),
                geometry('replacement-t')
            ),
            mesh('replacement-instanced-a', replacementMaterial, replacementGeometry, true),
            mesh('replacement-instanced-b', replacementMaterial, replacementGeometry, true)
        ];
        planner.build(replacementInput);
        expect(diagnostics.storageAllocationCount).toBe(allocationCount);
        planner.build(input);
        expect(first.instancedBatches[0]).toBe(batch);
        expect(diagnostics.storageAllocationCount).toBe(allocationCount);

        planner.reset();
        expectEmpty(first);
        expect(diagnostics.activeOwnerCount).toBe(0);
        expect(diagnostics.storageAllocationCount).toBe(allocationCount);
        const rebuilt = planner.build(input);
        expect(rebuilt).toBe(first);
        expect(rebuilt.instancedBatches[0]).toBe(batch);
        expect(rebuilt.instancedBatches[0]?.meshes).toBe(batchMeshes);
        expect(diagnostics.storageAllocationCount).toBe(allocationCount);
    });

    it('splits exact geometry/material groups into stable batches of at most 128 instances', () => {
        const planner = new MeshDrawListPlanner();
        const sharedMaterial = material('instanced-129');
        const sharedGeometry = geometry('instanced-129');
        const meshes = Array.from({ length: 257 }, (_, index) =>
            mesh(`instanced-${String(index)}`, sharedMaterial, sharedGeometry, true)
        );

        const plan = planner.build(meshes);
        expect(plan.instancedBatches.map(batch => batch.meshes.length)).toEqual([128, 128, 1]);
        const owners = [...plan.instancedBatches];
        const meshArrays = plan.instancedBatches.map(batch => batch.meshes);

        for (let iteration = 0; iteration < 4; iteration += 1) {
            planner.build(meshes);
            expect(plan.instancedBatches.map(batch => batch.meshes.length)).toEqual([128, 128, 1]);
            for (let index = 0; index < owners.length; index += 1) {
                expect(plan.instancedBatches[index]).toBe(owners[index]);
                expect(plan.instancedBatches[index]?.meshes).toBe(meshArrays[index]);
            }
        }

        planner.build(meshes.slice(0, 129));
        expect(plan.instancedBatches.map(batch => batch.meshes.length)).toEqual([128, 1]);
        expect(plan.instancedBatches[0]).toBe(owners[0]);
        expect(plan.instancedBatches[1]).toBe(owners[1]);
        expect(planner.diagnostics().largestInstancedBatchCapacity).toBe(128);
    });

    it('observes render-order, transparency, instancing, geometry, and material mutations', () => {
        const planner = new MeshDrawListPlanner();
        const mutableMaterial = material('mutable', 2);
        const mutableMesh = mesh('mutable', mutableMaterial, geometry('mutable'));
        const fixedMesh = mesh('fixed', material('fixed', 0), geometry('fixed'));

        const plan = planner.build([mutableMesh, fixedMesh]);
        expect(plan.opaqueMeshes).toEqual([fixedMesh, mutableMesh]);

        mutableMaterial.renderOrder = -1;
        planner.build([mutableMesh, fixedMesh]);
        expect(plan.opaqueMeshes).toEqual([mutableMesh, fixedMesh]);

        mutableMaterial.transparent = true;
        planner.build([mutableMesh, fixedMesh]);
        expect(plan.opaqueMeshes).toEqual([fixedMesh]);
        expect(plan.transparentMeshes).toEqual([mutableMesh]);

        mutableMesh.useInstanced = true;
        planner.build([mutableMesh, fixedMesh]);
        expect(plan.transparentMeshes).toEqual([]);
        expect(plan.instancedBatches[0]).toMatchObject({
            geometry: mutableMesh.geometry,
            material: mutableMaterial,
            transparent: true,
            renderOrder: -1,
            meshes: [mutableMesh]
        });

        const replacementMaterial = material('replacement', -3);
        const replacementGeometry = geometry('replacement');
        mutableMesh.material = replacementMaterial;
        mutableMesh.geometry = replacementGeometry;
        planner.build([mutableMesh, fixedMesh]);
        expect(plan.instancedBatches[0]).toMatchObject({
            geometry: replacementGeometry,
            material: replacementMaterial,
            transparent: false,
            renderOrder: -3,
            meshes: [mutableMesh]
        });

        mutableMesh.useInstanced = false;
        planner.build([mutableMesh, fixedMesh]);
        expect(plan.instancedBatches).toEqual([]);
        expect(plan.opaqueMeshes).toEqual([mutableMesh, fixedMesh]);
    });

    it('classifies and groups by the effective force material, including material-less meshes', () => {
        const planner = new MeshDrawListPlanner();
        const sharedGeometry = geometry('forced-geometry');
        const direct = mesh('forced-direct', material('source-direct'), geometry('direct'));
        direct.material = null;
        const instancedA = mesh('forced-instanced-a', material('source-a'), sharedGeometry, true);
        const instancedB = mesh(
            'forced-instanced-b',
            material('source-b', 0, true),
            sharedGeometry,
            true
        );
        const forced = material('forced', -4, true);

        const plan = planner.build([direct, instancedA, instancedB], forced);
        expect(plan.opaqueMeshes).toEqual([]);
        expect(plan.transparentMeshes).toEqual([direct]);
        expect(plan.instancedBatches).toHaveLength(1);
        expect(plan.instancedBatches[0]).toMatchObject({
            material: forced,
            geometry: sharedGeometry,
            renderOrder: -4,
            transparent: true,
            meshes: [instancedA, instancedB]
        });

        forced.transparent = false;
        planner.build([direct, instancedA, instancedB], forced);
        expect(plan.opaqueMeshes).toEqual([direct]);
        expect(plan.transparentMeshes).toEqual([]);
        expect(plan.instancedBatches[0]?.transparent).toBe(false);
    });

    it('recomputes back-to-front depth when an override changes opaque meshes to transparent', () => {
        const planner = new MeshDrawListPlanner();
        const source = material('source');
        const sharedGeometry = geometry('override-depth');
        const near = mesh('near', source, sharedGeometry);
        const far = mesh('far', source, sharedGeometry);
        near.setPosition(0, 0, -2).updateMatrixWorld(true);
        far.setPosition(0, 0, -10).updateMatrixWorld(true);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
        camera.setPosition(0, 0, 0).lookAt(new Vector3(0, 0, -1));
        camera.updateViewProjectionMatrix();
        const transparentOverride = material('transparent-override', 0, true);

        const plan = planner.build([near, far], transparentOverride, true, camera);

        expect(plan.transparentMeshes).toEqual([far, near]);
    });

    it('detaches owners, prunes omitted meshes, and resets without replacing the result', () => {
        const planner = new MeshDrawListPlanner();
        const direct = mesh('direct', material('direct'), geometry('direct'));
        const sharedMaterial = material('shared');
        const sharedGeometry = geometry('shared');
        const instancedA = mesh('instanced-a', sharedMaterial, sharedGeometry, true);
        const instancedB = mesh('instanced-b', sharedMaterial, sharedGeometry, true);
        const plan = planner.build([direct, instancedA, instancedB]);

        expect(planner.detach(instancedA)).toBe(true);
        expect(planner.hasOwner(instancedA)).toBe(false);
        expect(plan.instancedBatches[0]?.meshes).toEqual([instancedB]);
        expect(planner.detach(instancedA)).toBe(false);

        expect(planner.detach(instancedB)).toBe(true);
        expect(plan.instancedBatches).toEqual([]);
        expect(plan.opaqueMeshes).toEqual([direct]);

        planner.build([instancedA]);
        expect(planner.hasOwner(direct)).toBe(false);
        expect(planner.hasOwner(instancedA)).toBe(true);
        expect(plan.instancedBatches[0]?.meshes).toEqual([instancedA]);

        planner.reset();
        expectEmpty(plan);
        expect(planner.hasOwner(instancedA)).toBe(false);
        expect(planner.diagnostics().activeOwnerCount).toBe(0);
    });

    it('rejects duplicate, destroyed, incomplete, sparse, and invalid-order inputs atomically', () => {
        const planner = new MeshDrawListPlanner();
        const valid = mesh('valid', material('valid'), geometry('valid'));
        const plan = planner.build([valid]);

        expect(() => planner.build([valid, valid])).toThrow('appears more than once');
        expect(plan.opaqueMeshes).toEqual([valid]);

        const missingGeometry = mesh('missing-geometry', material('m'), geometry('g'));
        missingGeometry.geometry = null;
        expect(() => planner.build([missingGeometry])).toThrow('must have geometry');
        expect(plan.opaqueMeshes).toEqual([valid]);

        const missingMaterial = mesh('missing-material', material('m'), geometry('g'));
        missingMaterial.material = null;
        expect(() => planner.build([missingMaterial])).toThrow('must have material');

        const destroyed = mesh('destroyed', material('destroyed'), geometry('destroyed'));
        destroyMesh(destroyed);
        expect(() => planner.build([destroyed])).toThrow('is destroyed');

        const invalidOrderMaterial = material('invalid-order');
        invalidOrderMaterial.renderOrder = Number.NaN;
        expect(() =>
            planner.build([mesh('invalid-order', invalidOrderMaterial, geometry('invalid-order'))])
        ).toThrow('renderOrder must be finite');

        const sparse = new Array<Mesh>(1);
        expect(() => planner.build(sparse)).toThrow('entry 0 must be a Mesh instance');
        expect(() => planner.build([{} as Mesh])).toThrow('must be a Mesh instance');
        expect(plan.opaqueMeshes).toEqual([valid]);
        expect(planner.hasOwner(valid)).toBe(true);
    });
});
