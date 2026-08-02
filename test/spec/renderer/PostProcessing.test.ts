import { afterEach, describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Renderer from '../../../src/render/Renderer';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';
import {
    Bloom,
    ColorUber,
    PostProcessRenderPipelineFactory
} from '../../../src/render/postprocessing';
import Shader from '../../../src/shader/Shader';

const activeRenderers: Renderer[] = [];

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
});

describe('built-in post-processing', () => {
    it('normalizes sampled render-target UVs exactly once on WebGPU', () => {
        expect(PORTABLE_FULLSCREEN_VERTEX_SOURCE).toContain('#ifdef HILO_WEBGPU');
        expect(PORTABLE_FULLSCREEN_VERTEX_SOURCE).toContain('v_uv = hiloRenderTargetUV(v_uv);');
        const mainSource = PORTABLE_FULLSCREEN_VERTEX_SOURCE.slice(
            PORTABLE_FULLSCREEN_VERTEX_SOURCE.indexOf('void main()')
        );
        expect(mainSource.match(/hiloRenderTargetUV/gu)).toHaveLength(1);
        expect(mainSource).not.toContain('1.0 -');
    });

    it('normalizes projected transmission UVs through the same portable helper', () => {
        const source = Shader.shaders['chunk/pbr.frag'];
        expect(source).toContain('vec2 hiloRenderTargetUV(vec2 uv)');
        expect(source).toContain('uv = hiloRenderTargetUV(uv);');
    });

    it('normalizes managed 2D, cube, BRDF, and LTC texture coordinates centrally', () => {
        const coordinates = Shader.shaders['method/portableCoordinates.glsl'];
        const uv = Shader.shaders['chunk/uv.frag'];
        const environment = Shader.shaders['method/textureEnvMap.glsl'];
        const pbr = Shader.shaders['chunk/pbr.frag'];
        const areaLight = Shader.shaders['method/getAreaLight.glsl'];

        expect(coordinates).toContain('vec2 hiloTextureUV(vec2 uv)');
        expect(coordinates).toContain('vec3 hiloTextureCubeDirection(vec3 direction)');
        expect(coordinates).toMatch(
            /vec3 hiloTextureCubeDirection\(vec3 direction\)\s*\{\s*return direction;\s*\}/u
        );
        expect(uv).toContain('texture(sourceTexture, hiloTextureUV(hiloMaterialUV(slot)))');
        expect(uv).toContain('vec3 hiloDecodeMaterialColor(vec3 sampled, int slot)');
        expect(uv).toContain('vec4 hiloMaterialSample(vec4 sampled, int slot)');
        expect(environment).toContain('texture(uTexture, hiloTextureCubeDirection(position))');
        expect(pbr).toContain(
            'radiance = HILO_DECODE_MATERIAL_COLOR(radiance, HILO_SPECULAR_ENV_MAP);'
        );
        expect(pbr).toContain(
            'irradiance = HILO_DECODE_MATERIAL_COLOR(irradiance, HILO_DIFFUSE_ENV_MAP);'
        );
        expect(pbr).toContain('hiloTextureUV(vec2(NdotV, 1.0 - perceptualRoughness))');
        expect(areaLight).toContain('texture(areaLightsLtcTexture1, hiloTextureUV(uv))');
    });

    it('declares the linear HDR feature requirements before renderer creation', () => {
        const bloom = new Bloom();
        const colorUber = new ColorUber();
        const factory = new PostProcessRenderPipelineFactory();

        expect(bloom.injectionPoint).toBe('after-transparent');
        expect(colorUber.injectionPoint).toBe('after-post-process');
        expect(factory.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'color-attachment' },
                { format: 'rgba16float', use: 'filterable-sampled' },
                { format: 'rgba8unorm', use: 'color-attachment' }
            ])
        );
    });

    it('validates bloom and grading ranges at construction time', () => {
        expect(() => new Bloom({ maxLevels: 0 })).toThrow(/maxLevels/u);
        expect(() => new Bloom({ knee: 0 })).toThrow(/knee/u);
        expect(() => new ColorUber({ temperature: 2 }).create()).toThrow(/temperature/u);
    });

    it.each(['webgl2', 'webgpu'] as const)(
        'renders HDR bloom and a transmissive volume through the opaque scene texture on %s',
        async backend => {
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 32,
                height: 24,
                antialias: false,
                renderPipeline: new PostProcessRenderPipelineFactory({
                    bloom: {
                        threshold: 0.7,
                        intensity: 0.8,
                        maxLevels: 3,
                        minResolution: 2
                    },
                    colorUber: {
                        toneMapping: 'pbr-neutral',
                        exposure: -0.2
                    }
                })
            });
            activeRenderers.push(renderer);

            const scene = new Node();
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry({ width: 3, height: 3, depth: 0.2 }),
                    material: new BasicMaterial({
                        lightType: 'NONE',
                        diffuse: new Color(2.5, 0.3, 0.08)
                    }),
                    z: -1,
                    frustumTest: false
                })
            );
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({
                        baseColor: new Color(0.7, 0.9, 1),
                        metallic: 0,
                        roughness: 0.16,
                        transmissionFactor: 0.85,
                        thicknessFactor: 0.4,
                        attenuationDistance: 2,
                        attenuationColor: new Color(0.7, 0.9, 1),
                        ior: 1.45
                    }),
                    frustumTest: false
                })
            );
            const camera = new PerspectiveCamera({ aspect: 4 / 3, z: 3 });

            expect(() => {
                renderer.render(scene, camera);
            }).not.toThrow();
            expect(() => {
                renderer.render(scene, camera);
            }).not.toThrow();
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
        }
    );
});
