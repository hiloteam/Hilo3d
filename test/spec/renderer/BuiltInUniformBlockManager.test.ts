import { describe, expect, it, type MockInstance, vi } from 'vitest';
import BuiltInUniformBlockManager from '../../../src/renderer/BuiltInUniformBlockManager';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import type Program from '../../../src/renderer/Program';
import UniformBuffer from '../../../src/renderer/UniformBuffer';
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

    it('uses per-frame, per-material and per-transform update frequencies', () => {
        const manager = new BuiltInUniformBlockManager({ width: 320, height: 180 });
        const set = vi.spyOn(UniformBuffer.prototype, 'set');
        const getUniformData = vi.spyOn(testEnv.material, 'getUniformData');
        const sceneProgram = blockProgram('scene-program', 'SceneBlock', ['u_fogInfo']);
        const materialProgram = blockProgram('material-program', 'MaterialBlock', [
            'u_alphaCutoff'
        ]);
        const modelProgram = blockProgram('model-program', 'ModelBlock', ['u_modelMatrix']);
        testEnv.material.isDirty = false;
        manager.beginFrame(testEnv.camera);

        manager.bind(sceneProgram, testEnv.mesh, testEnv.material, false);
        manager.bind(sceneProgram, testEnv.mesh, testEnv.material, false);
        expect(getUniformData.mock.calls.filter(([name]) => name === 'u_fogInfo')).toHaveLength(1);

        manager.bind(materialProgram, testEnv.mesh, testEnv.material, false);
        manager.bind(materialProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_alphaCutoff')).toBe(1);
        testEnv.material.isDirty = true;
        manager.bind(materialProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_alphaCutoff')).toBe(2);
        testEnv.material.isDirty = false;

        manager.bind(modelProgram, testEnv.mesh, testEnv.material, false);
        manager.bind(modelProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_modelMatrix')).toBe(1);
        testEnv.mesh.worldMatrixVersion++;
        manager.bind(modelProgram, testEnv.mesh, testEnv.material, false);
        expect(fieldWriteCount(set, 'u_modelMatrix')).toBe(2);

        manager.beginFrame(testEnv.camera);
        manager.bind(sceneProgram, testEnv.mesh, testEnv.material, false);
        expect(getUniformData.mock.calls.filter(([name]) => name === 'u_fogInfo')).toHaveLength(2);
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
        const initialMaterialWrites = fieldWriteCount(set, 'u_alphaCutoff');
        const initialGeometryWrites = fieldWriteCount(set, 'u_positionDecodeMat');

        testEnv.material.isDirty = true;
        testEnv.geometry.isDirty = true;
        first.getUniformBlocks(blockNames, testEnv.mesh, testEnv.material);
        testEnv.material.isDirty = false;
        testEnv.geometry.isDirty = false;
        second.getUniformBlocks(blockNames, testEnv.mesh, testEnv.material);

        expect(fieldWriteCount(set, 'u_alphaCutoff') - initialMaterialWrites).toBe(2);
        expect(fieldWriteCount(set, 'u_positionDecodeMat') - initialGeometryWrites).toBe(2);
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
