import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Camera from '../../../src/camera/Camera';
import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import Material from '../../../src/material/BasicMaterial';
import Vector3 from '../../../src/math/Vector3';
import {
    MeshDrawListPlanner,
    type MeshDrawListPlan
} from '../../../src/render/renderer/MeshDrawListPlanner';
import type { Renderer } from '../../../src/render/Renderer';

function material(id: string, renderOrder = 0, transparent = false): Material {
    const value = new Material({
        compositing: transparent ? { mode: 'alpha-blend', premultiplied: true } : { mode: 'opaque' }
    });
    Reflect.set(value, 'id', id);
    Reflect.set(value, 'testRenderOrder', renderOrder);
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
        new Mesh({
            material: meshMaterial,
            geometry: meshGeometry,
            useInstanced,
            renderOrder: Number(Reflect.get(meshMaterial, 'testRenderOrder') ?? 0)
        }),
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
    expect(plan.opaqueItems).toEqual([]);
    expect(plan.transparentItems).toEqual([]);
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
        expect(plan.opaqueItems).toEqual([opaqueEarly, plan.instancedBatches[0], opaqueLate]);
        expect(plan.transparentItems).toEqual([plan.instancedBatches[1], transparentDirect]);
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

    it.each(['perspective', 'orthographic', 'custom'] as const)(
        'sorts opaque origins by camera-view distance with %s cameras and either depth mode',
        kind => {
            const planner = new MeshDrawListPlanner();
            const sharedMaterial = material('depth-material');
            const sharedGeometry = geometry('depth-geometry');
            const near = mesh('z-near', sharedMaterial, sharedGeometry);
            const far = mesh('a-far', sharedMaterial, sharedGeometry);
            // The large lateral offset distinguishes view depth from radial camera distance.
            near.setPosition(4, 20, 0).updateMatrixWorld(true);
            far.setPosition(-5, 2, 0).updateMatrixWorld(true);
            const camera =
                kind === 'perspective'
                    ? new PerspectiveCamera()
                    : kind === 'orthographic'
                      ? new OrthographicCamera()
                      : new Camera();
            camera.setPosition(5, 2, 0).lookAt(new Vector3(4, 2, 0));

            for (const depthMode of ['standard', 'reversed'] as const) {
                camera.depthMode = depthMode;
                camera.updateViewProjectionMatrix();
                const plan = planner.build([far, near], null, true, camera);

                expect(plan.opaqueMeshes).toEqual([near, far]);
                expect(plan.opaqueItems).toEqual([near, far]);
            }

            camera.lookAt(new Vector3(6, 2, 0)).updateViewProjectionMatrix();
            expect(planner.build([near, far], null, true, camera).opaqueItems).toEqual([far, near]);
        }
    );

    it('preserves material and geometry groups, renderOrder priority, and stable depth ties', () => {
        const planner = new MeshDrawListPlanner();
        const materialA = material('a');
        const materialB = material('b');
        const geometryA = geometry('a');
        const geometryB = geometry('b');
        const first = mesh('z-first-order', materialB, geometryB);
        first.renderOrder = -1;
        const near = mesh('z-near', materialA, geometryA);
        const far = mesh('a-far', materialA, geometryA);
        const sameDepthA = mesh('a-tie', materialA, geometryA);
        const sameDepthB = mesh('b-tie', materialA, geometryA);
        const otherGeometry = mesh('a-geometry', materialA, geometryB);
        const otherMaterial = mesh('a-material', materialB, geometryA);
        first.setPosition(0, 0, -100).updateMatrixWorld(true);
        near.setPosition(0, 0, -2).updateMatrixWorld(true);
        far.setPosition(0, 0, -20).updateMatrixWorld(true);
        sameDepthA.setPosition(0, 0, -5).updateMatrixWorld(true);
        sameDepthB.setPosition(0, 0, -5).updateMatrixWorld(true);
        otherGeometry.setPosition(0, 0, -1).updateMatrixWorld(true);
        otherMaterial.setPosition(0, 0, -1).updateMatrixWorld(true);
        const camera = new PerspectiveCamera();
        camera.updateViewProjectionMatrix();
        const inputs = [otherMaterial, otherGeometry, far, sameDepthB, sameDepthA, near, first];
        const expected = [first, near, sameDepthA, sameDepthB, far, otherGeometry, otherMaterial];

        expect(planner.build(inputs, null, true, camera).opaqueItems).toEqual(expected);
        expect(planner.build(inputs.reverse(), null, true, camera).opaqueItems).toEqual(expected);

        near.setPosition(0, 0, -30).updateMatrixWorld(true);
        expect(planner.build(inputs, null, true, camera).opaqueItems).toEqual([
            first,
            sameDepthA,
            sameDepthB,
            far,
            near,
            otherGeometry,
            otherMaterial
        ]);
    });

    it('orders stable opaque instance batches and direct draws by their nearest member', () => {
        const planner = new MeshDrawListPlanner();
        const sharedMaterial = material('batched-depth');
        const sharedGeometry = geometry('batched-depth');
        const farInstances = Array.from({ length: 128 }, (_, index) => {
            const value = mesh(`far-${String(index)}`, sharedMaterial, sharedGeometry, true);
            value.setPosition(0, 0, -40 + index / 128).updateMatrixWorld(true);
            return value;
        });
        const nearA = mesh('near-a', sharedMaterial, sharedGeometry, true);
        const nearB = mesh('near-b', sharedMaterial, sharedGeometry, true);
        nearA.setPosition(0, 0, -6).updateMatrixWorld(true);
        nearB.setPosition(0, 0, -2).updateMatrixWorld(true);
        const middle = mesh('middle-direct', sharedMaterial, sharedGeometry);
        middle.setPosition(0, 0, -10).updateMatrixWorld(true);
        const input = [...farInstances, nearA, nearB, middle];
        const camera = new PerspectiveCamera();
        camera.updateViewProjectionMatrix();
        const plan = planner.build(input, null, true, camera);
        const nearBatch = plan.instancedBatches[0];
        const farBatch = plan.instancedBatches[1];
        const storage = planner.diagnostics().storageAllocationCount;

        expect(nearBatch?.meshes).toEqual([nearB, nearA]);
        expect(farBatch?.meshes).toEqual([...farInstances].reverse());
        expect(plan.opaqueItems).toEqual([nearBatch, middle, farBatch]);

        for (let iteration = 0; iteration < 4; iteration++) {
            nearA.setPosition(0, 0, -60 - iteration).updateMatrixWorld(true);
            nearB.setPosition(0, 0, -50 - iteration).updateMatrixWorld(true);
            planner.build(input, null, true, camera);
            expect(plan.opaqueItems).toEqual([middle, farBatch, nearBatch]);
            expect(plan.instancedBatches).toEqual([farBatch, nearBatch]);
            expect(nearBatch?.meshes).toEqual([nearB, nearA]);
            expect(planner.diagnostics().storageAllocationCount).toBe(storage);
        }
    });

    it('retains collection and batch-member order when sorting is disabled', () => {
        const planner = new MeshDrawListPlanner();
        const sharedMaterial = material('unsorted-depth');
        const sharedGeometry = geometry('unsorted-depth');
        const far = mesh('a-far', sharedMaterial, sharedGeometry);
        const near = mesh('z-near', sharedMaterial, sharedGeometry);
        const farInstance = mesh('a-far-instance', sharedMaterial, sharedGeometry, true);
        const nearInstance = mesh('z-near-instance', sharedMaterial, sharedGeometry, true);
        far.setPosition(0, 0, -10).updateMatrixWorld(true);
        near.setPosition(0, 0, -2).updateMatrixWorld(true);
        farInstance.setPosition(0, 0, -10).updateMatrixWorld(true);
        nearInstance.setPosition(0, 0, -2).updateMatrixWorld(true);
        const camera = new PerspectiveCamera();
        camera.updateViewProjectionMatrix();
        const inputs = [far, near, farInstance, nearInstance];
        planner.build(inputs, null, true, camera);

        const plan = planner.build(inputs, null, false, camera);

        expect(plan.opaqueMeshes).toEqual([far, near]);
        expect(plan.instancedBatches[0]?.meshes).toEqual([farInstance, nearInstance]);
        expect(plan.opaqueItems).toEqual([far, near, plan.instancedBatches[0]]);
    });

    it('applies opaque view-depth sorting after an effective material override', () => {
        const planner = new MeshDrawListPlanner();
        const source = material('transparent-source', 0, true);
        const forced = material('opaque-override');
        const sharedGeometry = geometry('override-depth');
        const near = mesh('z-near', source, sharedGeometry);
        const far = mesh('a-far', source, sharedGeometry);
        near.setPosition(0, 0, -2).updateMatrixWorld(true);
        far.setPosition(0, 0, -10).updateMatrixWorld(true);
        const camera = new PerspectiveCamera();
        camera.updateViewProjectionMatrix();

        const plan = planner.build([far, near], forced, true, camera);

        expect(plan.opaqueItems).toEqual([near, far]);
        expect(plan.transparentItems).toEqual([]);
    });

    it('retains sprite display and transparent back-to-front ordering alongside opaque depth sorting', () => {
        const planner = new MeshDrawListPlanner();
        const transparent = material('transparent', 0, true);
        const sharedGeometry = geometry('shared');
        const frontSprite = mesh('front-sprite', transparent, sharedGeometry, true);
        const backSprite = mesh('back-sprite', transparent, sharedGeometry, true);
        Reflect.set(frontSprite, 'isSprite', true);
        Reflect.set(backSprite, 'isSprite', true);
        frontSprite.zIndex = 2;
        backSprite.zIndex = -2;
        frontSprite.setPosition(0, 0, -100).updateMatrixWorld(true);
        backSprite.setPosition(0, 0, -1).updateMatrixWorld(true);
        const near = mesh('near-transparent', transparent, sharedGeometry);
        const far = mesh('far-transparent', transparent, sharedGeometry);
        near.setPosition(0, 0, -2).updateMatrixWorld(true);
        far.setPosition(0, 0, -10).updateMatrixWorld(true);
        const opaque = mesh('opaque', material('opaque'), sharedGeometry);
        const camera = new PerspectiveCamera();
        camera.updateViewProjectionMatrix();

        const plan = planner.build(
            [frontSprite, near, opaque, far, backSprite],
            null,
            true,
            camera
        );

        expect(plan.transparentItems).toEqual([
            plan.instancedBatches[0],
            far,
            near,
            plan.instancedBatches[1]
        ]);
        expect(plan.instancedBatches[0]?.meshes).toEqual([backSprite]);
        expect(plan.instancedBatches[1]?.meshes).toEqual([frontSprite]);
        expect(plan.opaqueItems).toEqual([opaque]);
    });

    it('sorts mixed queues without batching transparent instances across a direct draw', () => {
        const planner = new MeshDrawListPlanner();
        const transparent = material('transparent', 0, true);
        const sharedGeometry = geometry('mixed-adjacency');
        const farA = mesh('far-a', transparent, sharedGeometry, true);
        const farB = mesh('far-b', transparent, sharedGeometry, true);
        const near = mesh('near', transparent, sharedGeometry, true);
        const middle = mesh('middle', transparent, sharedGeometry);
        const opaque = mesh('opaque', material('opaque'), sharedGeometry);
        farA.setPosition(0, 0, -12).updateMatrixWorld(true);
        farB.setPosition(0, 0, -11).updateMatrixWorld(true);
        near.setPosition(0, 0, -2).updateMatrixWorld(true);
        middle.setPosition(0, 0, -7).updateMatrixWorld(true);
        const camera = new PerspectiveCamera();
        camera.updateViewProjectionMatrix();
        const inputs = [near, opaque, middle, farB, farA];
        const plan = planner.build(inputs, null, true, camera);

        expect(plan.instancedBatches.map(batch => batch.meshes)).toEqual([[farA, farB], [near]]);
        expect(plan.transparentItems).toEqual([
            plan.instancedBatches[0],
            middle,
            plan.instancedBatches[1]
        ]);
        expect(plan.opaqueItems).toEqual([opaque]);

        // Reused owner records must reflect this build's transforms rather than old depth keys.
        near.setPosition(0, 0, -20).updateMatrixWorld(true);
        farA.setPosition(0, 0, -3).updateMatrixWorld(true);
        farB.setPosition(0, 0, -2).updateMatrixWorld(true);
        planner.build(inputs, null, true, camera);
        expect(plan.instancedBatches.map(batch => batch.meshes)).toEqual([[near], [farA, farB]]);
        expect(plan.transparentItems).toEqual([
            plan.instancedBatches[0],
            middle,
            plan.instancedBatches[1]
        ]);

        planner.build(inputs, null, false, camera);
        expect(plan.instancedBatches.map(batch => batch.meshes)).toEqual([[near], [farB, farA]]);
        expect(plan.transparentItems).toEqual([
            middle,
            plan.instancedBatches[0],
            plan.instancedBatches[1]
        ]);
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
        const opaqueItems = first.opaqueItems;
        const transparentItems = first.transparentItems;
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
            expect(next.opaqueItems).toBe(opaqueItems);
            expect(next.transparentItems).toBe(transparentItems);
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

    it('preserves global transparent depth order across direct and adjacent instanced items', () => {
        const planner = new MeshDrawListPlanner();
        const shared = material('shared-transparent', 0, true);
        const sharedGeometry = geometry('shared-transparent');
        const farBatchA = mesh('far-batch-a', shared, sharedGeometry, true);
        const farBatchB = mesh('far-batch-b', shared, sharedGeometry, true);
        const middle = mesh(
            'middle-direct',
            material('middle-transparent', 0, true),
            geometry('middle-transparent')
        );
        const nearBatch = mesh('near-batch', shared, sharedGeometry, true);
        farBatchA.setPosition(0, 0, -12).updateMatrixWorld(true);
        farBatchB.setPosition(0, 0, -11).updateMatrixWorld(true);
        middle.setPosition(0, 0, -7).updateMatrixWorld(true);
        nearBatch.setPosition(0, 0, -3).updateMatrixWorld(true);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
        camera.setPosition(0, 0, 0).lookAt(new Vector3(0, 0, -1));
        camera.updateViewProjectionMatrix();

        const plan = planner.build([nearBatch, middle, farBatchB, farBatchA], null, true, camera);

        expect(plan.instancedBatches).toHaveLength(2);
        expect(plan.instancedBatches[0]?.meshes).toEqual([farBatchA, farBatchB]);
        expect(plan.instancedBatches[1]?.meshes).toEqual([nearBatch]);
        expect(plan.transparentItems).toEqual([
            plan.instancedBatches[0],
            middle,
            plan.instancedBatches[1]
        ]);
    });

    it('splits an opaque batch when one owner changes renderOrder', () => {
        const planner = new MeshDrawListPlanner();
        const shared = material('mutable-order');
        const sharedGeometry = geometry('mutable-order');
        const first = mesh('first', shared, sharedGeometry, true);
        const second = mesh('second', shared, sharedGeometry, true);
        const plan = planner.build([first, second]);
        expect(plan.instancedBatches).toHaveLength(1);

        second.renderOrder = 3;
        planner.build([first, second]);

        expect(plan.instancedBatches).toHaveLength(2);
        expect(plan.instancedBatches.map(batch => batch.renderOrder)).toEqual([0, 3]);
        expect(plan.opaqueItems).toEqual([plan.instancedBatches[0], plan.instancedBatches[1]]);
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
        let mutableMaterial = material('mutable', 2);
        const mutableMesh = mesh('mutable', mutableMaterial, geometry('mutable'));
        const fixedMesh = mesh('fixed', material('fixed', 0), geometry('fixed'));

        const plan = planner.build([mutableMesh, fixedMesh]);
        expect(plan.opaqueMeshes).toEqual([fixedMesh, mutableMesh]);

        mutableMesh.renderOrder = -1;
        planner.build([mutableMesh, fixedMesh]);
        expect(plan.opaqueMeshes).toEqual([mutableMesh, fixedMesh]);

        mutableMaterial = material('mutable-transparent', -1, true);
        mutableMesh.material = mutableMaterial;
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
            renderOrder: -1,
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
            renderOrder: 0,
            transparent: true,
            meshes: [instancedA, instancedB]
        });

        const opaqueForced = material('forced-opaque', -4);
        planner.build([direct, instancedA, instancedB], opaqueForced);
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

    it('keeps transparent sorting back-to-front with reversed camera depth', () => {
        const planner = new MeshDrawListPlanner();
        const transparent = material('transparent', 0, true);
        const sharedGeometry = geometry('reversed-depth');
        const near = mesh('near-reversed', transparent, sharedGeometry);
        const far = mesh('far-reversed', transparent, sharedGeometry);
        near.setPosition(0, 0, -2).updateMatrixWorld(true);
        far.setPosition(0, 0, -10).updateMatrixWorld(true);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
        camera.depthMode = 'reversed';
        camera.setPosition(0, 0, 0).lookAt(new Vector3(0, 0, -1));
        camera.updateViewProjectionMatrix();

        const plan = planner.build([near, far], null, true, camera);

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
        const invalidOrderMesh = mesh(
            'invalid-order',
            invalidOrderMaterial,
            geometry('invalid-order')
        );
        invalidOrderMesh.renderOrder = Number.NaN;
        expect(() => planner.build([invalidOrderMesh])).toThrow('renderOrder must be finite');

        const sparse = new Array<Mesh>(1);
        expect(() => planner.build(sparse)).toThrow('entry 0 must be a Mesh instance');
        expect(() => planner.build([{} as Mesh])).toThrow('must be a Mesh instance');
        expect(plan.opaqueMeshes).toEqual([valid]);
        expect(planner.hasOwner(valid)).toBe(true);
    });
});
