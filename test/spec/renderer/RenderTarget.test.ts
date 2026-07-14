import { afterEach, describe, expect, it, vi } from 'vitest';
import Node from '../../../src/core/Node';
import Mesh from '../../../src/core/Mesh';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import BasicMaterial from '../../../src/material/BasicMaterial';
import ShaderMaterial from '../../../src/material/ShaderMaterial';
import Shader from '../../../src/shader/Shader';
import Framebuffer from '../../../src/render/internal/webgl2/Framebuffer';
import type WebGL2Driver from '../../../src/render/internal/webgl2/WebGL2Driver';
import WebGLRenderTarget from '../../../src/render/internal/webgl2/WebGLRenderTarget';
import {
    destroyWebGLTextures,
    getWebGLTexture,
    getWebGLTextureCache,
    releaseWebGLTexture
} from '../../../src/render/internal/webgl2/WebGLState';
import {
    normalizeRenderTargetParameters,
    type RenderTarget
} from '../../../src/render/RenderTarget';
import type Texture from '../../../src/texture/Texture';
import { testEnv } from '../../setup';

const targets: RenderTarget[] = [];

function createRenderer(): WebGL2Driver {
    return testEnv.renderer;
}

function track<Target extends RenderTarget>(target: Target): Target {
    targets.push(target);
    return target;
}

function createTexturedScene(texture: Texture<unknown>): {
    readonly scene: Node;
    readonly mesh: Mesh;
    readonly material: BasicMaterial;
} {
    const material = new BasicMaterial({ lightType: 'NONE', diffuse: texture });
    const mesh = new Mesh({
        geometry: new BoxGeometry(),
        material,
        frustumTest: false,
        z: -2
    });
    const scene = new Node();
    scene.addChild(mesh);
    return { scene, mesh, material };
}

function createTexturedQuadScene(texture: () => Texture<unknown>): Node {
    const vertexShader = Shader.shaders['screen.vert'];
    if (!vertexShader) throw new Error('Built-in screen vertex shader is unavailable');
    const material = new ShaderMaterial({
        shaderName: 'RenderTargetPresentationTest',
        shaderCacheId: 'RenderTargetPresentationTest',
        needBasicAttributes: false,
        needBasicUniforms: false,
        depthTest: true,
        depthMask: true,
        cullFace: false,
        blend: false,
        attributes: {
            a_position: 'POSITION',
            a_texcoord0: 'TEXCOORD_0'
        },
        uniforms: {
            u_texture: { get: texture }
        },
        vs: vertexShader,
        fs: `#version 300 es
            precision highp float;
            in vec2 v_texcoord0;
            uniform sampler2D u_texture;
            layout(location = 0) out vec4 fragmentColor;
            void main(void) {
                fragmentColor = texture(u_texture, v_texcoord0);
            }
        `
    });
    const mesh = new Mesh({
        geometry: new Geometry({
            mode: testEnv.gl.TRIANGLE_STRIP,
            vertices: new GeometryData(
                new Float32Array([-0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5]),
                2
            ),
            uvs: new GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2)
        }),
        material,
        frustumTest: false
    });
    const scene = new Node();
    scene.addChild(mesh);
    return scene;
}

function createStencilScene(includeReject = true, writeMask = 0xff): Node {
    const vertexShader = `#version 300 es
        in vec2 a_position;
        void main(void) {
            gl_Position = vec4(a_position, 0.0, 1.0);
        }
    `;
    const geometry = (): Geometry =>
        new Geometry({
            mode: testEnv.gl.TRIANGLE_STRIP,
            vertices: new GeometryData(new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]), 2)
        });
    const material = (
        name: string,
        color: readonly [number, number, number, number],
        renderOrder: number
    ): ShaderMaterial =>
        new ShaderMaterial({
            shaderName: name,
            shaderCacheId: name,
            needBasicAttributes: false,
            needBasicUniforms: false,
            depthTest: true,
            depthMask: false,
            cullFace: false,
            blend: false,
            renderOrder,
            attributes: { a_position: 'POSITION' },
            vs: vertexShader,
            fs: `#version 300 es
                precision highp float;
                layout(location = 0) out vec4 fragmentColor;
                void main(void) {
                    fragmentColor = vec4(${color.join(', ')});
                }
            `
        });
    const writeStencil = material('RenderTargetStencilWriteTest', [1, 0, 0, 1], 0);
    writeStencil.stencilTest = true;
    writeStencil.stencilFunc = testEnv.gl.ALWAYS;
    writeStencil.stencilFuncRef = 1;
    writeStencil.stencilFuncMask = 0xff;
    writeStencil.stencilMask = writeMask;
    writeStencil.stencilOpFail = testEnv.gl.KEEP;
    writeStencil.stencilOpZFail = testEnv.gl.KEEP;
    writeStencil.stencilOpZPass = testEnv.gl.REPLACE;

    const rejectByStencil = material('RenderTargetStencilRejectTest', [0, 1, 0, 1], 1);
    rejectByStencil.stencilTest = true;
    rejectByStencil.stencilFunc = testEnv.gl.EQUAL;
    rejectByStencil.stencilFuncRef = 2;
    rejectByStencil.stencilFuncMask = 0xff;
    rejectByStencil.stencilMask = 0;
    rejectByStencil.stencilOpFail = testEnv.gl.KEEP;
    rejectByStencil.stencilOpZFail = testEnv.gl.KEEP;
    rejectByStencil.stencilOpZPass = testEnv.gl.KEEP;

    const scene = new Node();
    scene.addChild(
        new Mesh({
            geometry: geometry(),
            material: writeStencil,
            frustumTest: false
        })
    );
    if (includeReject) {
        scene.addChild(
            new Mesh({
                geometry: geometry(),
                material: rejectByStencil,
                frustumTest: false
            })
        );
    }
    return scene;
}

afterEach(() => {
    testEnv.renderer.setRenderTarget(null);
    targets.splice(0).forEach(target => {
        target.destroy();
    });
    expect(testEnv.renderer.gl.getError()).toBe(testEnv.renderer.gl.NO_ERROR);
});

describe('backend-neutral render-target validation', () => {
    it('rejects invalid attachment combinations before backend allocation', () => {
        expect(() => normalizeRenderTargetParameters({ width: 0, height: 1 })).toThrow(
            /positive integer/u
        );
        expect(() =>
            normalizeRenderTargetParameters({
                width: 1,
                height: 1,
                colorAttachments: [],
                depthStencilAttachment: false
            })
        ).toThrow(/at least one attachment/u);
        expect(() =>
            normalizeRenderTargetParameters({
                width: 1,
                height: 1,
                sampleCount: 4,
                depthStencilAttachment: { sampled: true }
            })
        ).toThrow(/multisampled depth/u);
        expect(() =>
            normalizeRenderTargetParameters({
                width: 1,
                height: 1,
                depthStencilAttachment: {
                    format: 'depth24plus',
                    stencilLoadOp: 'load'
                }
            })
        ).toThrow(/Stencil operations require/u);
    });
});

describe('WebGL2 backend-neutral render targets', () => {
    it('uses an offscreen stencil attachment even when the canvas has no stencil buffer', async () => {
        const renderer = createRenderer();
        expect(renderer.stencil).toBe(false);
        const target = track(
            renderer.createRenderTarget({
                width: 8,
                height: 8,
                colorAttachments: [{ clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
                depthStencilAttachment: {
                    format: 'depth24plus-stencil8',
                    depthClearValue: 1,
                    stencilClearValue: 0
                }
            })
        );
        const scene = createStencilScene();

        try {
            renderer.renderToTarget(target, scene, new PerspectiveCamera());
            const pixel = await target.readColorAttachment({ x: 4, y: 4, width: 1, height: 1 });
            expect([...pixel.data]).toEqual([255, 0, 0, 255]);

            renderer.renderToTarget(target, scene, new PerspectiveCamera());
            const secondFrame = await target.readColorAttachment({
                x: 4,
                y: 4,
                width: 1,
                height: 1
            });
            expect([...secondFrame.data]).toEqual([255, 0, 0, 255]);
        } finally {
            scene.destroy(renderer);
        }
    });

    it('reapplies one material write masks after consecutive target clears', () => {
        const renderer = createRenderer();
        const target = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                depthStencilAttachment: { format: 'depth24plus-stencil8' }
            })
        );
        const scene = createStencilScene(false, 0x0f);

        try {
            renderer.renderToTarget(target, scene, new PerspectiveCamera());
            renderer.renderToTarget(target, scene, new PerspectiveCamera());
            expect(renderer.gl.getParameter(renderer.gl.DEPTH_WRITEMASK)).toBe(false);
            expect(renderer.gl.getParameter(renderer.gl.STENCIL_WRITEMASK)).toBe(0x0f);
        } finally {
            scene.destroy(renderer);
        }
    });

    it('renders ordinary scenes into MRT, restores the canvas, and reads attachment pixels', async () => {
        const renderer = createRenderer();
        const target = track(
            renderer.createRenderTarget({
                width: 8,
                height: 8,
                colorAttachments: [
                    { clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 } },
                    { clearValue: { r: 0.8, g: 0.1, b: 0.2, a: 1 } }
                ],
                depthStencilAttachment: false
            })
        );
        const firstTexture = target.getColorTexture(0);
        const secondTexture = target.getColorTexture(1);

        renderer.setRenderTarget(target);
        renderer.render(new Node(), new PerspectiveCamera());
        renderer.setRenderTarget(null);

        expect(renderer.renderTarget).toBeNull();
        expect(target.backend).toBe('webgl2');
        expect(target.colorAttachmentCount).toBe(2);
        expect(firstTexture).not.toBe(secondTexture);
        const first = await target.readColorAttachment({ width: 1, height: 1 });
        const second = await target.readColorAttachment({
            attachmentIndex: 1,
            width: 1,
            height: 1
        });
        expect([...first.data]).toEqual([64, 128, 191, 255]);
        expect([...second.data]).toEqual([204, 26, 51, 255]);
    });

    it('supports four-sample MRT resolves with sampleable color textures', async () => {
        const renderer = createRenderer();
        const target = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                sampleCount: 4,
                colorAttachments: [
                    { clearValue: { r: 1, g: 0, b: 0, a: 1 } },
                    { clearValue: { r: 0, g: 1, b: 0, a: 1 } }
                ]
            })
        );

        renderer.renderToTarget(target, new Node(), new PerspectiveCamera());

        expect(target.sampleCount).toBe(4);
        expect(target.getColorTexture()).not.toBe(target.getColorTexture(1));
        expect([...(await target.readColorAttachment({ width: 1, height: 1 })).data]).toEqual([
            255, 0, 0, 255
        ]);
        expect([
            ...(await target.readColorAttachment({ attachmentIndex: 1, width: 1, height: 1 })).data
        ]).toEqual([0, 255, 0, 255]);
    });

    it('rebuilds a destroyed attachment allocation before direct readback', async () => {
        const renderer = createRenderer();
        const target = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                colorAttachments: [{ clearValue: { r: 1, g: 0, b: 0, a: 1 } }],
                depthStencilAttachment: false
            })
        );
        const texture = target.getColorTexture();
        const framebuffer = Reflect.get(target, 'drawFramebuffer') as Framebuffer;
        const firstFramebuffer = framebuffer.framebuffer;
        const firstAllocation = getWebGLTexture(renderer.state, texture);

        texture.destroy();
        expect(renderer.gl.isTexture(firstAllocation)).toBe(false);

        await expect(target.readColorAttachment({ width: 1, height: 1 })).resolves.toBeDefined();
        const replacement = getWebGLTexture(renderer.state, texture);
        expect(framebuffer.framebuffer).not.toBe(firstFramebuffer);
        expect(replacement).not.toBe(firstAllocation);
        expect(renderer.gl.isTexture(replacement)).toBe(true);
        expect(framebuffer.isComplete()).toBe(true);
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
    });

    it('reattaches a manager-replaced resolve allocation before multisample blit', async () => {
        const renderer = createRenderer();
        const target = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                sampleCount: 4,
                colorAttachments: [{ clearValue: { r: 1, g: 0, b: 0, a: 1 } }],
                depthStencilAttachment: false
            })
        );
        const texture = target.getColorTexture();
        const resolveFramebuffers = Reflect.get(target, 'resolveFramebuffers') as Framebuffer[];
        const resolveFramebuffer = resolveFramebuffers[0];
        if (!resolveFramebuffer) throw new Error('Missing multisample resolve framebuffer');
        const firstFramebuffer = resolveFramebuffer.framebuffer;
        const firstAllocation = getWebGLTexture(renderer.state, texture);

        target.beginRenderPass();
        const released = releaseWebGLTexture(renderer.state, texture);
        target.endRenderPass(true);

        const replacement = getWebGLTexture(renderer.state, texture);
        expect(released).toBe(true);
        expect(renderer.gl.isTexture(firstAllocation)).toBe(false);
        expect(resolveFramebuffer.framebuffer).not.toBe(firstFramebuffer);
        expect(replacement).not.toBe(firstAllocation);
        expect(resolveFramebuffer.isComplete()).toBe(true);
        expect([...(await target.readColorAttachment({ width: 1, height: 1 })).data]).toEqual([
            255, 0, 0, 255
        ]);
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
    });

    it('presents attachment zero through a native fullscreen draw on antialiased canvases', () => {
        const renderer = createRenderer();
        const target = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                colorAttachments: [{ clearValue: { r: 1, g: 0, b: 0, a: 1 } }]
            })
        );
        const drawArrays = vi.spyOn(renderer.gl, 'drawArrays');
        renderer.setRenderTarget(target, { present: true });

        renderer.render(new Node(), new PerspectiveCamera());

        expect(drawArrays).toHaveBeenCalledWith(renderer.gl.TRIANGLES, 0, 3);
        const pixel = new Uint8Array(4);
        renderer.gl.readPixels(
            Math.floor(renderer.gl.drawingBufferWidth / 2),
            Math.floor(renderer.gl.drawingBufferHeight / 2),
            1,
            1,
            renderer.gl.RGBA,
            renderer.gl.UNSIGNED_BYTE,
            pixel
        );
        expect([...pixel]).toEqual([255, 0, 0, 255]);
        drawArrays.mockRestore();
    });

    it('supports explicit backend-neutral presentation without persistent target selection', () => {
        const renderer = createRenderer();
        const target = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                colorAttachments: [{ clearValue: { r: 0, g: 1, b: 0, a: 1 } }],
                depthStencilAttachment: false
            })
        );
        renderer.renderToTarget(target, new Node(), new PerspectiveCamera());

        renderer.present(target);

        const pixel = new Uint8Array(4);
        renderer.gl.readPixels(
            Math.floor(renderer.gl.drawingBufferWidth / 2),
            Math.floor(renderer.gl.drawingBufferHeight / 2),
            1,
            1,
            renderer.gl.RGBA,
            renderer.gl.UNSIGNED_BYTE,
            pixel
        );
        expect([...pixel]).toEqual([0, 255, 0, 255]);
        expect(renderer.renderTarget).toBeNull();
    });

    it('rebinds material textures and clears attachments across consecutive presentation frames', () => {
        const renderer = createRenderer();
        const blueSource = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                colorAttachments: [{ clearValue: { r: 0, g: 0, b: 1, a: 1 } }],
                depthStencilAttachment: false
            })
        );
        const greenSource = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                colorAttachments: [{ clearValue: { r: 0, g: 1, b: 0, a: 1 } }],
                depthStencilAttachment: false
            })
        );
        renderer.renderToTarget(blueSource, new Node(), new PerspectiveCamera());
        renderer.renderToTarget(greenSource, new Node(), new PerspectiveCamera());
        let sourceTexture = blueSource.getColorTexture();
        const scene = createTexturedQuadScene(() => sourceTexture);
        const target = track(
            renderer.createRenderTarget({
                width: 16,
                height: 16,
                colorAttachments: [{ clearValue: { r: 1, g: 0, b: 0, a: 1 } }]
            })
        );
        renderer.setRenderTarget(target, { present: true });

        try {
            renderer.render(scene, new PerspectiveCamera());
            const firstPixel = new Uint8Array(4);
            renderer.gl.readPixels(
                Math.floor(renderer.gl.drawingBufferWidth / 2),
                Math.floor(renderer.gl.drawingBufferHeight / 2),
                1,
                1,
                renderer.gl.RGBA,
                renderer.gl.UNSIGNED_BYTE,
                firstPixel
            );
            expect([...firstPixel]).toEqual([0, 0, 255, 255]);

            renderer.state.colorMask(false, false, false, false);
            renderer.state.depthMask(false);
            renderer.state.stencilMask(0);
            sourceTexture = greenSource.getColorTexture();
            renderer.render(scene, new PerspectiveCamera());

            const centerPixel = new Uint8Array(4);
            renderer.gl.readPixels(
                Math.floor(renderer.gl.drawingBufferWidth / 2),
                Math.floor(renderer.gl.drawingBufferHeight / 2),
                1,
                1,
                renderer.gl.RGBA,
                renderer.gl.UNSIGNED_BYTE,
                centerPixel
            );
            const backgroundPixel = new Uint8Array(4);
            renderer.gl.readPixels(
                1,
                1,
                1,
                1,
                renderer.gl.RGBA,
                renderer.gl.UNSIGNED_BYTE,
                backgroundPixel
            );
            expect([...centerPixel]).toEqual([0, 255, 0, 255]);
            expect([...backgroundPixel]).toEqual([255, 0, 0, 255]);
            expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        } finally {
            scene.destroy(renderer);
        }
    });

    it('restores the canvas framebuffer when beginning a render pass throws', () => {
        const renderer = createRenderer();
        const target = track(renderer.createRenderTarget({ width: 8, height: 8 }));
        renderer.setRenderTarget(target);
        const clearBuffer = vi.spyOn(renderer.gl, 'clearBufferfv').mockImplementationOnce(() => {
            throw new Error('injected attachment clear failure');
        });

        try {
            expect(() => {
                renderer.render(new Node(), new PerspectiveCamera());
            }).toThrow(/injected attachment clear failure/u);
            expect(renderer.state.currentReadFramebuffer).toBe(renderer.state.systemFramebuffer);
            expect(renderer.state.currentDrawFramebuffer).toBe(renderer.state.systemFramebuffer);
        } finally {
            clearBuffer.mockRestore();
        }
        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
    });

    it('restores the canvas framebuffer when multisample resolve throws', () => {
        const renderer = createRenderer();
        const target = track(renderer.createRenderTarget({ width: 8, height: 8, sampleCount: 4 }));
        renderer.setRenderTarget(target);
        const blitFramebuffer = vi
            .spyOn(renderer.gl, 'blitFramebuffer')
            .mockImplementationOnce(() => {
                throw new Error('injected resolve failure');
            });

        try {
            expect(() => {
                renderer.render(new Node(), new PerspectiveCamera());
            }).toThrow(/injected resolve failure/u);
            expect(renderer.state.currentReadFramebuffer).toBe(renderer.state.systemFramebuffer);
            expect(renderer.state.currentDrawFramebuffer).toBe(renderer.state.systemFramebuffer);
        } finally {
            blitFramebuffer.mockRestore();
        }
        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
    });

    it('creates depth-only sampled targets and preserves target selection across scoped renders', () => {
        const renderer = createRenderer();
        const persistent = track(renderer.createRenderTarget({ width: 8, height: 8 }));
        const depthOnly = track(
            renderer.createRenderTarget({
                width: 4,
                height: 4,
                colorAttachments: [],
                depthStencilAttachment: { format: 'depth24plus', sampled: true }
            })
        );
        renderer.setRenderTarget(persistent, { present: true, takeOwnership: true });

        renderer.renderToTarget(depthOnly, new Node(), new PerspectiveCamera());

        expect(renderer.renderTarget).toBe(persistent);
        expect(depthOnly.getDepthTexture()).not.toBeNull();
        expect(() => depthOnly.getColorTexture()).toThrow(/out of range/u);
        expect(persistent.isDestroyed).toBe(false);
    });

    it('restores the same attachments with new native textures after WebGL context resources reset', () => {
        const renderer = createRenderer();
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        const target = track(
            renderer.createRenderTarget({
                width: 6,
                height: 4,
                colorAttachments: [{}, {}],
                depthStencilAttachment: { format: 'depth24plus', sampled: true }
            })
        );
        const colors = [target.getColorTexture(0), target.getColorTexture(1)] as const;
        const depth = target.getDepthTexture();
        if (!depth) throw new Error('Render target did not create its sampled depth texture');
        const allocations = [
            getWebGLTexture(renderer.state, colors[0]),
            getWebGLTexture(renderer.state, colors[1]),
            getWebGLTexture(renderer.state, depth)
        ] as const;
        const destroyListener = vi.fn();
        colors[0].on('destroy', destroyListener);
        colors[1].on('destroy', destroyListener);
        depth.on('destroy', destroyListener);
        const { scene, mesh, material } = createTexturedScene(colors[0]);

        destroyWebGLTextures(renderer.state);
        renderer.state.reset();
        Framebuffer.reset(renderer.gl);
        target.handleContextRestored();
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);

        expect(target.getColorTexture(0)).toBe(colors[0]);
        expect(target.getColorTexture(1)).toBe(colors[1]);
        expect(target.getDepthTexture()).toBe(depth);
        expect(destroyListener).not.toHaveBeenCalled();
        const restoredAllocations = [
            getWebGLTexture(renderer.state, colors[0]),
            getWebGLTexture(renderer.state, colors[1]),
            getWebGLTexture(renderer.state, depth)
        ] as const;
        restoredAllocations.forEach((allocation, index) => {
            const previousAllocation = allocations[index];
            if (!previousAllocation) throw new Error('Missing pre-reset texture allocation');
            expect(allocation).not.toBe(previousAllocation);
            expect(renderer.gl.isTexture(allocation)).toBe(true);
            expect(renderer.gl.isTexture(previousAllocation)).toBe(false);
        });
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        expect(material.diffuse).toBe(colors[0]);
        renderer.renderToTarget(target, new Node(), new PerspectiveCamera());
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        renderer.render(scene, new PerspectiveCamera());
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
        mesh.destroy(renderer);
    });

    it('rolls every multisample resolve back when a later resize allocation fails', () => {
        const renderer = createRenderer();
        const target = track(
            renderer.createRenderTarget({
                width: 4,
                height: 3,
                sampleCount: 4,
                colorAttachments: [{}, {}],
                depthStencilAttachment: false
            })
        );
        const colors = [target.getColorTexture(0), target.getColorTexture(1)] as const;
        const allocations = colors.map(texture => getWebGLTexture(renderer.state, texture));
        const drawFramebuffer = Reflect.get(target, 'drawFramebuffer') as Framebuffer;
        const resolveFramebuffers = Reflect.get(target, 'resolveFramebuffers') as Framebuffer[];
        const nativeCheckFramebufferStatus = renderer.gl.checkFramebufferStatus.bind(renderer.gl);
        let resizeChecks = 0;
        const checkFramebufferStatus = vi
            .spyOn(renderer.gl, 'checkFramebufferStatus')
            .mockImplementation(targetValue => {
                resizeChecks++;
                return resizeChecks === 3
                    ? renderer.gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT
                    : nativeCheckFramebufferStatus(targetValue);
            });

        try {
            expect(() => {
                target.resize(9, 7);
            }).toThrow(/Framebuffer is incomplete/u);
        } finally {
            checkFramebufferStatus.mockRestore();
        }

        expect(resizeChecks).toBe(6);
        expect(target.isDestroyed).toBe(false);
        expect(target.width).toBe(4);
        expect(target.height).toBe(3);
        expect(target.getColorTexture(0)).toBe(colors[0]);
        expect(target.getColorTexture(1)).toBe(colors[1]);
        colors.forEach((texture, index) => {
            expect(texture.width).toBe(4);
            expect(texture.height).toBe(3);
            const allocation = getWebGLTexture(renderer.state, texture);
            const previousAllocation = allocations[index];
            if (!previousAllocation) throw new Error('Missing pre-resize texture allocation');
            expect(allocation).toBe(previousAllocation);
            expect(renderer.gl.isTexture(allocation)).toBe(true);
        });
        expect(drawFramebuffer.width).toBe(4);
        expect(drawFramebuffer.height).toBe(3);
        expect(drawFramebuffer.isComplete()).toBe(true);
        resolveFramebuffers.forEach(framebuffer => {
            expect(framebuffer.width).toBe(4);
            expect(framebuffer.height).toBe(3);
            expect(framebuffer.isComplete()).toBe(true);
        });
        renderer.renderToTarget(target, new Node(), new PerspectiveCamera());
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);
    });

    it('preserves public attachment identity across resize and fully destroys owned attachments', () => {
        const renderer = createRenderer();
        const first = track(
            renderer.createRenderTarget({
                width: 2,
                height: 3,
                depthStencilAttachment: { format: 'depth24plus', sampled: true }
            })
        );
        const colorTexture = first.getColorTexture();
        const depthTexture = first.getDepthTexture();
        if (!depthTexture)
            throw new Error('Render target did not create its sampled depth texture');
        const colorDestroy = vi.fn();
        const depthDestroy = vi.fn();
        colorTexture.on('destroy', colorDestroy);
        depthTexture.on('destroy', depthDestroy);
        const colorAllocation = getWebGLTexture(renderer.state, colorTexture);
        const depthAllocation = getWebGLTexture(renderer.state, depthTexture);
        const ownedFramebuffers: Framebuffer[] = [];
        Framebuffer.getCache(renderer.gl).each(framebuffer => {
            if (
                framebuffer.colorAttachmentInfos.some(info => info.texture === colorTexture) ||
                framebuffer.depthStencilAttachmentInfo?.texture === depthTexture
            ) {
                ownedFramebuffers.push(framebuffer);
            }
        });
        const { scene, mesh, material } = createTexturedScene(colorTexture);

        first.resize(5, 7);

        expect(first.width).toBe(5);
        expect(first.height).toBe(7);
        expect(first.getColorTexture()).toBe(colorTexture);
        expect(first.getDepthTexture()).toBe(depthTexture);
        expect(colorTexture.width).toBe(5);
        expect(colorTexture.height).toBe(7);
        expect(depthTexture.width).toBe(5);
        expect(depthTexture.height).toBe(7);
        const resizedColorAllocation = getWebGLTexture(renderer.state, colorTexture);
        const resizedDepthAllocation = getWebGLTexture(renderer.state, depthTexture);
        expect(resizedColorAllocation).toBe(colorAllocation);
        expect(resizedDepthAllocation).toBe(depthAllocation);
        expect(renderer.gl.isTexture(resizedColorAllocation)).toBe(true);
        expect(renderer.gl.isTexture(resizedDepthAllocation)).toBe(true);
        expect(colorDestroy).not.toHaveBeenCalled();
        expect(depthDestroy).not.toHaveBeenCalled();
        expect(material.diffuse).toBe(colorTexture);
        renderer.renderToTarget(first, new Node(), new PerspectiveCamera());
        renderer.render(scene, new PerspectiveCamera());
        expect(renderer.gl.getError()).toBe(renderer.gl.NO_ERROR);

        const second = track(renderer.createRenderTarget({ width: 2, height: 2 }));
        renderer.setRenderTarget(first, { takeOwnership: true });
        renderer.setRenderTarget(second);
        expect(first.isDestroyed).toBe(true);
        expect(colorDestroy).toHaveBeenCalledOnce();
        expect(depthDestroy).toHaveBeenCalledOnce();
        expect(getWebGLTextureCache(renderer.state).get(colorTexture.id)).toBeUndefined();
        expect(getWebGLTextureCache(renderer.state).get(depthTexture.id)).toBeUndefined();
        ownedFramebuffers.forEach(framebuffer => {
            expect(Framebuffer.getCache(renderer.gl).get(framebuffer.id)).toBeUndefined();
        });
        second.destroy();
        second.destroy();
        expect(second.isDestroyed).toBe(true);
        expect(renderer.renderTarget).toBeNull();
        expect(() => renderer.setRenderTarget(second)).toThrow(/destroyed|different renderer/u);

        const unregistered = track(new WebGLRenderTarget(renderer, { width: 1, height: 1 }));
        expect(() => renderer.setRenderTarget(unregistered)).toThrow(/different renderer/u);
        unregistered.destroy();
        mesh.destroy(renderer);
    });
});
