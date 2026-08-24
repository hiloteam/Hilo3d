import { describe, expect, it } from 'vitest';
import {
    cameraBlockLayout,
    frameBlockLayout,
    geometryBlockLayout,
    instanceBlockLayout,
    lightBlockLayout,
    materialBlockLayout,
    materialTextureBlockLayout,
    modelBlockLayout,
    morphBlockLayout,
    paddedStd140Value,
    sceneBlockLayout,
    skinningBlockLayout
} from '../../../src/render/ubo/BuiltInUniformBlocks';

describe('built-in std140 ABI', () => {
    it('locks the canonical block byte sizes including the D0 history ABI', () => {
        expect({
            FrameBlock: frameBlockLayout.byteLength,
            CameraBlock: cameraBlockLayout.byteLength,
            SceneBlock: sceneBlockLayout.byteLength,
            LightBlock: lightBlockLayout.byteLength,
            MaterialBlock: materialBlockLayout.byteLength,
            MaterialTextureBlock: materialTextureBlockLayout.byteLength,
            ModelBlock: modelBlockLayout.byteLength,
            GeometryBlock: geometryBlockLayout.byteLength,
            SkinningBlock: skinningBlockLayout.byteLength,
            MorphBlock: morphBlockLayout.byteLength,
            InstanceBlock: instanceBlockLayout.byteLength
        }).toEqual({
            FrameBlock: 16,
            CameraBlock: 848,
            SceneBlock: 32,
            LightBlock: 16288,
            MaterialBlock: 448,
            MaterialTextureBlock: 1920,
            ModelBlock: 224,
            GeometryBlock: 224,
            SkinningBlock: 16400,
            MorphBlock: 80,
            InstanceBlock: 26624
        });
    });

    it('keeps frame, camera, material and model offsets stable', () => {
        expect(frameBlockLayout.fields.u_rendererSize.offset).toBe(0);
        expect(frameBlockLayout.fields.u_time.offset).toBe(8);
        expect(frameBlockLayout.fields.u_frameIndex.offset).toBe(12);

        expect(cameraBlockLayout.fields.u_previousViewMatrix.offset).toBe(192);
        expect(cameraBlockLayout.fields.u_previousProjectionMatrix.offset).toBe(256);
        expect(cameraBlockLayout.fields.u_previousViewProjectionMatrix.offset).toBe(320);
        expect(cameraBlockLayout.fields.u_viewInverseMatrix.offset).toBe(384);
        expect(cameraBlockLayout.fields.u_previousViewInverseMatrix.offset).toBe(448);
        expect(cameraBlockLayout.fields.u_projectionInverseMatrix.offset).toBe(512);
        expect(cameraBlockLayout.fields.u_viewInverseNormalMatrix.offset).toBe(576);
        expect(cameraBlockLayout.fields.u_cameraPositionNear.offset).toBe(624);
        expect(cameraBlockLayout.fields.u_cameraParams.offset).toBe(640);
        expect(cameraBlockLayout.fields.u_renderOrigin.offset).toBe(656);
        expect(cameraBlockLayout.fields.u_previousRenderOrigin.offset).toBe(672);
        expect(cameraBlockLayout.fields.u_historyParams.offset).toBe(688);
        expect(cameraBlockLayout.fields.u_viewport.offset).toBe(704);
        expect(cameraBlockLayout.fields.u_nonJitteredProjectionMatrix.offset).toBe(720);
        expect(cameraBlockLayout.fields.u_nonJitteredViewProjectionMatrix.offset).toBe(784);

        expect(materialBlockLayout.fields.u_diffuseEnvSphereHarmonics3.offset).toBe(96);
        expect(materialBlockLayout.fields.u_diffuseEnvSphereHarmonics3.arrayStride).toBe(16);
        expect(materialBlockLayout.fields.u_specularEnvMatrix.offset).toBe(240);
        expect(materialBlockLayout.fields.u_normalMapScale.offset).toBe(304);
        expect(materialBlockLayout.fields.u_clearcoatNormalScale.offset).toBe(368);
        expect(materialBlockLayout.fields.u_transmissionFactor.offset).toBe(380);
        expect(materialBlockLayout.fields.u_ior.offset).toBe(392);
        expect(materialBlockLayout.fields.u_iridescenceFactor.offset).toBe(396);
        expect(materialBlockLayout.fields.u_iridescenceThicknessMaximum.offset).toBe(408);
        expect(materialBlockLayout.fields.u_attenuationColor.offset).toBe(416);
        expect(materialBlockLayout.fields.u_temporalReactiveFactor.offset).toBe(432);

        expect(materialTextureBlockLayout.fields.u_materialTextureTransforms.offset).toBe(0);
        expect(materialTextureBlockLayout.fields.u_materialTextureTransforms.arrayStride).toBe(48);
        expect(materialTextureBlockLayout.fields.u_materialTextureInfo.offset).toBe(1152);
        expect(materialTextureBlockLayout.fields.u_materialTextureChannels.offset).toBe(1536);

        expect(modelBlockLayout.fields.u_modelMatrix.offset).toBe(0);
        expect(modelBlockLayout.fields.u_previousModelMatrix.offset).toBe(64);
        expect(modelBlockLayout.fields.u_normalWorldMatrix.offset).toBe(128);
        expect(modelBlockLayout.fields.u_objectIdColor.offset).toBe(176);
        expect(modelBlockLayout.fields.u_modelHistoryParams.offset).toBe(192);
        expect(modelBlockLayout.fields.u_modelLayerParams.offset).toBe(208);
        expect(geometryBlockLayout.fields.u_positionDecodeMat.offset).toBe(0);
        expect(geometryBlockLayout.fields.u_uvDecodeMat.offset).toBe(128);
        expect(geometryBlockLayout.fields.u_uv1DecodeMat.offset).toBe(176);
    });

    it('keeps fixed-capacity light and animation array strides stable', () => {
        expect(lightBlockLayout.fields.u_directionalLightsColor.offset).toBe(16);
        expect(lightBlockLayout.fields.u_directionalLightsColor.arrayStride).toBe(16);
        expect(lightBlockLayout.fields.u_directionalLightSpaceMatrix.offset).toBe(528);
        expect(lightBlockLayout.fields.u_directionalLightSpaceMatrix.arrayStride).toBe(64);
        expect(lightBlockLayout.fields.u_directionalCascadeSplits.offset).toBe(1040);
        expect(lightBlockLayout.fields.u_directionalCascadeParams.offset).toBe(1168);
        expect(lightBlockLayout.fields.u_directionalCascadeMatrices.offset).toBe(1296);
        expect(lightBlockLayout.fields.u_spotLightSpaceMatrix.offset).toBe(4368);
        expect(lightBlockLayout.fields.u_pointLightSpaceMatrix.offset).toBe(6160);
        expect(lightBlockLayout.fields.u_shadowAtlasSize.offset).toBe(7440);
        expect(lightBlockLayout.fields.u_shadowAtlasRects.offset).toBe(7456);
        expect(lightBlockLayout.fields.u_pointShadowMatrices.offset).toBe(9632);
        expect(lightBlockLayout.fields.u_areaLightsHeight.offset).toBe(16160);

        expect(skinningBlockLayout.fields.u_jointMat.arrayStride).toBe(64);
        expect(skinningBlockLayout.fields.u_previousJointMat.offset).toBe(8192);
        expect(skinningBlockLayout.fields.u_skinHistoryParams.offset).toBe(16384);
        expect(morphBlockLayout.fields.u_morphWeights1.offset).toBe(16);
        expect(morphBlockLayout.fields.u_previousMorphWeights0.offset).toBe(32);
        expect(morphBlockLayout.fields.u_previousMorphWeights1.offset).toBe(48);
        expect(morphBlockLayout.fields.u_morphHistoryParams.offset).toBe(64);
        expect(instanceBlockLayout.fields.u_previousInstanceModelMatrices.offset).toBe(8192);
        expect(instanceBlockLayout.fields.u_instanceNormalMatrices.offset).toBe(16384);
        expect(instanceBlockLayout.fields.u_instanceHistoryParams.offset).toBe(24576);
    });

    it('pads dynamic semantic arrays to the fixed ABI capacity and rejects overflow', () => {
        const padded = paddedStd140Value(lightBlockLayout, 'u_directionalLightsColor', [1, 2, 3]);
        expect(padded).toBeInstanceOf(Float32Array);
        expect(Array.from(padded as Float32Array).slice(0, 6)).toEqual([1, 2, 3, 0, 0, 0]);
        expect(() =>
            paddedStd140Value(lightBlockLayout, 'u_directionalLightsColor', new Float32Array(25))
        ).toThrow(/fixed graphics ABI/);
    });

    it('reuses exact-size numeric views while packing frequently checked material fields', () => {
        const color = new Float32Array([0.25, 0.5, 0.75, 1]);

        expect(paddedStd140Value(materialBlockLayout, 'u_diffuseColor', color)).toBe(color);
    });
});
