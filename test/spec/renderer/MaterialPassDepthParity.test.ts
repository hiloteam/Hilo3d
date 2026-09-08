import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import type { CameraDepthMode } from '../../../src/camera/Camera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import { FullscreenRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import { SceneRenderPass } from '../../../src/render/pipeline/passes/SceneRenderPass';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';
import Shader from '../../../src/shader/Shader';

const WIDTH = 384;
const HEIGHT = 256;
const JITTER_PHASES = [
    [0, -1 / 6],
    [-1 / 4, 1 / 6],
    [1 / 4, -7 / 18],
    [-3 / 8, -1 / 18],
    [1 / 8, 5 / 18],
    [-1 / 8, -5 / 18],
    [3 / 8, 1 / 18],
    [-7 / 16, 7 / 18]
] as const;
const ZERO = { r: 0, g: 0, b: 0, a: 0 } as const;

class MaterialDepthParityPipeline implements RenderPipeline {
    readonly name = 'Material pass exact depth coverage';
    readonly #depthPass = new SceneRenderPass('Material parity depth prepass');
    readonly #attributesPass = new SceneRenderPass('Material parity equal-depth attributes');
    readonly #coveragePass: FullscreenRenderPass;

    constructor(readonly depthMode: CameraDepthMode) {
        this.#coveragePass = new FullscreenRenderPass({
            name: 'Material parity coverage readback',
            shader: new Shader({
                vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
                fs: `#version 300 es
precision highp float;
uniform sampler2D u_depth;
uniform sampler2D u_attributes;
layout(location = 0) out vec4 color;
void main() {
    // Both attachments and gl_FragCoord use the same native integer pixel coordinates.
    // The diagnostic counts all pixels, so it does not depend on framebuffer row order.
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    float depth = texelFetch(u_depth, pixel, 0).r;
    bool covered = depth ${depthMode === 'reversed' ? '> 0.0' : '< 1.0'};
    bool written = texelFetch(u_attributes, pixel, 0).b > 0.05;
    color = vec4(covered && !written ? 1.0 : 0.0, covered && written ? 1.0 : 0.0, 0.0, 1.0);
}`
            }),
            pipelineState: {
                ...DEFAULT_MATERIAL_PIPELINE_STATE,
                depthTest: false,
                depthWrite: false,
                cullMode: 'none'
            }
        });
    }

    record(context: RenderPipelineContext): void {
        const cullingResults = context.cull();
        const depthList = context.createRendererList({
            cullingResults,
            queue: 'opaque',
            sorting: 'material-front-to-back',
            materialPass: 'depth-only'
        });
        const attributesList = context.createRendererList({
            cullingResults,
            queue: 'opaque',
            sorting: 'material-front-to-back',
            materialPass: 'material-attributes'
        });
        const extent = { relativeTo: 'output', scale: 1 } as const;
        const depth = context.graph.createTexture('Material parity scene depth', {
            format: 'depth32float',
            extent
        });
        const attributes = context.graph.createTexture('Material parity attributes', {
            format: 'rgba8unorm',
            extent
        });
        const reflectionResponse = context.graph.createTexture('Material parity SSR response', {
            format: 'rgba16float',
            extent
        });
        const fallbackSpecular = context.graph.createTexture('Material parity SSR fallback', {
            format: 'rgba16float',
            extent
        });
        context.graph.addPass(this.#depthPass, {
            rendererList: depthList,
            colorAttachments: [],
            depthStencilAttachment: {
                texture: depth,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                depthClearValue: this.depthMode === 'reversed' ? 0 : 1
            }
        });
        context.graph.addPass(this.#attributesPass, {
            rendererList: attributesList,
            colorAttachments: [attributes, reflectionResponse, fallbackSpecular].map(texture => ({
                texture,
                loadOp: 'clear' as const,
                storeOp: 'store' as const,
                clearValue: ZERO
            })),
            depthStencilAttachment: { texture: depth, depthReadOnly: true }
        });
        context.graph.addPass(this.#coveragePass, {
            inputTextures: [depth, attributes],
            colorAttachments: [
                {
                    texture: context.graph.importOutput().color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: ZERO
                }
            ]
        });
    }

    destroy(): void {
        this.#coveragePass.shader.destroy();
    }
}

describe.each(['webgl2', 'webgpu'] as const)('material pass depth parity through %s', backend => {
    it.each(['standard', 'reversed'] as const)(
        'writes attributes at every covered floor pixel across %s-depth jitter phases',
        async depthMode => {
            const factory: RenderPipelineFactory = {
                name: 'Material depth parity factory',
                create: (): RenderPipeline => new MaterialDepthParityPipeline(depthMode)
            };
            const renderer = await Renderer.create({
                backend,
                width: WIDTH,
                height: HEIGHT,
                antialias: false,
                renderPipeline: factory,
                domElement: document.createElement('canvas')
            });
            const target = renderer.createRenderTarget({
                width: WIDTH,
                height: HEIGHT,
                depthStencilAttachment: false
            });
            const scene = new Node();
            new Mesh({
                geometry: new PlaneGeometry({ width: 80, height: 80 }),
                material: new PBRMaterial({ metallic: 0.38, roughness: 0.11 }),
                y: -1.76,
                z: -4.4,
                rotationX: -90,
                frustumTest: false
            }).addTo(scene);
            const camera = new PerspectiveCamera({
                aspect: WIDTH / HEIGHT,
                fov: 32,
                near: 0.05,
                far: 90,
                depthMode
            });
            const lookAt = new Vector3(0.15, -0.85, -5.35);
            try {
                // Large oblique triangles expose sub-ULP depth differences between separately
                // compiled depth and material variants. Test the hero and grazing directions.
                for (const position of [
                    new Vector3(10.8, 2.15, 6.55),
                    new Vector3(9.85, -0.49, 5.45)
                ]) {
                    camera.setPosition(position.x, position.y, position.z).lookAt(lookAt);
                    for (const [phase, jitter] of JITTER_PHASES.entries()) {
                        camera.setProjectionJitter(
                            (jitter[0] * 2) / WIDTH,
                            (jitter[1] * 2) / HEIGHT
                        );
                        renderer.renderToTarget(target, scene, camera);
                        const result = await target.readColorAttachment();
                        let missing = 0;
                        let written = 0;
                        for (let offset = 0; offset < result.data.length; offset += 4) {
                            if ((result.data[offset] ?? 0) > 128) missing++;
                            if ((result.data[offset + 1] ?? 0) > 128) written++;
                        }
                        expect(
                            written,
                            `visible floor at camera y=${String(position.y)}, phase ${String(phase)}`
                        ).toBeGreaterThan((WIDTH * HEIGHT) / 4);
                        expect(
                            missing,
                            `attribute holes at camera y=${String(position.y)}, phase ${String(phase)}`
                        ).toBe(0);
                    }
                }
            } finally {
                target.destroy();
                renderer.destroy();
            }
        },
        20_000
    );
});
