import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import AmbientLight from '../../../src/light/AmbientLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import BuiltInUniformBlockManager from '../../../src/renderer/BuiltInUniformBlockManager';
import Color from '../../../src/math/Color';
import CubeTexture from '../../../src/texture/CubeTexture';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import Matrix3 from '../../../src/math/Matrix3';
import Matrix4 from '../../../src/math/Matrix4';
import PBRMaterial from '../../../src/material/PBRMaterial';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import type Program from '../../../src/renderer/Program';
import UniformBuffer from '../../../src/renderer/UniformBuffer';
import Vector3 from '../../../src/math/Vector3';
import semantic from '../../../src/material/semantic';
import { cameraBlockLayout } from '../../../src/renderer/ubo/BuiltInUniformBlocks';
import { testEnv } from '../../setup';

function blockProgram(id: string, blockName: string, uniformNames: readonly string[]): Program {
    return {
        id,
        uniformBlocks: {
            [blockName]: {
                name: blockName,
                blockIndex: 0,
                bindingPoint: 0,
                byteLength: 0,
                activeUniformIndices: [],
                uniformNames
            }
        },
        setUniformBlock: vi.fn()
    } as unknown as Program;
}

function fieldWriteCount(spy: MockInstance<UniformBuffer['set']>, fieldName: string): number {
    return spy.mock.calls.filter(([name]) => name === fieldName).length;
}

function readFloatField(buffer: UniformBuffer, fieldName: string, count: number): number[] {
    const field = buffer.layout.fields[fieldName];
    if (!field) throw new Error(`Uniform block does not contain ${fieldName}.`);
    const view = new DataView(buffer.data);
    return Array.from({ length: count }, (_, index) =>
        view.getFloat32(field.offset + index * Float32Array.BYTES_PER_ELEMENT, true)
    );
}

function readMatrix3Field(buffer: UniformBuffer, fieldName: string): number[] {
    const field = buffer.layout.fields[fieldName];
    if (!field || field.matrixStride === 0) {
        throw new Error(`Uniform block does not contain matrix field ${fieldName}.`);
    }
    const view = new DataView(buffer.data);
    return Array.from({ length: 3 }, (_columnValue, column) =>
        Array.from({ length: 3 }, (_rowValue, row) =>
            view.getFloat32(field.offset + column * field.matrixStride + row * 4, true)
        )
    ).flat();
}

afterEach(() => {
    semantic.init(testEnv.renderer, testEnv.camera, testEnv.renderer.lightManager, testEnv.fog);
});

describe('BuiltInUniformBlockManager', () => {
    it('updates frame globals once per frame and only resolves blocks requested by a program', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const set = vi.spyOn(UniformBuffer.prototype, 'set');
        const frameProgram = blockProgram('frame-program', 'FrameBlock', ['u_rendererSize']);

        manager.beginFrame(testEnv.camera);
        expect(fieldWriteCount(set, 'u_frameIndex')).toBe(1);
        manager.bind(frameProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_modelMatrix')).toBe(0);
        expect(fieldWriteCount(set, 'u_alphaCutoff')).toBe(0);

        manager.beginFrame(testEnv.camera);
        expect(fieldWriteCount(set, 'u_frameIndex')).toBe(2);
        manager.destroy();
    });

    it('publishes the physical viewport through the pass-frequency CameraBlock', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        manager.beginFrame(testEnv.camera, [7, 11, 160, 90]);
        const cameraBlock = manager.getUniformBlocks(
            ['CameraBlock'],
            testEnv.mesh,
            testEnv.material,
            testEnv.camera
        )['CameraBlock'];
        if (!cameraBlock) throw new Error('CameraBlock was not resolved.');

        expect(readFloatField(cameraBlock, 'u_viewport', 4)).toEqualishValues(7, 11, 160, 90);
        const firstRevision = cameraBlock.revision;

        manager.beginPass(testEnv.camera, [0, 0, 37, 23]);
        expect(readFloatField(cameraBlock, 'u_viewport', 4)).toEqualishValues(0, 0, 37, 23);
        const viewportField = cameraBlockLayout.fields.u_viewport;
        expect(cameraBlock.getDirtyRangesSince(firstRevision)?.at(-1)).toMatchObject({
            byteOffset: viewportField.offset,
            byteLength: viewportField.byteLength
        });

        semantic.setViewport([3, 5, 41, 29]);
        expect(semantic.VIEWPORT.get()).toEqualishValues(3, 5, 41, 29);
        manager.destroy();
    });

    it('uses per-frame, per-material and per-transform update frequencies', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const set = vi.spyOn(UniformBuffer.prototype, 'set');
        const sceneProgram = blockProgram('scene-program', 'SceneBlock', ['u_fogInfo']);
        const materialProgram = blockProgram('material-program', 'MaterialBlock', [
            'u_alphaCutoff'
        ]);
        const modelProgram = blockProgram('model-program', 'ModelBlock', ['u_modelMatrix']);
        testEnv.material.isDirty = false;
        manager.beginFrame(testEnv.camera);

        manager.bind(sceneProgram, testEnv.mesh, testEnv.material, false);
        manager.bind(sceneProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_fogInfo')).toBe(1);

        manager.bind(materialProgram, testEnv.mesh, testEnv.material, false);
        const materialBlock = manager.getUniformBlocks(
            ['MaterialBlock'],
            testEnv.mesh,
            testEnv.material
        )['MaterialBlock'];
        if (!materialBlock) throw new Error('MaterialBlock was not resolved.');
        const stableMaterialRevision = materialBlock.revision;
        manager.bind(materialProgram, testEnv.mesh, testEnv.material, false);
        expect(materialBlock.revision).toBe(stableMaterialRevision);
        const previousAlphaCutoff = testEnv.material.alphaCutoff;
        testEnv.material.alphaCutoff = 0.375;
        manager.bind(materialProgram, testEnv.mesh, testEnv.material, false);
        expect(materialBlock.revision).toBe(stableMaterialRevision + 1);
        expect(readFloatField(materialBlock, 'u_alphaCutoff', 1)).toEqualishValues(0.375);
        testEnv.material.alphaCutoff = previousAlphaCutoff;

        manager.bind(modelProgram, testEnv.mesh, testEnv.material, false);
        manager.bind(modelProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_modelMatrix')).toBe(1);
        testEnv.mesh.worldMatrixVersion++;
        manager.bind(modelProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_modelMatrix')).toBe(2);

        manager.beginFrame(testEnv.camera);
        manager.bind(sceneProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_fogInfo')).toBe(2);
        manager.destroy();
    });

    it('writes six distinct CameraBlock snapshots when a cube pass reuses one camera', () => {
        const manager = new BuiltInUniformBlockManager({ width: 32, height: 32 });
        const camera = new PerspectiveCamera({ fov: 90, aspect: 1, near: 0.1, far: 100 });
        const target = new Vector3();
        const directions = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1] as const;
        const upDirections = [0, -1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, -1, 0, 0, -1, 0] as const;
        const snapshots: {
            readonly bytes: Uint8Array;
            readonly view: number[];
            readonly projection: number[];
            readonly viewProjection: number[];
            readonly expectedView: number[];
            readonly expectedProjection: number[];
            readonly expectedViewProjection: number[];
        }[] = [];
        manager.beginFrame(camera);

        for (let face = 0; face < 6; face++) {
            target.fromArray(directions, face * 3).add(camera.position);
            camera.up.fromArray(upDirections, face * 3);
            camera.lookAt(target);
            camera.updateViewProjectionMatrix();
            manager.beginPass(camera);
            const block = manager.getUniformBlocks(
                ['CameraBlock'],
                testEnv.mesh,
                testEnv.material,
                camera
            )['CameraBlock'];
            if (!block) throw new TypeError('CameraBlock must be available.');
            snapshots.push({
                bytes: new Uint8Array(block.data.slice(0)),
                view: readFloatField(block, 'u_viewMatrix', 16),
                projection: readFloatField(block, 'u_projectionMatrix', 16),
                viewProjection: readFloatField(block, 'u_viewProjectionMatrix', 16),
                expectedView: Array.from(camera.viewMatrix.elements),
                expectedProjection: Array.from(camera.projectionMatrix.elements),
                expectedViewProjection: Array.from(camera.viewProjectionMatrix.elements)
            });
        }

        expect(snapshots).toHaveLength(6);
        snapshots.forEach(snapshot => {
            expect(snapshot.view).toEqualishValues(...snapshot.expectedView);
            expect(snapshot.projection).toEqualishValues(...snapshot.expectedProjection);
            expect(snapshot.viewProjection).toEqualishValues(...snapshot.expectedViewProjection);
        });
        const floatSignature = (values: ArrayLike<number>): string =>
            Array.from(values, value => value.toFixed(6)).join(',');
        const byteSignature = (values: Uint8Array): string => values.join(',');
        expect(new Set(snapshots.map(snapshot => byteSignature(snapshot.bytes))).size).toBe(6);
        expect(new Set(snapshots.map(snapshot => floatSignature(snapshot.view))).size).toBe(6);
        expect(
            new Set(snapshots.map(snapshot => floatSignature(snapshot.viewProjection))).size
        ).toBe(6);
        expect(new Set(snapshots.map(snapshot => floatSignature(snapshot.projection))).size).toBe(
            1
        );
        manager.destroy();
    });

    it('tracks scalar, color, in-place matrix and texture-derived MaterialBlock changes', () => {
        const first = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const second = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const environmentMap = new CubeTexture({ width: 4, height: 4 });
        const diffuse = new Color(0.2, 0.3, 0.4, 1);
        const uvMatrix = new Matrix3();
        const environmentMatrix = new Matrix4();
        const material = new BasicMaterial({
            diffuse,
            exposure: 2,
            transparency: 1,
            uvMatrix,
            specularEnvMap: environmentMap,
            specularEnvMatrix: environmentMatrix
        });
        const mesh = testEnv.mesh.clone();
        mesh.material = material;
        first.beginFrame(testEnv.camera);
        second.beginFrame(testEnv.camera);

        const firstBlock = first.getUniformBlocks(['MaterialBlock'], mesh, material)[
            'MaterialBlock'
        ];
        const secondBlock = second.getUniformBlocks(['MaterialBlock'], mesh, material)[
            'MaterialBlock'
        ];
        if (!firstBlock || !secondBlock) throw new Error('MaterialBlock was not resolved.');
        const firstInitialRevision = firstBlock.revision;
        const secondInitialRevision = secondBlock.revision;

        first.getUniformBlocks(['MaterialBlock'], mesh, material);
        second.getUniformBlocks(['MaterialBlock'], mesh, material);
        expect(firstBlock.revision).toBe(firstInitialRevision);
        expect(secondBlock.revision).toBe(secondInitialRevision);

        material.exposure = 10;
        first.getUniformBlocks(['MaterialBlock'], mesh, material);
        second.getUniformBlocks(['MaterialBlock'], mesh, material);
        expect(readFloatField(firstBlock, 'u_exposure', 1)).toEqualishValues(10);
        expect(readFloatField(secondBlock, 'u_exposure', 1)).toEqualishValues(10);
        expect(firstBlock.revision).toBe(firstInitialRevision + 1);
        expect(secondBlock.revision).toBe(secondInitialRevision + 1);

        uvMatrix.set(0.5, 0, 0, 0, 0.25, 0, 0.125, 0.75, 1);
        first.getUniformBlocks(['MaterialBlock'], mesh, material);
        second.getUniformBlocks(['MaterialBlock'], mesh, material);
        expect(readMatrix3Field(firstBlock, 'u_uvMatrix')).toEqualishValues(
            0.5,
            0,
            0,
            0,
            0.25,
            0,
            0.125,
            0.75,
            1
        );
        expect(readMatrix3Field(secondBlock, 'u_uvMatrix')).toEqualishValues(
            0.5,
            0,
            0,
            0,
            0.25,
            0,
            0.125,
            0.75,
            1
        );

        material.transparency = 0.5;
        diffuse.set(0.8, 0.1, 0.6, 0.4);
        environmentMatrix.set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
        first.getUniformBlocks(['MaterialBlock'], mesh, material);
        second.getUniformBlocks(['MaterialBlock'], mesh, material);
        expect(readFloatField(firstBlock, 'u_transparencyFactor', 1)).toEqualishValues(0.5);
        expect(readFloatField(firstBlock, 'u_diffuseColor', 4)).toEqualishValues(
            0.8,
            0.1,
            0.6,
            0.4
        );
        expect(readFloatField(firstBlock, 'u_specularEnvMatrix', 16)).toEqualishValues(
            ...environmentMatrix.elements
        );
        expect(readFloatField(secondBlock, 'u_specularEnvMatrix', 16)).toEqualishValues(
            ...environmentMatrix.elements
        );

        const firstStableRevision = firstBlock.revision;
        const secondStableRevision = secondBlock.revision;
        first.getUniformBlocks(['MaterialBlock'], mesh, material);
        second.getUniformBlocks(['MaterialBlock'], mesh, material);
        expect(firstBlock.revision).toBe(firstStableRevision);
        expect(secondBlock.revision).toBe(secondStableRevision);
        first.destroy();
        second.destroy();
    });

    it('refreshes texture-derived MaterialBlock values without a material dirty flag', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const environmentMap = new CubeTexture({ width: 4, height: 4 });
        const material = new PBRMaterial({ specularEnvMap: environmentMap });
        const mesh = testEnv.mesh.clone();
        mesh.material = material;
        manager.beginFrame(testEnv.camera);
        const block = manager.getUniformBlocks(['MaterialBlock'], mesh, material)['MaterialBlock'];
        if (!block) throw new Error('MaterialBlock was not resolved.');
        expect(readFloatField(block, 'u_specularEnvMapMipCount', 1)).toEqualishValues(3);
        const initialRevision = block.revision;

        environmentMap.width = 16;
        environmentMap.height = 16;
        manager.getUniformBlocks(['MaterialBlock'], mesh, material);
        expect(readFloatField(block, 'u_specularEnvMapMipCount', 1)).toEqualishValues(5);
        expect(block.revision).toBe(initialRevision + 1);
        manager.getUniformBlocks(['MaterialBlock'], mesh, material);
        expect(block.revision).toBe(initialRevision + 1);
        manager.destroy();
    });

    it('packs the current world transform into ModelBlock and refreshes it after rotation', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const mesh = testEnv.mesh.clone();
        mesh.setPosition(0.5, -0.25, 1).setRotation(22, 35, -8);
        mesh.updateMatrixWorld(true);
        manager.beginFrame(testEnv.camera);

        const first = manager.getUniformBlocks(['ModelBlock'], mesh, testEnv.material)[
            'ModelBlock'
        ];
        if (!first) throw new Error('ModelBlock was not resolved.');
        expect(readFloatField(first, 'u_modelMatrix', 16)).toEqualishValues(
            ...mesh.worldMatrix.elements
        );

        mesh.setRotation(-10, 70, 5);
        mesh.updateMatrixWorld(true);
        const second = manager.getUniformBlocks(['ModelBlock'], mesh, testEnv.material)[
            'ModelBlock'
        ];
        if (!second) throw new Error('ModelBlock was not refreshed.');
        expect(second).toBe(first);
        expect(readFloatField(second, 'u_modelMatrix', 16)).toEqualishValues(
            ...mesh.worldMatrix.elements
        );
        manager.destroy();
    });

    it('packs ambient and directional lighting into LightBlock for every render pass', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const lightManager = new LightManager();
        const ambient = new AmbientLight({
            color: new Color(0.2, 0.4, 0.6),
            amount: 0.5
        });
        const directional = new DirectionalLight({
            color: new Color(0.5, 0.25, 1),
            amount: 2,
            direction: new Vector3(-1, -0.8, -0.5)
        });
        lightManager.addLight(ambient).addLight(directional).updateInfo(testEnv.camera);
        semantic.init(testEnv.renderer, testEnv.camera, lightManager, null);
        manager.beginFrame(testEnv.camera);
        const customFirstDrawMaterial = testEnv.material.clone();
        customFirstDrawMaterial.uniforms = {};

        const first = manager.getUniformBlocks(
            ['LightBlock'],
            testEnv.mesh,
            customFirstDrawMaterial
        )['LightBlock'];
        if (!first) throw new Error('LightBlock was not resolved.');
        expect(readFloatField(first, 'u_ambientLightsColor', 3)).toEqualishValues(0.1, 0.2, 0.3);
        expect(readFloatField(first, 'u_directionalLightsColor', 3)).toEqualishValues(1, 0.5, 2);
        expect(readFloatField(first, 'u_directionalLightsInfo', 3)).toEqualishValues(
            ...(lightManager.directionalInfo?.infos ?? [])
        );

        directional.amount = 0.5;
        lightManager.updateInfo(testEnv.camera);
        manager.beginPass(testEnv.camera);
        const second = manager.getUniformBlocks(
            ['LightBlock'],
            testEnv.mesh,
            customFirstDrawMaterial
        )['LightBlock'];
        if (!second) throw new Error('LightBlock was not refreshed.');
        expect(second).toBe(first);
        expect(readFloatField(second, 'u_directionalLightsColor', 3)).toEqualishValues(
            0.25,
            0.125,
            0.5
        );
        manager.destroy();
    });

    it('writes a stable picking identity into every per-mesh ModelBlock', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const set = vi.spyOn(UniformBuffer.prototype, 'set');
        const materialWithoutBasicBindings = testEnv.material.clone();
        materialWithoutBasicBindings.uniforms = {};
        const modelProgram = blockProgram('picking-model', 'ModelBlock', ['u_objectIdColor']);
        manager.beginFrame(testEnv.camera);

        manager.bind(modelProgram, testEnv.mesh, materialWithoutBasicBindings, false);
        manager.bind(modelProgram, testEnv.mesh, materialWithoutBasicBindings, false);

        const writes = set.mock.calls.filter(([name]) => name === 'u_objectIdColor');
        expect(writes).toHaveLength(1);
        expect(writes[0]?.[1]).toBeInstanceOf(Float32Array);
        manager.destroy();
    });

    it('owns and destroys allocations created by object and geometry caches', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        manager.beginFrame(testEnv.camera);
        testEnv.geometry.isDirty = false;
        manager.bind(
            blockProgram('model-lifecycle', 'ModelBlock', ['u_modelMatrix']),
            testEnv.mesh,
            testEnv.material,
            false
        );
        manager.bind(
            blockProgram('geometry-lifecycle', 'GeometryBlock', ['u_positionDecodeMat']),
            testEnv.mesh,
            testEnv.material,
            false
        );
        const destroy = vi.spyOn(UniformBuffer.prototype, 'destroy');

        manager.destroy(testEnv.gl);
        expect(destroy).toHaveBeenCalledTimes(6);
    });

    it('updates skinning and morph animation data at most once per mesh per frame', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const morphData = vi.spyOn(testEnv.material, 'getUniformData');
        const skinnedMesh = new SkinnedMesh({
            geometry: testEnv.geometry,
            material: testEnv.material
        });
        const jointData = vi
            .spyOn(skinnedMesh, 'getJointMat')
            .mockReturnValue(new Float32Array(16));
        const morphProgram = blockProgram('morph-frequency', 'MorphBlock', [
            'u_morphWeights0',
            'u_morphWeights1'
        ]);
        const skinningProgram = blockProgram('skinning-frequency', 'SkinningBlock', ['u_jointMat']);
        manager.beginFrame(testEnv.camera);

        manager.bind(morphProgram, testEnv.mesh, testEnv.material, false);
        manager.bind(morphProgram, testEnv.mesh, testEnv.material, false);
        manager.bind(skinningProgram, skinnedMesh, testEnv.material, false);
        manager.bind(skinningProgram, skinnedMesh, testEnv.material, false);
        expect(morphData.mock.calls.filter(([name]) => name === 'u_morphWeights')).toHaveLength(1);
        expect(jointData).toHaveBeenCalledOnce();

        manager.beginFrame(testEnv.camera);
        manager.bind(morphProgram, testEnv.mesh, testEnv.material, false);
        manager.bind(skinningProgram, skinnedMesh, testEnv.material, false);
        expect(morphData.mock.calls.filter(([name]) => name === 'u_morphWeights')).toHaveLength(2);
        expect(jointData).toHaveBeenCalledTimes(2);
        manager.destroy();
    });

    it('observes material and geometry revisions independently across backend managers', () => {
        const first = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const second = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const set = vi.spyOn(UniformBuffer.prototype, 'set');
        const previousDecodeMatrix = testEnv.geometry.positionDecodeMat;
        testEnv.geometry.positionDecodeMat = new Float32Array([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
        ]);
        first.beginFrame(testEnv.camera);
        second.beginFrame(testEnv.camera);
        const blockNames = ['MaterialBlock', 'GeometryBlock'];
        first.getUniformBlocks(blockNames, testEnv.mesh, testEnv.material);
        second.getUniformBlocks(blockNames, testEnv.mesh, testEnv.material);
        const firstMaterialBlock = first.getUniformBlocks(
            ['MaterialBlock'],
            testEnv.mesh,
            testEnv.material
        )['MaterialBlock'];
        const secondMaterialBlock = second.getUniformBlocks(
            ['MaterialBlock'],
            testEnv.mesh,
            testEnv.material
        )['MaterialBlock'];
        if (!firstMaterialBlock || !secondMaterialBlock) {
            throw new Error('MaterialBlock was not resolved.');
        }
        const firstMaterialRevision = firstMaterialBlock.revision;
        const secondMaterialRevision = secondMaterialBlock.revision;
        const initialGeometryWrites = fieldWriteCount(set, 'u_positionDecodeMat');

        const previousAlphaCutoff = testEnv.material.alphaCutoff;
        testEnv.material.alphaCutoff = 0.625;
        testEnv.geometry.isDirty = true;
        first.getUniformBlocks(blockNames, testEnv.mesh, testEnv.material);
        testEnv.geometry.isDirty = false;
        second.getUniformBlocks(blockNames, testEnv.mesh, testEnv.material);

        expect(firstMaterialBlock.revision).toBe(firstMaterialRevision + 1);
        expect(secondMaterialBlock.revision).toBe(secondMaterialRevision + 1);
        expect(readFloatField(firstMaterialBlock, 'u_alphaCutoff', 1)).toEqualishValues(0.625);
        expect(readFloatField(secondMaterialBlock, 'u_alphaCutoff', 1)).toEqualishValues(0.625);
        expect(fieldWriteCount(set, 'u_positionDecodeMat') - initialGeometryWrites).toBe(2);
        testEnv.material.alphaCutoff = previousAlphaCutoff;
        testEnv.geometry.positionDecodeMat = previousDecodeMatrix;
        first.destroy();
        second.destroy();
    });

    it('releases owner-frequency logical buffers and rebuilds them on demand', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const skinnedMesh = new SkinnedMesh({
            geometry: testEnv.geometry,
            material: testEnv.material
        });
        vi.spyOn(skinnedMesh, 'getJointMat').mockReturnValue(new Float32Array(16));
        manager.beginFrame(testEnv.camera);
        const blocks = manager.getUniformBlocks(
            ['MaterialBlock', 'ModelBlock', 'GeometryBlock', 'MorphBlock'],
            testEnv.mesh,
            testEnv.material
        );
        const skinning = manager.getUniformBlocks(['SkinningBlock'], skinnedMesh, testEnv.material)[
            'SkinningBlock'
        ];
        const destroy = vi.spyOn(UniformBuffer.prototype, 'destroy');

        expect(manager.releaseOwner(testEnv.material, testEnv.gl)).toBe(1);
        expect(manager.releaseOwner(testEnv.geometry, testEnv.gl)).toBe(1);
        expect(manager.releaseOwner(testEnv.mesh, testEnv.gl)).toBe(2);
        expect(manager.releaseOwner(skinnedMesh, testEnv.gl)).toBe(1);
        expect(destroy).toHaveBeenCalledTimes(5);
        const releasedModelBlock = blocks['ModelBlock'];
        if (!releasedModelBlock) throw new Error('ModelBlock was not resolved');
        expect(manager.releaseBuffer(releasedModelBlock, testEnv.gl)).toBe(false);

        const rebuilt = manager.getUniformBlocks(
            ['MaterialBlock', 'ModelBlock', 'GeometryBlock', 'MorphBlock'],
            testEnv.mesh,
            testEnv.material
        );
        expect(rebuilt['MaterialBlock']).not.toBe(blocks['MaterialBlock']);
        expect(rebuilt['ModelBlock']).not.toBe(blocks['ModelBlock']);
        expect(rebuilt['GeometryBlock']).not.toBe(blocks['GeometryBlock']);
        expect(rebuilt['MorphBlock']).not.toBe(blocks['MorphBlock']);
        expect(skinning).toBeInstanceOf(UniformBuffer);
        manager.destroy();
    });
});
