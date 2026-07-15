import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import type Mesh from '../../../src/core/Mesh';
import LightManager from '../../../src/light/LightManager';
import Material, { type SemanticProgramBindingInfo } from '../../../src/material/Material';
import semantic from '../../../src/material/semantic';
import { createSemanticFrameState } from '../../../src/render/frame/SemanticFrameState';
import { describe, expect, it } from 'vitest';

function renderer(width: number, height: number) {
    return {
        width,
        height,
        getViewport: () => [0, 0, width, height] as const
    };
}

describe('explicit semantic frame state', () => {
    it('keeps interleaved camera and viewport resolution independent of legacy active state', () => {
        const firstCamera = new PerspectiveCamera();
        firstCamera.worldMatrix.elements[12] = 3;
        const secondCamera = new PerspectiveCamera();
        secondCamera.worldMatrix.elements[12] = 9;
        const firstLightManager = new LightManager();
        firstLightManager.shadowAtlasSize = new Float32Array([64, 32, 1 / 64, 1 / 32]);
        firstLightManager.shadowAtlasRects = new Float32Array([1, 2, 3, 4]);
        firstLightManager.pointShadowMatrices = new Float32Array([5, 6]);
        const secondLightManager = new LightManager();
        secondLightManager.shadowAtlasSize = new Float32Array([20, 10, 1 / 20, 1 / 10]);
        secondLightManager.shadowAtlasRects = new Float32Array([7, 8, 9, 10]);
        secondLightManager.pointShadowMatrices = new Float32Array([11, 12]);
        const firstRenderer = renderer(64, 32);
        const secondRenderer = renderer(20, 10);
        const first = createSemanticFrameState({
            renderer: firstRenderer,
            camera: firstCamera,
            lightManager: firstLightManager,
            fog: null,
            viewport: [1, 2, 60, 28]
        });
        const second = createSemanticFrameState({
            renderer: secondRenderer,
            camera: secondCamera,
            lightManager: secondLightManager,
            fog: null,
            viewport: [4, 5, 12, 6]
        });
        const firstBinding: SemanticProgramBindingInfo = { semanticFrame: first };
        const secondBinding: SemanticProgramBindingInfo = { semanticFrame: second };
        const material = new Material({
            needBasicAttributes: false,
            needBasicUniforms: false,
            uniforms: {
                cameraPosition: 'CAMERAPOSITION',
                viewport: 'VIEWPORT',
                rendererSize: 'RENDERERSIZE',
                shadowAtlasSize: 'SHADOWATLASSIZE',
                shadowAtlasRects: 'SHADOWATLASRECTS',
                pointShadowMatrices: 'POINTSHADOWMATRICES'
            }
        });
        const mesh = {} as Mesh;

        semantic.init(firstRenderer, secondCamera, secondLightManager, null);
        semantic.setViewport([0, 0, 2, 2]);

        expect([
            ...(material.getUniformData('cameraPosition', mesh, firstBinding) as Float32Array)
        ]).toEqual([3, 0, 0]);
        expect([
            ...(material.getUniformData('cameraPosition', mesh, secondBinding) as Float32Array)
        ]).toEqual([9, 0, 0]);
        expect([
            ...(material.getUniformData('viewport', mesh, firstBinding) as Float32Array)
        ]).toEqual([1, 2, 60, 28]);
        expect([
            ...(material.getUniformData('viewport', mesh, secondBinding) as Float32Array)
        ]).toEqual([4, 5, 12, 6]);
        expect([
            ...(material.getUniformData('rendererSize', mesh, firstBinding) as Float32Array)
        ]).toEqual([64, 32]);
        expect([
            ...(material.getUniformData('rendererSize', mesh, secondBinding) as Float32Array)
        ]).toEqual([20, 10]);
        expect([
            ...(material.getUniformData('shadowAtlasSize', mesh, firstBinding) as Float32Array)
        ]).toEqual([64, 32, 1 / 64, 1 / 32]);
        expect([
            ...(material.getUniformData('shadowAtlasRects', mesh, secondBinding) as Float32Array)
        ]).toEqual([7, 8, 9, 10]);
        expect([
            ...(material.getUniformData('pointShadowMatrices', mesh, firstBinding) as Float32Array)
        ]).toEqual([5, 6]);
        expect(semantic.SHADOWATLASSIZE.get.length).toBe(0);
        expect(semantic.SHADOWATLASRECTS.get.length).toBe(0);
        expect(semantic.POINTSHADOWMATRICES.get.length).toBe(0);
    });
});
