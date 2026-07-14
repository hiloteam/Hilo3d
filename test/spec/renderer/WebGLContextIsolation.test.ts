import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import Buffer from '../../../src/render/internal/webgl2/Buffer';
import Program from '../../../src/render/internal/webgl2/Program';
import VertexArrayObject from '../../../src/render/internal/webgl2/VertexArrayObject';
import WebGL2Driver from '../../../src/render/internal/webgl2/WebGL2Driver';
import WebGLState, {
    destroyWebGLTextures,
    getWebGLTexture,
    getWebGLTextureCache,
    getWebGLUniformBuffer
} from '../../../src/render/internal/webgl2/WebGLState';

const vertexShader = `#version 300 es
void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }`;
const fragmentShader = `#version 300 es
precision mediump float;
out vec4 color;
void main() { color = vec4(1.0); }`;

function createContext(): WebGL2RenderingContext {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('WebGL2 is required for context-isolation tests');
    return gl;
}

function managedResource(renderer: WebGL2Driver, mesh: Hilo3d.Mesh, flag: 'isProgram'): Program;
function managedResource(
    renderer: WebGL2Driver,
    mesh: Hilo3d.Mesh,
    flag: 'isVertexArrayObject'
): VertexArrayObject;
function managedResource(renderer: WebGL2Driver, mesh: Hilo3d.Mesh, flag: 'isBuffer'): Buffer;
function managedResource(
    renderer: WebGL2Driver,
    mesh: Hilo3d.Mesh,
    flag: 'isProgram' | 'isVertexArrayObject' | 'isBuffer'
): Program | VertexArrayObject | Buffer {
    const resource = renderer.resourceManager
        .getMeshResources(mesh)
        .find(candidate => Reflect.get(candidate, flag) === true);
    if (!resource) throw new Error(`Renderer has no managed ${flag} resource`);
    return resource as Program | VertexArrayObject | Buffer;
}

describe('WebGL2 context isolation', () => {
    it('partitions programs, buffers, VAOs, textures and current bindings by native context', () => {
        const firstGL = createContext();
        const secondGL = createContext();
        const firstState = new WebGLState(firstGL);
        const secondState = new WebGLState(secondGL);
        const shader = new Hilo3d.Shader({ vs: vertexShader, fs: fragmentShader });
        const geometryData = new Hilo3d.GeometryData(
            new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            3
        );
        const texture = new Hilo3d.Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([255, 0, 0, 255]),
            isImageCanRelease: true,
            minFilter: firstGL.NEAREST,
            magFilter: firstGL.NEAREST
        });

        try {
            const firstProgram = Program.getProgram(shader, firstState);
            const secondProgram = Program.getProgram(shader, secondState);
            const firstBuffer = Buffer.createVertexBuffer(firstGL, geometryData);
            const secondBuffer = Buffer.createVertexBuffer(secondGL, geometryData);
            const firstVao = VertexArrayObject.getVao(firstGL, 'shared-vao');
            const secondVao = VertexArrayObject.getVao(secondGL, 'shared-vao');
            const firstTexture = getWebGLTexture(firstState, texture);
            const secondTexture = getWebGLTexture(secondState, texture);

            expect(firstProgram).not.toBe(secondProgram);
            expect(firstProgram.gl).toBe(firstGL);
            expect(secondProgram.gl).toBe(secondGL);
            expect(firstBuffer).not.toBe(secondBuffer);
            expect(firstBuffer.gl).toBe(firstGL);
            expect(secondBuffer.gl).toBe(secondGL);
            expect(firstVao).not.toBe(secondVao);
            expect(firstVao.gl).toBe(firstGL);
            expect(secondVao.gl).toBe(secondGL);
            expect(firstTexture).not.toBe(secondTexture);
            expect(texture.isImageReleased).toBe(true);
            expect(() => texture.image).toThrow(/has been released/);

            firstVao.bind();
            secondVao.bind();
            expect(firstGL.getParameter(firstGL.VERTEX_ARRAY_BINDING)).toBe(
                Reflect.get(firstVao, 'vao')
            );
            expect(secondGL.getParameter(secondGL.VERTEX_ARRAY_BINDING)).toBe(
                Reflect.get(secondVao, 'vao')
            );

            Program.reset(firstGL);
            Buffer.reset(firstGL);
            VertexArrayObject.reset(firstGL);
            destroyWebGLTextures(firstState);

            expect(secondProgram.program).not.toBeNull();
            expect(secondGL.isProgram(secondProgram.program)).toBe(true);
            expect(secondGL.isBuffer(secondBuffer.buffer)).toBe(true);
            expect(
                secondGL.isVertexArray(Reflect.get(secondVao, 'vao') as WebGLVertexArrayObject)
            ).toBe(true);
            expect(secondGL.isTexture(secondTexture)).toBe(true);
            expect(getWebGLTexture(secondState, texture)).toBe(secondTexture);
            expect(firstGL.getError()).toBe(firstGL.NO_ERROR);
            expect(secondGL.getError()).toBe(secondGL.NO_ERROR);
        } finally {
            Program.reset(firstGL);
            Program.reset(secondGL);
            Buffer.reset(firstGL);
            Buffer.reset(secondGL);
            VertexArrayObject.reset(firstGL);
            VertexArrayObject.reset(secondGL);
            destroyWebGLTextures(firstState);
            destroyWebGLTextures(secondState);
            shader.destroy();
        }
    });

    it('keeps a live renderer intact when a peer releases every GPU resource', () => {
        const firstCanvas = document.createElement('canvas');
        const secondCanvas = document.createElement('canvas');
        const firstRenderer = new WebGL2Driver({
            domElement: firstCanvas,
            width: 16,
            height: 16
        });
        const secondRenderer = new WebGL2Driver({
            domElement: secondCanvas,
            width: 16,
            height: 16
        });
        const texture = new Hilo3d.Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([32, 64, 128, 255]),
            isImageCanRelease: true,
            minFilter: Hilo3d.constants.NEAREST,
            magFilter: Hilo3d.constants.NEAREST
        });
        const geometry = new Hilo3d.Geometry({
            vertices: new Hilo3d.GeometryData(
                new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]),
                3
            )
        });
        const material = new Hilo3d.BasicMaterial({ lightType: 'NONE', diffuse: texture });
        const mesh = new Hilo3d.Mesh({ geometry, material, frustumTest: false });
        const scene = new Hilo3d.Node();
        const camera = new Hilo3d.PerspectiveCamera();
        scene.addChild(mesh);

        try {
            firstRenderer.render(scene, camera);
            secondRenderer.render(scene, camera);

            const firstProgram = managedResource(firstRenderer, mesh, 'isProgram');
            const secondProgram = managedResource(secondRenderer, mesh, 'isProgram');
            const firstVao = managedResource(firstRenderer, mesh, 'isVertexArrayObject');
            const secondVao = managedResource(secondRenderer, mesh, 'isVertexArrayObject');
            const firstBuffer = managedResource(firstRenderer, mesh, 'isBuffer');
            const secondBuffer = managedResource(secondRenderer, mesh, 'isBuffer');
            const secondTexture = getWebGLTextureCache(secondRenderer.state).get(texture.id);

            expect(firstRenderer.gl).not.toBe(secondRenderer.gl);
            expect(firstRenderer.capabilities).not.toBe(secondRenderer.capabilities);
            expect(firstRenderer.extensions).not.toBe(secondRenderer.extensions);
            expect(firstProgram).not.toBe(secondProgram);
            expect(firstVao).not.toBe(secondVao);
            expect(firstBuffer).not.toBe(secondBuffer);
            expect(secondTexture).toBeDefined();
            expect(texture.isImageReleased).toBe(true);
            expect(firstRenderer.gl.getError()).toBe(firstRenderer.gl.NO_ERROR);
            expect(secondRenderer.gl.getError()).toBe(secondRenderer.gl.NO_ERROR);

            firstRenderer.releaseGPUResources();

            expect(secondProgram.program).not.toBeNull();
            expect(secondRenderer.gl.isProgram(secondProgram.program)).toBe(true);
            expect(secondRenderer.gl.isBuffer(secondBuffer.buffer)).toBe(true);
            expect(
                secondRenderer.gl.isVertexArray(
                    Reflect.get(secondVao, 'vao') as WebGLVertexArrayObject
                )
            ).toBe(true);
            expect(secondTexture && secondRenderer.gl.isTexture(secondTexture)).toBe(true);
            expect(getWebGLTextureCache(secondRenderer.state).get(texture.id)).toBe(secondTexture);

            secondRenderer.render(scene, camera);
            expect(secondRenderer.gl.getError()).toBe(secondRenderer.gl.NO_ERROR);
        } finally {
            firstRenderer.destroy();
            secondRenderer.destroy();
        }
    });

    it('recreates custom uniform blocks per renderer without invalidating a peer context', () => {
        Hilo3d.registerUniformBlockBinding('ContextIsolationCustomBlock');
        const layout = Hilo3d.createStd140Layout({ u_customValue: 'vec4' });
        const uniformBuffer = Hilo3d.UniformBuffer.fromSchema(layout, {
            u_customValue: [0.25, 0, 0, 0]
        });
        const material = new Hilo3d.ShaderMaterial({
            needBasicUniforms: false,
            needBasicAttributes: false,
            attributes: { a_position: 'POSITION' },
            uniformBlocks: { ContextIsolationCustomBlock: uniformBuffer },
            vs: `#version 300 es
                layout(std140) uniform ContextIsolationCustomBlock {
                    vec4 u_customValue;
                };
                layout(location = 0) in vec3 a_position;
                void main() {
                    gl_Position = vec4(a_position.xy, u_customValue.x, 1.0);
                }`,
            fs: `#version 300 es
                precision highp float;
                layout(location = 0) out vec4 outColor;
                void main() {
                    outColor = vec4(1.0);
                }`
        });
        const geometry = new Hilo3d.Geometry({
            vertices: new Hilo3d.GeometryData(
                new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
                3
            )
        });
        const mesh = new Hilo3d.Mesh({ geometry, material, frustumTest: false });
        const scene = new Hilo3d.Node().addChild(mesh);
        const camera = new Hilo3d.PerspectiveCamera();
        const firstRenderer = new WebGL2Driver({
            domElement: document.createElement('canvas'),
            width: 16,
            height: 16
        });
        const secondRenderer = new WebGL2Driver({
            domElement: document.createElement('canvas'),
            width: 16,
            height: 16
        });

        try {
            firstRenderer.render(scene, camera);
            secondRenderer.render(scene, camera);
            const firstAllocation = getWebGLUniformBuffer(firstRenderer.state, uniformBuffer);
            const secondAllocation = getWebGLUniformBuffer(secondRenderer.state, uniformBuffer);

            expect(firstAllocation).not.toBe(secondAllocation);
            expect(firstRenderer.gl.isBuffer(firstAllocation.buffer)).toBe(true);
            expect(secondRenderer.gl.isBuffer(secondAllocation.buffer)).toBe(true);

            firstRenderer.releaseGPUResources();

            expect(firstRenderer.gl.isBuffer(firstAllocation.buffer)).toBe(false);
            expect(secondRenderer.gl.isBuffer(secondAllocation.buffer)).toBe(true);
            expect(getWebGLUniformBuffer(secondRenderer.state, uniformBuffer)).toBe(
                secondAllocation
            );

            firstRenderer.render(scene, camera);
            const recreatedAllocation = getWebGLUniformBuffer(firstRenderer.state, uniformBuffer);
            expect(recreatedAllocation).not.toBe(firstAllocation);
            expect(firstRenderer.gl.isBuffer(recreatedAllocation.buffer)).toBe(true);
            expect(getWebGLUniformBuffer(secondRenderer.state, uniformBuffer)).toBe(
                secondAllocation
            );
            secondRenderer.render(scene, camera);
            expect(secondRenderer.gl.getError()).toBe(secondRenderer.gl.NO_ERROR);
        } finally {
            firstRenderer.destroy();
            secondRenderer.destroy();
        }
    });
});
