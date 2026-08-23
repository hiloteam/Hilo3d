import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import { RGBA, TEXTURE_2D, TRIANGLE_STRIP, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';
import Fog from '../../../src/core/Fog';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Skeleton from '../../../src/core/Skeleton';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import AmbientLight from '../../../src/light/AmbientLight';
import AreaLight from '../../../src/light/AreaLight';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import PointLight from '../../../src/light/PointLight';
import SpotLight from '../../../src/light/SpotLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import ShaderMaterial from '../../../src/material/ShaderMaterial';
import Color from '../../../src/math/Color';
import Matrix4 from '../../../src/math/Matrix4';
import Vector3 from '../../../src/math/Vector3';
import type RendererCore from '../../../src/render/RendererCore';
import StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import type { RGExecutionResult } from '../../../src/render/graph/RenderGraphExecutor';
import { ForwardRenderer } from '../../../src/render/renderer/ForwardRenderer';
import { GPUDrivenPipelineResourceCache } from '../../../src/render/renderer/GPUDrivenPipelineResourceCache';
import { externalTextureBindingRegistry } from '../../../src/render/renderer/ExternalTextureBindingRegistry';
import {
    MeshDrawProcessor,
    type StorageScenePreparationState
} from '../../../src/render/renderer/MeshDrawProcessor';
import type { PreparedDraw } from '../../../src/render/renderer/PreparedDraw';
import type { RHIMeshDrawTargetDescriptor } from '../../../src/render/renderer/RHIDescriptorMapping';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import type { CompiledShaderArtifactPair } from '../../../src/render/renderer/ShaderArtifactCompiler';
import { StorageGraphicsShaderCompiler } from '../../../src/render/shader/StorageGraphicsShaderCompiler';
import { MainPassTemplate, SharedDrawPassParameters } from '../../../src/render/renderer/passes';
import {
    RHITextureUsage,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHITextureFormat,
    type RHIVertexFormat
} from '../../../src/render/rhi/core';
import { createWebGL2RHIDevice } from '../../../src/render/rhi/backends/webgl2';
import {
    MAX_AREA_LIGHTS,
    MAX_DIRECTIONAL_LIGHTS,
    MAX_POINT_LIGHTS,
    MAX_SPOT_LIGHTS,
    lightBlockLayout,
    materialBlockLayout,
    sceneBlockLayout
} from '../../../src/render/ubo/BuiltInUniformBlocks';
import type { Std140Layout } from '../../../src/render/ubo/Std140Layout';
import Shader from '../../../src/shader/Shader';
import Texture from '../../../src/texture/Texture';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIBuffer,
    type FakeRHIDevice,
    type FakeRHITexture
} from '../rhi/portable/FakeRHIBackend';

const VERTEX_SOURCE = `#version 300 es
in vec3 position;
void main() {
    gl_Position = vec4(position, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
void main() {
    color = vec4(1.0, 0.25, 0.0, 1.0);
}`;

const STORAGE_VERTEX_SOURCE = `#version 310 es
precision highp float;
layout(location = 0) in vec3 position;
void main() {
    gl_Position = vec4(position, 1.0);
}`;

const STORAGE_MODEL_VERTEX_SOURCE = `#version 310 es
precision highp float;
layout(std140) uniform ModelBlock {
    mat4 u_modelMatrix;
};
layout(location = 0) in vec3 position;
void main() {
    gl_Position = u_modelMatrix * vec4(position, 1.0);
}`;

const STORAGE_FRAGMENT_SOURCE = `#version 310 es
precision highp float;
layout(std430) readonly buffer SceneLightGrid {
    vec4 lights[];
} lightGrid;
layout(location = 0) out vec4 color;
void main() {
    color = lightGrid.lights[0];
}`;

const MATRIX_VERTEX_SOURCE = `#version 300 es
in vec3 position;
in mat2 planar;
in mat3 basis;
in mat4 transform;
void main() {
    vec2 planarPosition = planar * position.xy;
    vec3 localPosition = basis * vec3(planarPosition, position.z);
    gl_Position = transform * vec4(localPosition, 1.0);
}`;

const MRT_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
layout(location = 1) out vec4 emissive;
void main() {
    color = vec4(1.0, 0.25, 0.0, 1.0);
    emissive = vec4(0.0, 0.5, 1.0, 1.0);
}`;

const SPARSE_MRT_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
layout(location = 0) out vec4 color;
layout(location = 2) out vec4 emissive;
void main() {
    color = vec4(1.0, 0.25, 0.0, 1.0);
    emissive = vec4(0.0, 0.5, 1.0, 1.0);
}`;

function preparedInstanceCount(draw: PreparedDraw): number {
    return (
        Reflect.get(draw, 'drawArguments') as {
            readonly instanceCount: number;
        }
    ).instanceCount;
}

const TEXTURED_VERTEX_SOURCE = `#version 300 es
in vec3 position;
in vec2 texCoord;
out vec2 uv;
void main() {
    uv = texCoord;
    gl_Position = vec4(position, 1.0);
}`;

const TEXTURED_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D diffuseMap;
layout(location = 0) out vec4 color;
void main() {
    color = texture(diffuseMap, uv);
}`;

const ARRAY_TEXTURED_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D maps[2];
uniform highp sampler2DShadow shadowMaps[2];
layout(location = 0) out vec4 color;
void main() {
    float shadow = texture(shadowMaps[0], vec3(uv, 0.5))
        + texture(shadowMaps[1], vec3(uv, 0.5));
    color = texture(maps[0], uv) + texture(maps[1], uv) + vec4(shadow);
}`;

interface MeshFixture {
    readonly mesh: Mesh;
    readonly geometry: Geometry;
    readonly vertices: GeometryData;
    readonly material: ShaderMaterial;
}

interface ProcessorFixture {
    readonly backend: FakeRHIBackend;
    readonly device: FakeRHIDevice;
    readonly renderer: RendererCore;
    readonly frame: RenderGraphFrame;
    readonly processor: MeshDrawProcessor;
}

interface ExecutedMeshFrame {
    readonly result: RGExecutionResult;
    readonly draw: PreparedDraw;
}

interface MeshFrameSemanticOverrides {
    readonly camera?: PerspectiveCamera;
    readonly lightManager?: LightManager;
    readonly fog?: Fog | null;
}

type SkinStorage = 'float32' | 'uint8' | 'uint16';

interface MorphMeshFixture {
    readonly mesh: Mesh;
    readonly geometry: MorphGeometry;
    readonly material: BasicMaterial;
    readonly targets: readonly GeometryData[];
}

interface SkinnedMeshFixture {
    readonly mesh: SkinnedMesh;
    readonly geometry: Geometry;
    readonly material: BasicMaterial;
    readonly joint: Node;
    readonly skinIndices: GeometryData;
    readonly skinWeights: GeometryData;
}

interface LitMeshFixture {
    readonly mesh: Mesh;
    readonly geometry: Geometry;
    readonly material: BasicMaterial | PBRMaterial;
    readonly normals: GeometryData;
}

interface LightRig {
    readonly manager: LightManager;
    readonly ambient: AmbientLight;
    readonly directional: DirectionalLight;
    readonly point: PointLight;
    readonly spot: SpotLight;
    readonly area: AreaLight;
}

function createRenderer(): RendererCore {
    return {
        width: 8,
        height: 8,
        useLogDepth: false,
        forceMaterial: null,
        vertexPrecision: 'highp',
        fragmentPrecision: 'highp',
        getViewport: () => [0, 0, 8, 8]
    } as unknown as RendererCore;
}

function createMesh(
    indices?: Uint8Array | Uint8ClampedArray | Uint16Array | Uint32Array,
    fragmentSource = FRAGMENT_SOURCE,
    cullMode: 'none' | 'back' = 'none'
): MeshFixture {
    const vertices = new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3);
    const geometry = new Geometry({
        vertices,
        ...(indices === undefined ? {} : { indices: new GeometryData(indices, 1) })
    });
    const material = new ShaderMaterial({
        state: { depthTest: false, depthWrite: false, cullMode },
        attributes: { position: 'POSITION' },
        vs: VERTEX_SOURCE,
        fs: fragmentSource
    });
    return {
        mesh: new Mesh({ geometry, material }),
        geometry,
        vertices,
        material
    };
}

function createTexture(pixels: Uint8Array): Texture<Uint8Array> {
    return new Texture({
        image: pixels,
        target: TEXTURE_2D,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE,
        width: 1,
        height: 1
    });
}

function createTexturedMesh(): MeshFixture & {
    readonly texCoords: GeometryData;
    readonly texture: Texture<Uint8Array>;
} {
    const vertices = new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3);
    const texCoords = new GeometryData(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2);
    const texture = createTexture(new Uint8Array([255, 64, 32, 255]));
    const geometry = new Geometry({ vertices, uvs: texCoords });
    const material = new ShaderMaterial({
        state: { depthTest: false, depthWrite: false, cullMode: 'none' },
        attributes: { position: 'POSITION', texCoord: 'TEXCOORD_0' },
        uniforms: {
            diffuseMap: {
                get: () => texture
            }
        },
        vs: TEXTURED_VERTEX_SOURCE,
        fs: TEXTURED_FRAGMENT_SOURCE
    });
    return {
        mesh: new Mesh({ geometry, material }),
        geometry,
        vertices,
        texCoords,
        texture,
        material
    };
}

function createDeformationMaterial(): BasicMaterial {
    return new BasicMaterial({
        lightType: 'NONE',
        state: { depthTest: false, depthWrite: false, cullMode: 'none' }
    });
}

function createMorphMesh(): MorphMeshFixture {
    const vertices = new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3);
    const targets = [
        new GeometryData(new Float32Array([0.1, 0, 0, 0.1, 0, 0, 0.1, 0, 0]), 3),
        new GeometryData(new Float32Array([0, 0.2, 0, 0, 0.2, 0, 0, 0.2, 0]), 3)
    ] as const;
    const geometry = new MorphGeometry({
        vertices,
        weights: new Float32Array([0.25, 0.75]),
        targets: { vertices: [...targets] }
    });
    const material = createDeformationMaterial();
    return { mesh: new Mesh({ geometry, material }), geometry, material, targets };
}

function createSkinnedMesh(storage: SkinStorage): SkinnedMeshFixture {
    const vertices = new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3);
    const skinIndices = new GeometryData(
        storage === 'float32'
            ? new Float32Array(12)
            : storage === 'uint8'
              ? new Uint8Array(12)
              : new Uint16Array(12),
        4
    );
    const skinWeights = new GeometryData(
        storage === 'float32'
            ? new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])
            : storage === 'uint8'
              ? new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0])
              : new Uint16Array([65_535, 0, 0, 0, 65_535, 0, 0, 0, 65_535, 0, 0, 0]),
        4,
        { normalized: storage !== 'float32' }
    );
    const geometry = new Geometry({ vertices, skinIndices, skinWeights });
    const material = createDeformationMaterial();
    const joint = new Node();
    joint.updateMatrixWorld(true);
    const skeleton = new Skeleton({
        jointNodeList: [joint],
        jointNames: ['root'],
        inverseBindMatrices: [new Matrix4()]
    });
    const mesh = new SkinnedMesh({ geometry, material, skeleton });
    mesh.updateMatrixWorld(true);
    return { mesh, geometry, material, joint, skinIndices, skinWeights };
}

function createLitMaterial(
    kind: 'LAMBERT' | 'PHONG' | 'BLINN-PHONG' | 'PBR'
): BasicMaterial | PBRMaterial {
    const common = {
        state: { depthTest: false, depthWrite: false, cullMode: 'none' }
    } as const;
    if (kind === 'PBR') {
        return new PBRMaterial({
            ...common,
            baseColor: new Color(0.2, 0.4, 0.8, 1),
            metallic: 0.35,
            roughness: 0.65
        });
    }
    return new BasicMaterial({
        ...common,
        lightType: kind,
        diffuse: new Color(0.25, 0.5, 0.75, 1),
        ambient: new Color(0.1, 0.2, 0.3, 1),
        specular: new Color(0.8, 0.7, 0.6, 1),
        shininess: 24
    });
}

function createLitMesh(kind: 'LAMBERT' | 'PHONG' | 'BLINN-PHONG' | 'PBR'): LitMeshFixture {
    const vertices = new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3);
    const normals = new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3);
    const geometry = new Geometry({ vertices, normals });
    const material = createLitMaterial(kind);
    return { mesh: new Mesh({ geometry, material }), geometry, material, normals };
}

function createLightRig(): LightRig {
    const ambient = new AmbientLight({
        color: new Color(0.2, 0.4, 0.6),
        amount: 0.5
    });
    const directional = new DirectionalLight({
        color: new Color(0.5, 0.25, 1),
        amount: 2,
        direction: new Vector3(-1, -0.5, -0.25)
    });
    const point = new PointLight({
        color: new Color(0.25, 0.5, 0.75),
        amount: 0.4,
        range: 20
    });
    point.setPosition(2, 3, 4).updateMatrixWorld(true);
    const spot = new SpotLight({
        color: new Color(0.8, 0.4, 0.2),
        amount: 0.5,
        range: 30,
        cutoff: 20,
        outerCutoff: 30,
        direction: new Vector3(0, -1, -1)
    });
    spot.setPosition(-2, 5, 3).updateMatrixWorld(true);
    const area = new AreaLight({
        color: new Color(0.3, 0.6, 0.9),
        amount: 0.5,
        width: 4,
        height: 2
    });
    area.setPosition(1, 2, 3).updateMatrixWorld(true);
    directional.updateMatrixWorld(true);
    const manager = new LightManager();
    manager.addLight(ambient).addLight(directional).addLight(point).addLight(spot).addLight(area);
    return { manager, ambient, directional, point, spot, area };
}

function vertexFormatForInput(draw: PreparedDraw, name: string): RHIVertexFormat {
    const reflection = draw.pipeline.descriptor.vertex.shader.artifact.reflection.vertexInputs;
    const input = reflection?.find(candidate => candidate.name === name);
    if (input === undefined) throw new Error(`Prepared draw has no reflected input ${name}`);
    for (const layout of draw.pipeline.descriptor.vertex.buffers ?? []) {
        const attribute = layout?.attributes.find(
            candidate => candidate.shaderLocation === input.location
        );
        if (attribute !== undefined) return attribute.format;
    }
    throw new Error(`Prepared draw has no vertex layout for ${name}`);
}

function expectPreparedUniformBlock(
    fixture: ProcessorFixture,
    mesh: Mesh,
    material: BasicMaterial | PBRMaterial,
    blockName: 'SceneBlock' | 'LightBlock' | 'MaterialBlock' | 'MorphBlock' | 'SkinningBlock'
): { readonly cpu: ArrayBuffer; readonly gpu: FakeRHIBuffer } {
    const uniform = fixture.processor.uniformBlocks.resolveUniformBlock(blockName, mesh, material);
    const gpu = fixture.processor.buffers.resolveBuffer(uniform, 'uniform') as FakeRHIBuffer;
    const groupIndex =
        blockName === 'SceneBlock' || blockName === 'LightBlock'
            ? 0
            : blockName === 'MaterialBlock'
              ? 1
              : 2;
    const group = fixture.processor.bindGroups.resolveGroup(mesh, groupIndex);
    if (!group) throw new Error(`Prepared draw has no object bind group for ${blockName}`);
    expect(
        group.entries.some(entry => 'buffer' in entry.resource && entry.resource.buffer === gpu)
    ).toBe(true);
    expect(fixture.backend.executionLog).toContain(
        `bind-group:${String(groupIndex)}:${String(group.id)}`
    );
    return { cpu: uniform.data, gpu };
}

function firstFloats(buffer: ArrayBuffer | Uint8Array, count: number): number[] {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return [...new Float32Array(bytes.buffer, bytes.byteOffset, count)];
}

function uint16Values(buffer: FakeRHIBuffer, count: number): number[] {
    const bytes = buffer.snapshotBytes();
    return [...new Uint16Array(bytes.buffer, bytes.byteOffset, count)];
}

function blockFieldFloats(
    buffer: ArrayBuffer | Uint8Array,
    layout: Std140Layout,
    fieldName: string,
    count: number
): number[] {
    const field = layout.fields[fieldName];
    if (!field) throw new Error(`Uniform block does not contain ${fieldName}`);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + field.offset,
        Math.min(bytes.byteLength - field.offset, field.byteLength)
    );
    return Array.from({ length: count }, (_value, index) => view.getFloat32(index * 4, true));
}

function recordingWebGLContext(
    context: WebGL2RenderingContext,
    calls: string[]
): WebGL2RenderingContext {
    return new Proxy(context, {
        get(target, property) {
            const value: unknown = Reflect.get(target, property, target);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
                calls.push(String(property));
                return Reflect.apply(value, target, args) as unknown;
            };
        }
    });
}

function createTarget(colorFormat: RHITextureFormat = 'rgba8unorm'): RHIMeshDrawTargetDescriptor {
    return { colorFormats: [colorFormat], sampleCount: 1 };
}

function createContext(
    fixture: ProcessorFixture,
    frameIndex: number,
    device = fixture.device,
    overrides: MeshFrameSemanticOverrides = {}
) {
    return createRenderGraphFrameContext({
        renderer: fixture.renderer,
        rhi: device,
        frameIndex,
        camera: overrides.camera ?? new PerspectiveCamera(),
        lightManager: overrides.lightManager ?? new LightManager(),
        fog: overrides.fog ?? null,
        viewport: { x: 0, y: 0, width: 8, height: 8, minDepth: 0, maxDepth: 1 }
    });
}

async function createProcessorFixture(backend: FakeRHIBackend): Promise<ProcessorFixture> {
    const device = backend.createDevice();
    const renderer = createRenderer();
    const processor = new MeshDrawProcessor(renderer, device);
    await processor.initialize();
    return { backend, device, renderer, frame: new RenderGraphFrame(), processor };
}

function executeMeshFrame(
    fixture: ProcessorFixture,
    mesh: Mesh,
    frameIndex: number,
    target = createTarget(),
    device = fixture.device,
    overrides: MeshFrameSemanticOverrides = {}
): ExecutedMeshFrame {
    let prepared: PreparedDraw | undefined;
    const result = fixture.frame.execute(
        createContext(fixture, frameIndex, device, overrides),
        scope => {
            fixture.processor.beginFrame(scope.context, scope.uploads);
            prepared = fixture.processor.prepare(mesh, target);
            const pass = new SharedDrawPassParameters({
                colorAttachments: target.colorFormats.length,
                draws: 1
            });
            pass.label = 'MeshDrawProcessor test pass';
            pass.sideEffect = true;
            for (let index = 0; index < target.colorFormats.length; index += 1) {
                const format = target.colorFormats[index];
                if (format === null || format === undefined) {
                    throw new TypeError('The execution helper requires continuous color targets');
                }
                const color = scope.graph.createTexture(
                    `mesh processor test color ${String(index)}`,
                    {
                        size: { width: 8, height: 8 },
                        sampleCount: target.sampleCount,
                        format,
                        usage: RHITextureUsage.RENDER_ATTACHMENT
                    }
                );
                pass.addColorAttachment({
                    texture: color,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                });
            }
            const depthFormat = target.depthStencilFormat;
            if (depthFormat !== null && depthFormat !== undefined) {
                const depth = scope.graph.createTexture('mesh processor test depth', {
                    size: { width: 8, height: 8 },
                    sampleCount: target.sampleCount,
                    format: depthFormat,
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                });
                pass.setDepthStencilAttachment({
                    texture: depth,
                    ...(rhiTextureFormatHasDepth(depthFormat)
                        ? {
                              depthLoadOp: 'clear' as const,
                              depthStoreOp: 'store' as const,
                              depthClearValue: 1
                          }
                        : {}),
                    ...(rhiTextureFormatHasStencil(depthFormat)
                        ? {
                              stencilLoadOp: 'clear' as const,
                              stencilStoreOp: 'store' as const,
                              stencilClearValue: 0
                          }
                        : {})
                });
            }
            pass.addDraw(prepared);
            scope.graph.addPass(MainPassTemplate, pass);
        }
    );
    void fixture.processor.trackSubmission(frameIndex, result.submission);
    if (prepared === undefined) throw new Error('Mesh draw was not prepared');
    return { result, draw: prepared };
}

function executeStorageMeshPreparationFrame(
    fixture: ProcessorFixture,
    mesh: Mesh,
    frameIndex: number,
    shader: StorageGraphicsShader,
    pipelines: GPUDrivenPipelineResourceCache,
    plannerInstancedFallback = false,
    overrides: MeshFrameSemanticOverrides = {}
): ExecutedMeshFrame {
    let prepared: PreparedDraw | undefined;
    const result = fixture.frame.execute(
        createContext(fixture, frameIndex, fixture.device, overrides),
        scope => {
            fixture.processor.beginFrame(scope.context, scope.uploads);
            const preparation: StorageScenePreparationState = {
                globalBindGroupLayouts: []
            };
            prepared = fixture.processor.prepareStorageScene(
                mesh,
                createTarget(),
                shader,
                pipelines,
                preparation,
                null,
                plannerInstancedFallback
            );
            expect(preparation.globalBindGroupLayouts).toHaveLength(1);
        }
    );
    void fixture.processor.trackSubmission(frameIndex, result.submission);
    if (prepared === undefined) throw new Error('Storage scene mesh draw was not prepared');
    return { result, draw: prepared };
}

function executeInstanceBatchFrame(
    fixture: ProcessorFixture,
    owner: object,
    meshes: readonly Mesh[],
    frameIndex: number,
    target = createTarget(),
    device = fixture.device
): ExecutedMeshFrame {
    let prepared: PreparedDraw | undefined;
    const result = fixture.frame.execute(createContext(fixture, frameIndex, device), scope => {
        fixture.processor.beginFrame(scope.context, scope.uploads);
        prepared = fixture.processor.prepareInstancedBatch(owner, meshes, target);
        const pass = new SharedDrawPassParameters({
            colorAttachments: target.colorFormats.length,
            draws: 1
        });
        pass.label = 'MeshDrawProcessor instance test pass';
        pass.sideEffect = true;
        for (let index = 0; index < target.colorFormats.length; index += 1) {
            const format = target.colorFormats[index];
            if (format === null || format === undefined) {
                throw new TypeError('The execution helper requires continuous color targets');
            }
            const color = scope.graph.createTexture(
                `instance processor test color ${String(index)}`,
                {
                    size: { width: 8, height: 8 },
                    sampleCount: target.sampleCount,
                    format,
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                }
            );
            pass.addColorAttachment({
                texture: color,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 }
            });
        }
        const depthFormat = target.depthStencilFormat;
        if (depthFormat !== null && depthFormat !== undefined) {
            const depth = scope.graph.createTexture('instance processor test depth', {
                size: { width: 8, height: 8 },
                sampleCount: target.sampleCount,
                format: depthFormat,
                usage: RHITextureUsage.RENDER_ATTACHMENT
            });
            pass.setDepthStencilAttachment({
                texture: depth,
                ...(rhiTextureFormatHasDepth(depthFormat)
                    ? {
                          depthLoadOp: 'clear' as const,
                          depthStoreOp: 'store' as const,
                          depthClearValue: 1
                      }
                    : {}),
                ...(rhiTextureFormatHasStencil(depthFormat)
                    ? {
                          stencilLoadOp: 'clear' as const,
                          stencilStoreOp: 'store' as const,
                          stencilClearValue: 0
                      }
                    : {})
            });
        }
        pass.addDraw(prepared);
        scope.graph.addPass(MainPassTemplate, pass);
    });
    void fixture.processor.trackSubmission(frameIndex, result.submission);
    if (prepared === undefined) throw new Error('Instanced mesh draw was not prepared');
    return { result, draw: prepared };
}

async function finishSubmission(
    backend: FakeRHIBackend,
    execution: ExecutedMeshFrame
): Promise<void> {
    if (backend.executionMode === 'deferred') backend.completeNextSubmission();
    await execution.result.submission.done;
}

function destroyFixture(fixture: ProcessorFixture): void {
    fixture.processor.destroy();
    fixture.frame.destroy();
    fixture.backend.destroy();
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('MeshDrawProcessor on %s', (_name, createBackend) => {
    it('defers scene semantics until a resource-only frame needs mesh preparation', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const lightManager = new LightManager();
        const updateInfo = vi.spyOn(lightManager, 'updateInfo');
        const context = createContext(fixture, 1, fixture.device, { lightManager });
        const { mesh } = createMesh();
        const result = fixture.frame.execute(context, scope => {
            fixture.processor.beginResourceFrame(scope.context, scope.uploads);
            expect(updateInfo).not.toHaveBeenCalled();

            expect(() => {
                fixture.processor.beginContextPass(scope.context);
            }).toThrow(/requires scene semantics/u);
            expect(() => {
                fixture.processor.beginPass(scope.context.camera, scope.context.viewport);
            }).toThrow(/requires scene semantics/u);
            expect(() => {
                fixture.processor.prepare(mesh, createTarget());
            }).toThrow(/requires scene semantics/u);

            fixture.processor.beginSemanticFrame(scope.context);
            expect(updateInfo).toHaveBeenCalledTimes(1);

            fixture.processor.beginContextPass(scope.context);
            expect(updateInfo).toHaveBeenCalledTimes(2);
        });
        void fixture.processor.trackSubmission(1, result.submission);
        if (fixture.backend.executionMode === 'deferred') fixture.backend.completeNextSubmission();
        await result.submission.done;

        destroyFixture(fixture);
    });

    it('retries cleanly after resource-only semantic activation rolls back', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const lightManager = new LightManager();
        const updateInfo = vi.spyOn(lightManager, 'updateInfo').mockImplementationOnce(() => {
            throw new Error('semantic activation failed');
        });
        expect(() =>
            fixture.frame.execute(
                createContext(fixture, 1, fixture.device, { lightManager }),
                scope => {
                    fixture.processor.beginResourceFrame(scope.context, scope.uploads);
                    fixture.processor.beginSemanticFrame(scope.context);
                }
            )
        ).toThrow(/semantic activation failed/u);
        updateInfo.mockRestore();

        const retry = fixture.frame.execute(
            createContext(fixture, 2, fixture.device, { lightManager }),
            scope => {
                fixture.processor.beginFrame(scope.context, scope.uploads);
            }
        );
        void fixture.processor.trackSubmission(2, retry.submission);
        if (fixture.backend.executionMode === 'deferred') fixture.backend.completeNextSubmission();
        await retry.submission.done;

        destroyFixture(fixture);
    });

    it('reuses one Uint8 source as ordinary and widened Uint16 strip-restart data', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh, geometry } = createMesh(new Uint8Array([0, 1, 2, 0xff, 0, 2]));
        const indices = geometry.indices;
        if (!indices) throw new Error('Uint8 strip fixture requires indices');

        const ordinary = executeMeshFrame(fixture, mesh, 1);
        await finishSubmission(fixture.backend, ordinary);
        const ordinaryBuffer = fixture.processor.buffers.resolveBuffer(
            indices,
            'index'
        ) as FakeRHIBuffer;
        expect(ordinary.draw.pipeline.descriptor.primitive).toMatchObject({
            topology: 'triangle-list'
        });
        expect(ordinary.draw.pipeline.descriptor.primitive.stripIndexFormat).toBeUndefined();
        expect(uint16Values(ordinaryBuffer, indices.count)).toEqual([0, 1, 2, 0xff, 0, 2]);

        geometry.mode = TRIANGLE_STRIP;
        fixture.backend.resetExecutionLog();
        const strip = executeMeshFrame(fixture, mesh, 2);
        await finishSubmission(fixture.backend, strip);
        const restartBuffer = fixture.processor.buffers.resolveBuffer(indices, 'index', {
            primitiveRestart: true
        }) as FakeRHIBuffer;

        expect(restartBuffer).not.toBe(ordinaryBuffer);
        expect(strip.draw.pipeline.descriptor.primitive).toMatchObject({
            topology: 'triangle-strip',
            stripIndexFormat: 'uint16'
        });
        expect(uint16Values(restartBuffer, indices.count)).toEqual([0, 1, 2, 0xffff, 0, 2]);
        expect(fixture.backend.executionLog).toContain(
            `index-buffer:uint16:${String(restartBuffer.id)}`
        );
        expect(fixture.backend.executionLog).toContain('draw-indexed:6');

        destroyFixture(fixture);
    });

    it('records pipeline, binding, and vertex-input requests on every steady frame', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh } = createMesh();
        const metrics = [
            fixture.processor.pipelines.metrics,
            fixture.processor.bindGroups.metrics,
            fixture.processor.vertexInputCacheMetrics
        ] as const;
        const requestCounts = () => metrics.map(cache => cache.hits + cache.misses);

        const warmup = executeMeshFrame(fixture, mesh, 1);
        await finishSubmission(fixture.backend, warmup);
        const afterWarmup = requestCounts();

        const second = executeMeshFrame(fixture, mesh, 2);
        await finishSubmission(fixture.backend, second);
        const afterSecond = requestCounts();

        const third = executeMeshFrame(fixture, mesh, 3);
        await finishSubmission(fixture.backend, third);
        const afterThird = requestCounts();

        expect(afterSecond.map((count, index) => count - (afterWarmup[index] ?? 0))).toEqual([
            1, 1, 1
        ]);
        expect(afterThird.map((count, index) => count - (afterSecond[index] ?? 0))).toEqual([
            1, 1, 1
        ]);
        expect(metrics.map(cache => cache.hits)).toEqual([2, 2, 2]);

        destroyFixture(fixture);
    });

    it('carries public mat2/mat3/mat4 GeometryData through physical RHI vertex columns', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const vertices = new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3);
        const planar = new GeometryData(new Float32Array(12).fill(1), 4);
        const basis = new GeometryData(new Float32Array(27).fill(1), 9);
        const transform = new GeometryData(new Float32Array(48).fill(1), 16);
        const geometry = new Geometry({ vertices });
        const material = new ShaderMaterial({
            state: { depthTest: false, depthWrite: false, cullMode: 'none' },
            attributes: {
                position: 'POSITION',
                planar: { get: () => planar },
                basis: { get: () => basis },
                transform: { get: () => transform }
            },
            vs: MATRIX_VERTEX_SOURCE,
            fs: FRAGMENT_SOURCE
        });
        const execution = executeMeshFrame(fixture, new Mesh({ geometry, material }), 1);
        await finishSubmission(fixture.backend, execution);

        expect(execution.draw.pipeline.descriptor.vertex.buffers).toEqual([
            {
                arrayStride: 12,
                stepMode: 'vertex',
                attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }]
            },
            {
                arrayStride: 16,
                stepMode: 'vertex',
                attributes: [
                    { format: 'float32x2', offset: 0, shaderLocation: 1 },
                    { format: 'float32x2', offset: 8, shaderLocation: 2 }
                ]
            },
            {
                arrayStride: 36,
                stepMode: 'vertex',
                attributes: [
                    { format: 'float32x3', offset: 0, shaderLocation: 3 },
                    { format: 'float32x3', offset: 12, shaderLocation: 4 },
                    { format: 'float32x3', offset: 24, shaderLocation: 5 }
                ]
            },
            {
                arrayStride: 64,
                stepMode: 'vertex',
                attributes: [
                    { format: 'float32x4', offset: 0, shaderLocation: 6 },
                    { format: 'float32x4', offset: 16, shaderLocation: 7 },
                    { format: 'float32x4', offset: 32, shaderLocation: 8 },
                    { format: 'float32x4', offset: 48, shaderLocation: 9 }
                ]
            }
        ]);
        expect(
            execution.draw.pipeline.descriptor.vertex.shader.artifact.reflection.vertexInputs
        ).toEqual([
            { location: 0, name: 'position' },
            { location: 1, name: 'planar' },
            { location: 2 },
            { location: 3, name: 'basis' },
            { location: 4 },
            { location: 5 },
            { location: 6, name: 'transform' },
            { location: 7 },
            { location: 8 },
            { location: 9 }
        ]);
        expect(execution.result.diagnostics.drawCount).toBe(1);

        destroyFixture(fixture);
    });

    it('drives the production ForwardRenderer Mesh entry point through present', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh } = createMesh();
        const surface = fixture.device.createSurface({ width: 0, height: 0 } as HTMLCanvasElement);
        surface.configure({
            width: 8,
            height: 8,
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const forward = new ForwardRenderer(1);

        const result = forward.render(createContext(fixture, 1), surface, {
            meshProcessor: fixture.processor,
            classifiedMeshes: [mesh]
        });
        if (fixture.backend.executionMode === 'deferred') fixture.backend.completeNextSubmission();
        await result.submission.done;

        expect(result.diagnostics.drawCount).toBe(1);
        expect(fixture.backend.executionLog).toContain('draw:3');
        expect(fixture.backend.executionLog.at(-1)).toBe(`present:${String(surface.id)}`);
        expect(fixture.processor.submissions.completedFrame).toBe(1);
        expect(fixture.processor.submissions.pendingSubmissionCount).toBe(0);

        forward.destroy();
        destroyFixture(fixture);
    });

    it('maps built-in attachment zero and reflected ShaderMaterial outputs onto MRT', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const target: RHIMeshDrawTargetDescriptor = {
            colorFormats: ['rgba8unorm', 'rgba16float'],
            sampleCount: 1
        };
        const builtIn = createLitMesh('LAMBERT');
        const builtInExecution = executeMeshFrame(fixture, builtIn.mesh, 1, target);
        await finishSubmission(fixture.backend, builtInExecution);
        expect(builtInExecution.draw.pipeline.descriptor.fragment?.targets).toEqual([
            expect.objectContaining({ format: 'rgba8unorm', writeMask: 0xf }),
            expect.objectContaining({ format: 'rgba16float', writeMask: 0 })
        ]);
        expect(
            builtInExecution.draw.pipeline.descriptor.fragment?.shader.artifact.reflection
                .fragmentOutputs
        ).toEqual([{ location: 0, name: 'hilo_FragColor' }]);

        const custom = createMesh(undefined, MRT_FRAGMENT_SOURCE);
        const customExecution = executeMeshFrame(fixture, custom.mesh, 2, target);
        await finishSubmission(fixture.backend, customExecution);
        expect(
            customExecution.draw.pipeline.descriptor.fragment?.shader.artifact.reflection
                .fragmentOutputs
        ).toEqual([
            { location: 0, name: 'color' },
            { location: 1, name: 'emissive' }
        ]);
        expect(customExecution.draw.pipeline.descriptor.fragment?.targets).toEqual([
            expect.objectContaining({ format: 'rgba8unorm', writeMask: 0xf }),
            expect.objectContaining({ format: 'rgba16float', writeMask: 0xf })
        ]);
        expect(customExecution.result.diagnostics.drawCount).toBe(1);

        const sparse = createMesh(undefined, SPARSE_MRT_FRAGMENT_SOURCE);
        let sparseDraw: PreparedDraw | undefined;
        const sparseFrame = fixture.frame.execute(createContext(fixture, 3), scope => {
            fixture.processor.beginFrame(scope.context, scope.uploads);
            sparseDraw = fixture.processor.prepare(sparse.mesh, {
                colorFormats: ['rgba8unorm', null, 'rgba16float'],
                sampleCount: 1
            });
        });
        void fixture.processor.trackSubmission(3, sparseFrame.submission);
        if (fixture.backend.executionMode === 'deferred') fixture.backend.completeNextSubmission();
        await sparseFrame.submission.done;
        expect(sparseDraw?.pipeline.descriptor.fragment?.targets).toEqual([
            expect.objectContaining({ format: 'rgba8unorm', writeMask: 0xf }),
            null,
            expect.objectContaining({ format: 'rgba16float', writeMask: 0xf })
        ]);

        const invalidTarget: RHIMeshDrawTargetDescriptor = {
            colorFormats: ['rgba8unorm', null],
            sampleCount: 1
        };
        const beginFrame = vi.spyOn(fixture.device.graphicsQueue, 'beginFrame');
        expect(() =>
            fixture.frame.execute(createContext(fixture, 4), scope => {
                fixture.processor.beginFrame(scope.context, scope.uploads);
                fixture.processor.prepare(custom.mesh, invalidTarget);
            })
        ).toThrow(/output location 1 has no mesh color target/u);
        expect(beginFrame).not.toHaveBeenCalled();

        destroyFixture(fixture);
    });

    it('uses renderer.forceMaterial for ordinary pure-depth draws', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const source = createMesh();
        const forcedMaterial = new ShaderMaterial({
            state: { depthTest: false, depthWrite: false, cullMode: 'none' },
            attributes: { position: 'POSITION' },
            roles: [
                {
                    role: 'depth-only',
                    vertexSource: VERTEX_SOURCE,
                    fragmentSource: FRAGMENT_SOURCE,
                    fragmentOutput: 'depth-only'
                }
            ],
            vs: VERTEX_SOURCE,
            fs: FRAGMENT_SOURCE
        });
        source.mesh.material = null;
        fixture.renderer.forceMaterial = forcedMaterial;
        const getShader = vi.spyOn(Shader, 'getShader');
        const execution = executeMeshFrame(fixture, source.mesh, 1, {
            colorFormats: [],
            depthStencilFormat: 'depth24plus',
            sampleCount: 1
        });
        await finishSubmission(fixture.backend, execution);

        expect(getShader).toHaveBeenCalledWith(
            source.mesh,
            forcedMaterial,
            false,
            expect.any(LightManager),
            null,
            false,
            fixture.renderer,
            false,
            'depth-only',
            false
        );
        expect(execution.draw.pipeline.descriptor.fragment?.targets).toEqual([]);
        expect(
            execution.draw.pipeline.descriptor.fragment?.shader.artifact.reflection.fragmentOutputs
        ).toEqual([]);
        expect(execution.draw.pipeline.descriptor.depthStencil).toMatchObject({
            format: 'depth24plus',
            depthWriteEnabled: true
        });
        expect(execution.result.diagnostics.drawCount).toBe(1);

        fixture.renderer.forceMaterial = null;
        destroyFixture(fixture);
    });

    it('prepares one real instanced shader draw with backend-specific built-in resources', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const source = createLitMesh('LAMBERT');
        source.mesh.useInstanced = true;
        source.mesh.updateMatrixWorld(true);
        const second = new Mesh({
            geometry: source.geometry,
            material: source.material,
            useInstanced: true
        });
        second.setPosition(2, 0, 0).updateMatrixWorld(true);
        const owner = {};

        const first = executeInstanceBatchFrame(fixture, owner, [source.mesh, second], 1);
        await finishSubmission(fixture.backend, first);
        expect(first.result.diagnostics.drawCount).toBe(1);
        expect(preparedInstanceCount(first.draw)).toBe(2);
        const layouts = first.draw.pipeline.descriptor.vertex.buffers ?? [];
        const bindings = first.draw.pipeline.descriptor.vertex.shader.artifact.reflection.bindings;
        if (fixture.device.backend === 'webgl2') {
            const instanceLayout = layouts.find(layout => layout?.stepMode === 'instance');
            expect(instanceLayout).toBeDefined();
            expect(instanceLayout?.attributes).toHaveLength(7);
            expect(
                first.draw.pipeline.descriptor.vertex.shader.artifact.reflection.vertexInputs?.map(
                    input => input.name
                )
            ).toEqual(expect.arrayContaining(['u_modelMatrix', 'u_normalWorldMatrix']));
            expect(bindings.some(binding => binding.name === 'InstanceBlock')).toBe(false);
        } else {
            expect(layouts.some(layout => layout?.stepMode === 'instance')).toBe(false);
            expect(bindings.some(binding => binding.name === 'InstanceBlock')).toBe(true);
        }
        expect(fixture.processor.instances.diagnostics.activeOwnerCount).toBe(1);

        fixture.backend.resetExecutionLog();
        const steady = executeInstanceBatchFrame(fixture, owner, [source.mesh, second], 2);
        await finishSubmission(fixture.backend, steady);
        expect(steady.draw).toBe(first.draw);
        expect(steady.result.diagnostics.drawCount).toBe(1);
        expect(fixture.processor.detachInstanceBatch(owner)).toBeGreaterThan(0);
        destroyFixture(fixture);
    });

    it('uses a forced material for an instanced pure-depth batch', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const source = createMesh();
        source.mesh.useInstanced = true;
        const second = new Mesh({
            geometry: source.geometry,
            material: source.material,
            useInstanced: true
        });
        const forcedMaterial = new ShaderMaterial({
            state: { depthTest: true, depthWrite: true, cullMode: 'none' },
            attributes: { position: 'POSITION' },
            roles: [
                {
                    role: 'depth-only',
                    vertexSource: VERTEX_SOURCE,
                    fragmentSource: FRAGMENT_SOURCE,
                    fragmentOutput: 'depth-only'
                }
            ],
            vs: VERTEX_SOURCE,
            fs: FRAGMENT_SOURCE
        });
        fixture.renderer.forceMaterial = forcedMaterial;
        const owner = {};
        const execution = executeInstanceBatchFrame(fixture, owner, [source.mesh, second], 1, {
            colorFormats: [],
            depthStencilFormat: 'depth24plus',
            sampleCount: 1
        });
        await finishSubmission(fixture.backend, execution);

        expect(preparedInstanceCount(execution.draw)).toBe(2);
        expect(execution.draw.pipeline.descriptor.fragment?.targets).toEqual([]);
        expect(
            execution.draw.pipeline.descriptor.fragment?.shader.artifact.reflection.fragmentOutputs
        ).toEqual([]);
        expect(execution.draw.pipeline.descriptor.depthStencil?.format).toBe('depth24plus');
        expect(execution.result.diagnostics.drawCount).toBe(1);

        fixture.renderer.forceMaterial = null;
        destroyFixture(fixture);
    });

    it('reflects and uploads a custom mesh-dependent instance stream on both backends', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const vertices = new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3);
        const geometry = new Geometry({ vertices });
        const values = new WeakMap<Mesh, number>();
        const material = new ShaderMaterial({
            state: { depthTest: false, depthWrite: false, cullMode: 'none' },
            attributes: { position: 'POSITION' },
            uniforms: {
                u_modelMatrix: {
                    isDependMesh: true,
                    get(mesh): Matrix4 {
                        return mesh.worldMatrix;
                    }
                },
                u_normalWorldMatrix: {
                    isDependMesh: true,
                    get(mesh): Matrix4 {
                        return mesh.worldMatrix;
                    }
                },
                i_value: {
                    isDependMesh: true,
                    get(mesh): number {
                        return values.get(mesh) ?? 0;
                    }
                }
            },
            vs: `#version 300 es
#ifdef HILO_WEBGPU
layout(std140) uniform InstanceBlock {
    mat4 u_instanceModelMatrices[128];
    mat4 u_instanceNormalMatrices[128];
};
#define u_modelMatrix u_instanceModelMatrices[gl_InstanceIndex]
#define u_normalWorldMatrix mat3(u_instanceNormalMatrices[gl_InstanceIndex])
#else
in mat4 u_modelMatrix;
in mat3 u_normalWorldMatrix;
#endif
in vec3 position;
in float i_value;
void main() {
    vec3 offset = u_normalWorldMatrix * vec3(i_value, 0.0, 0.0);
    gl_Position = u_modelMatrix * vec4(position + offset, 1.0);
}`,
            fs: FRAGMENT_SOURCE
        });
        const firstMesh = new Mesh({ geometry, material, useInstanced: true });
        const secondMesh = new Mesh({ geometry, material, useInstanced: true });
        firstMesh.updateMatrixWorld(true);
        secondMesh.updateMatrixWorld(true);
        values.set(firstMesh, 0.25);
        values.set(secondMesh, 0.75);
        const owner = {};

        const execution = executeInstanceBatchFrame(fixture, owner, [firstMesh, secondMesh], 1);
        await finishSubmission(fixture.backend, execution);
        const instanceLayout = execution.draw.pipeline.descriptor.vertex.buffers?.find(
            layout => layout?.stepMode === 'instance'
        );
        expect(instanceLayout).toBeDefined();
        expect(instanceLayout?.attributes).toHaveLength(
            fixture.device.backend === 'webgl2' ? 8 : 1
        );
        expect(
            execution.draw.pipeline.descriptor.vertex.shader.artifact.reflection.bindings.some(
                binding => binding.name === 'InstanceBlock'
            )
        ).toBe(fixture.device.backend === 'webgpu');
        expect(execution.result.diagnostics.drawCount).toBe(1);
        expect(preparedInstanceCount(execution.draw)).toBe(2);

        fixture.processor.detachInstanceBatch(owner);
        destroyFixture(fixture);
    });

    it('recovers and resets batch-local resources without replacing the PreparedDraw owner', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const source = createLitMesh('LAMBERT');
        source.mesh.useInstanced = true;
        source.mesh.updateMatrixWorld(true);
        const second = new Mesh({
            geometry: source.geometry,
            material: source.material,
            useInstanced: true
        });
        second.setPosition(1, 0, 0).updateMatrixWorld(true);
        const owner = {};
        const first = executeInstanceBatchFrame(fixture, owner, [source.mesh, second], 1);
        await finishSubmission(fixture.backend, first);
        const originalPipeline = first.draw.pipeline;
        const replacement = fixture.backend.createDevice();

        fixture.processor.recover(replacement);
        const recovered = executeInstanceBatchFrame(
            fixture,
            owner,
            [source.mesh, second],
            2,
            createTarget(),
            replacement
        );
        await finishSubmission(fixture.backend, recovered);
        expect(recovered.draw).toBe(first.draw);
        expect(recovered.draw.pipeline).not.toBe(originalPipeline);
        expect(preparedInstanceCount(recovered.draw)).toBe(2);

        expect(fixture.processor.resetInstanceBatches()).toBeGreaterThan(0);
        expect(fixture.processor.instances.diagnostics.activeOwnerCount).toBe(0);
        destroyFixture(fixture);
    });

    it('emits matching non-indexed and indexed draw commands', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const nonIndexed = createMesh();
        const indexed = createMesh(new Uint32Array([0, 1, 2]));

        const first = executeMeshFrame(fixture, nonIndexed.mesh, 1);
        await finishSubmission(fixture.backend, first);
        expect(fixture.backend.executionLog).toContain('draw:3');
        expect(fixture.backend.executionLog.some(command => command.startsWith('pipeline:'))).toBe(
            true
        );
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('vertex-buffer:0:'))
        ).toBe(true);
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('index-buffer:'))
        ).toBe(false);

        fixture.backend.resetExecutionLog();
        const second = executeMeshFrame(fixture, indexed.mesh, 2);
        await finishSubmission(fixture.backend, second);
        expect(fixture.backend.executionLog).toContain('draw-indexed:3');
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('index-buffer:uint32:'))
        ).toBe(true);
        expect(fixture.backend.executionLog).not.toContain('draw:3');

        destroyFixture(fixture);
    });

    it('prepares multiple vertex streams and a sampled texture through one shared draw', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh, material, texture } = createTexturedMesh();
        const createPipeline = vi.spyOn(fixture.device, 'createGraphicsPipeline');
        const execution = executeMeshFrame(fixture, mesh, 1);
        await finishSubmission(fixture.backend, execution);
        const pipeline = execution.draw.pipeline;

        expect(fixture.processor.sampledGraphDependencies).toEqual([]);

        const descriptor = createPipeline.mock.calls[0]?.[0];
        expect(descriptor?.vertex.buffers).toHaveLength(2);
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('vertex-buffer:0:'))
        ).toBe(true);
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('vertex-buffer:1:'))
        ).toBe(true);
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('bind-group:1:'))
        ).toBe(true);
        expect([
            ...(
                fixture.processor.textures.resolveTexture(texture) as FakeRHITexture
            ).snapshotLastWriteBytes()
        ]).toEqual([255, 64, 32, 255]);
        expect(fixture.processor.textures.diagnostics(texture)?.committedRevision).toBe(
            texture.updateRevision
        );

        fixture.backend.resetExecutionLog();
        const steady = executeMeshFrame(fixture, mesh, 2);
        await finishSubmission(fixture.backend, steady);
        expect(steady.draw).toBe(execution.draw);
        expect(createPipeline).toHaveBeenCalledTimes(1);
        expect(
            fixture.backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toEqual([]);

        const originalTexture = fixture.processor.textures.resolveTexture(
            texture
        ) as FakeRHITexture;
        const replacement = createTexture(new Uint8Array([8, 16, 32, 255]));
        material.uniforms['diffuseMap'] = { get: () => replacement };
        fixture.backend.resetExecutionLog();
        const rebound = executeMeshFrame(fixture, mesh, 3);
        await finishSubmission(fixture.backend, rebound);
        expect(rebound.draw).toBe(execution.draw);
        expect(rebound.draw.pipeline).toBe(pipeline);
        expect(createPipeline).toHaveBeenCalledTimes(1);
        expect(fixture.processor.textures.diagnostics(texture)).toBeNull();
        expect(originalTexture.destroyed).toBe(true);
        expect([
            ...(
                fixture.processor.textures.resolveTexture(replacement) as FakeRHITexture
            ).snapshotLastWriteBytes()
        ]).toEqual([8, 16, 32, 255]);

        destroyFixture(fixture);
    });

    it('binds sampler-array elements and numeric depth specialization without per-element resolves', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh, texture } = createTexturedMesh();
        const depthIdentity = createTexture(new Uint8Array([0, 0, 0, 255]));
        const targets = new RenderTargetResourceCache(fixture.processor.registry);
        const depthTarget = targets.prepare(
            {},
            {
                width: 8,
                height: 8,
                colorFormats: [],
                depthStencilFormat: 'depth24plus',
                depthStencilSampled: true
            }
        );
        const depthView = depthTarget.depthStencilAttachment?.sampledView;
        if (depthView === null || depthView === undefined) {
            throw new Error('Sampler-array fixture requires a sampled depth view');
        }
        const ordinarySampler = fixture.processor.registry.registerSampler({
            minFilter: 'nearest',
            magFilter: 'nearest',
            mipmapFilter: 'nearest'
        });
        const comparisonSampler = fixture.processor.registry.registerSampler({
            minFilter: 'nearest',
            magFilter: 'nearest',
            mipmapFilter: 'nearest',
            compare: 'less'
        });
        const unregister = externalTextureBindingRegistry.register(depthIdentity, {
            resolve: samplerKind => ({
                textureView: depthView,
                sampler: samplerKind === 'comparison-sampler' ? comparisonSampler : ordinarySampler
            })
        });
        let mapValues: readonly Texture<unknown>[] = [texture, depthIdentity];
        const shadowValues: readonly Texture<unknown>[] = [depthIdentity, depthIdentity];
        const resolveMaps = vi.fn(() => mapValues);
        const resolveShadows = vi.fn(() => shadowValues);
        const material = new ShaderMaterial({
            state: { depthTest: false, depthWrite: false, cullMode: 'none' },
            attributes: { position: 'POSITION', texCoord: 'TEXCOORD_0' },
            uniforms: {
                maps: { get: resolveMaps },
                shadowMaps: { get: resolveShadows }
            },
            vs: TEXTURED_VERTEX_SOURCE,
            fs: ARRAY_TEXTURED_FRAGMENT_SOURCE
        });
        mesh.material = material;

        const first = executeMeshFrame(fixture, mesh, 1);
        await finishSubmission(fixture.backend, first);
        const fragmentBindings =
            first.draw.pipeline.descriptor.fragment?.shader.artifact.reflection.bindings ?? [];
        expect(fragmentBindings).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'maps',
                    arrayIndex: 0,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                }),
                expect.objectContaining({
                    name: 'maps',
                    arrayIndex: 1,
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                }),
                expect.objectContaining({
                    name: 'shadowMaps',
                    arrayIndex: 0,
                    kind: 'comparison-sampler'
                }),
                expect.objectContaining({
                    name: 'shadowMaps',
                    arrayIndex: 1,
                    kind: 'comparison-sampler'
                })
            ])
        );
        expect(resolveMaps).toHaveBeenCalledTimes(2);
        expect(resolveShadows).toHaveBeenCalledTimes(1);

        const firstGroup = fixture.processor.bindGroups.resolveGroup(mesh, 1);
        if (firstGroup === null) throw new Error('Sampler-array fixture lost material bind group');
        const resourceAt = (binding: number) =>
            firstGroup.entries.find(entry => entry.binding === binding)?.resource;
        expect(resourceAt(2)).toBe(fixture.processor.textures.resolveView(texture));
        expect(resourceAt(4)).toBe(fixture.processor.registry.resolve(depthView));
        expect(resourceAt(5)).toBe(fixture.processor.registry.resolve(ordinarySampler));
        expect(resourceAt(6)).toBe(fixture.processor.registry.resolve(depthView));
        expect(resourceAt(7)).toBe(fixture.processor.registry.resolve(comparisonSampler));
        expect(resourceAt(8)).toBe(fixture.processor.registry.resolve(depthView));
        expect(resourceAt(9)).toBe(fixture.processor.registry.resolve(comparisonSampler));

        const steady = executeMeshFrame(fixture, mesh, 2);
        await finishSubmission(fixture.backend, steady);
        expect(steady.draw).toBe(first.draw);
        expect(steady.draw.pipeline).toBe(first.draw.pipeline);
        expect(fixture.processor.bindGroups.resolveGroup(mesh, 1)).toBe(firstGroup);
        expect(resolveMaps).toHaveBeenCalledTimes(4);
        expect(resolveShadows).toHaveBeenCalledTimes(2);

        const replacement = createTexture(new Uint8Array([16, 32, 64, 255]));
        mapValues = [replacement, depthIdentity];
        const rebound = executeMeshFrame(fixture, mesh, 3);
        await finishSubmission(fixture.backend, rebound);
        const reboundGroup = fixture.processor.bindGroups.resolveGroup(mesh, 1);
        if (reboundGroup === null)
            throw new Error('Sampler-array rebound lost material bind group');
        expect(rebound.draw.pipeline).toBe(first.draw.pipeline);
        expect(reboundGroup).not.toBe(firstGroup);
        expect(reboundGroup.entries.find(entry => entry.binding === 2)?.resource).toBe(
            fixture.processor.textures.resolveView(replacement)
        );
        expect(reboundGroup.entries.find(entry => entry.binding === 4)?.resource).toBe(
            fixture.processor.registry.resolve(depthView)
        );

        unregister();
        fixture.processor.detachMesh(mesh);
        targets.destroy();
        fixture.processor.registry.release(ordinarySampler);
        fixture.processor.registry.release(comparisonSampler);
        fixture.processor.registry.collect(Number.MAX_SAFE_INTEGER);
        destroyFixture(fixture);
    });

    it('collects, deduplicates, and clears public render-target dependencies per pass and frame', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh, texture } = createTexturedMesh();
        const resources = new RenderTargetResourceCache(fixture.processor.registry);
        const record = resources.prepare({}, { width: 8, height: 8, colorFormats: ['rgba8unorm'] });
        const color = record.colorAttachments[0];
        if (color === undefined) throw new Error('Dependency target color is missing');
        const sampler = fixture.processor.registry.registerSampler({
            minFilter: 'nearest',
            magFilter: 'nearest',
            mipmapFilter: 'nearest'
        });
        const graphDependency = Object.freeze({
            record,
            attachment: 'color' as const,
            attachmentIndex: 0
        });
        const sampledResources = {
            textureView: color.readableView,
            sampler
        };
        const unregister = externalTextureBindingRegistry.register(texture, {
            graphDependency,
            resolve: () => sampledResources
        });

        const run = (frameIndex: number, expectStaleDependency: boolean): ExecutedMeshFrame => {
            let prepared!: PreparedDraw;
            const result = fixture.frame.execute(createContext(fixture, frameIndex), scope => {
                expect(fixture.processor.sampledGraphDependencies).toEqual(
                    expectStaleDependency ? [graphDependency] : []
                );
                fixture.processor.beginFrame(scope.context, scope.uploads);
                expect(fixture.processor.sampledGraphDependencies).toEqual([]);
                prepared = fixture.processor.prepare(mesh, createTarget());
                fixture.processor.prepare(mesh, createTarget());
                expect(fixture.processor.sampledGraphDependencies).toEqual([graphDependency]);
                if (frameIndex === 1) {
                    fixture.processor.beginPass(scope.context.camera, scope.context.viewport);
                    expect(fixture.processor.sampledGraphDependencies).toEqual([]);
                    prepared = fixture.processor.prepare(mesh, createTarget());
                    expect(fixture.processor.sampledGraphDependencies).toEqual([graphDependency]);
                }
                const output = scope.graph.createTexture('dependency collection output', {
                    size: { width: 8, height: 8 },
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                });
                const pass = new SharedDrawPassParameters({ colorAttachments: 1, draws: 1 });
                pass.sideEffect = true;
                pass.addColorAttachment({
                    texture: output,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                });
                pass.addDraw(prepared);
                scope.graph.addPass(MainPassTemplate, pass);
            });
            void fixture.processor.trackSubmission(frameIndex, result.submission);
            return { result, draw: prepared };
        };

        const first = run(1, false);
        await finishSubmission(fixture.backend, first);
        const second = run(2, true);
        await finishSubmission(fixture.backend, second);

        unregister();
        fixture.processor.detachMesh(mesh);
        resources.destroy();
        fixture.processor.registry.release(sampler);
        fixture.processor.registry.collect(Number.MAX_SAFE_INTEGER);
        destroyFixture(fixture);
    });

    it('prepares real morph attributes and MorphBlock through the shared PreparedDraw', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh, geometry, material, targets } = createMorphMesh();
        const compile = vi.spyOn(fixture.processor.compiler, 'compile');
        const execution = executeMeshFrame(fixture, mesh, 1);
        await finishSubmission(fixture.backend, execution);

        const compiled = compile.mock.results.at(-1)?.value as
            CompiledShaderArtifactPair | undefined;
        if (!compiled) throw new Error('Morph shader was not compiled');
        expect(compiled.metadata.vertexInputs.map(input => input.name)).toEqual(
            expect.arrayContaining(['a_position', 'a_morphPosition0', 'a_morphPosition1'])
        );
        expect(execution.draw.pipeline.descriptor.vertex.buffers).toHaveLength(3);
        expect(vertexFormatForInput(execution.draw, 'a_morphPosition0')).toBe('float32x3');
        expect(vertexFormatForInput(execution.draw, 'a_morphPosition1')).toBe('float32x3');
        expect(
            execution.draw.pipeline.descriptor.vertex.shader.artifact.reflection.bindings.map(
                binding => binding.name
            )
        ).toContain('MorphBlock');
        for (const target of targets) {
            expect(fixture.processor.buffers.diagnostics(target, 'vertex')).not.toBeNull();
        }
        const morph = expectPreparedUniformBlock(fixture, mesh, material, 'MorphBlock');
        expect(firstFloats(morph.cpu, 8)).toEqual([0.25, 0.75, 0, 0, 0, 0, 0, 0]);
        expect(firstFloats(morph.gpu.snapshotBytes(), 8)).toEqual([0.25, 0.75, 0, 0, 0, 0, 0, 0]);

        const initialPipeline = execution.draw.pipeline;
        const weights = geometry.weights;
        if (!(weights instanceof Float32Array)) throw new Error('Morph test lost typed weights');
        weights[0] = 0.625;
        weights[1] = 0.375;
        fixture.backend.resetExecutionLog();
        const animated = executeMeshFrame(fixture, mesh, 2);
        await finishSubmission(fixture.backend, animated);
        expect(animated.draw).toBe(execution.draw);
        expect(animated.draw.pipeline).toBe(initialPipeline);
        expect(firstFloats(morph.gpu.snapshotBytes(), 8)).toEqual([0.625, 0.375, 0, 0, 0, 0, 0, 0]);

        destroyFixture(fixture);
    });

    it.each([
        ['float32', 'float32x4', 'float32x4', 'vec4'],
        ['uint8', 'uint8x4', 'unorm8x4', 'uvec4'],
        ['uint16', 'uint16x4', 'unorm16x4', 'uvec4']
    ] as const)(
        'prepares real %s skinning streams and SkinningBlock through the shared PreparedDraw',
        async (storage, indexFormat, weightFormat, shaderType) => {
            const fixture = await createProcessorFixture(createBackend());
            const { mesh, material, joint, skinIndices, skinWeights } = createSkinnedMesh(storage);
            const compile = vi.spyOn(fixture.processor.compiler, 'compile');
            const execution = executeMeshFrame(fixture, mesh, 1);
            await finishSubmission(fixture.backend, execution);

            const compiled = compile.mock.results.at(-1)?.value as
                CompiledShaderArtifactPair | undefined;
            if (!compiled) throw new Error('Skinning shader was not compiled');
            expect(mesh.geometry?.getShaderKey().includes('SKIN_INDICES_UINT')).toBe(
                storage !== 'float32'
            );
            expect(
                compiled.metadata.vertexInputs.find(input => input.name === 'a_skinIndices')?.type
            ).toBe(shaderType);
            expect(
                compiled.metadata.vertexInputs.find(input => input.name === 'a_skinWeights')?.type
            ).toBe('vec4');
            expect(vertexFormatForInput(execution.draw, 'a_skinIndices')).toBe(indexFormat);
            expect(vertexFormatForInput(execution.draw, 'a_skinWeights')).toBe(weightFormat);
            expect(execution.draw.pipeline.descriptor.vertex.buffers).toHaveLength(3);
            expect(
                execution.draw.pipeline.descriptor.vertex.shader.artifact.reflection.bindings.map(
                    binding => binding.name
                )
            ).toContain('SkinningBlock');
            expect(fixture.processor.buffers.diagnostics(skinIndices, 'vertex')).not.toBeNull();
            expect(fixture.processor.buffers.diagnostics(skinWeights, 'vertex')).not.toBeNull();
            const skinning = expectPreparedUniformBlock(fixture, mesh, material, 'SkinningBlock');
            expect(firstFloats(skinning.gpu.snapshotBytes(), 16)).toEqual([
                1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
            ]);

            if (storage === 'float32') {
                const initialPipeline = execution.draw.pipeline;
                joint.x = 2;
                joint.updateMatrixWorld(true);
                fixture.backend.resetExecutionLog();
                const animated = executeMeshFrame(fixture, mesh, 2);
                await finishSubmission(fixture.backend, animated);
                expect(animated.draw).toBe(execution.draw);
                expect(animated.draw.pipeline).toBe(initialPipeline);
                expect(firstFloats(skinning.gpu.snapshotBytes(), 16)[12]).toBe(2);
            }

            destroyFixture(fixture);
        }
    );

    it.each(['LAMBERT', 'PHONG', 'BLINN-PHONG', 'PBR'] as const)(
        'prepares real %s lighting, PBR semantics, and built-in blocks through PreparedDraw',
        async kind => {
            const fixture = await createProcessorFixture(createBackend());
            const { mesh, material } = createLitMesh(kind);
            const rig = createLightRig();
            const fog = new Fog({
                color: new Color(0.1, 0.2, 0.3, 1),
                start: 2,
                end: 20
            });
            const camera = new PerspectiveCamera();
            camera.updateViewProjectionMatrix();
            const compile = vi.spyOn(fixture.processor.compiler, 'compile');
            const execution = executeMeshFrame(fixture, mesh, 1, createTarget(), fixture.device, {
                camera,
                lightManager: rig.manager,
                fog
            });
            await finishSubmission(fixture.backend, execution);

            const compiled = compile.mock.results.at(-1)?.value as
                CompiledShaderArtifactPair | undefined;
            if (!compiled) throw new Error('Lit shader was not compiled');
            expect(compiled.metadata.vertexInputs.map(input => input.name)).toEqual(
                expect.arrayContaining(['a_position', 'a_normal'])
            );
            expect(compiled.metadata.uniformBlocks.map(block => block.name)).toEqual(
                expect.arrayContaining(['SceneBlock', 'LightBlock', 'MaterialBlock'])
            );
            expect(compiled.metadata.samplers.map(sampler => sampler.name)).toEqual(
                expect.arrayContaining(['u_areaLightsLtcTexture1', 'u_areaLightsLtcTexture2'])
            );
            expect(execution.draw.pipeline.descriptor.vertex.buffers).toHaveLength(2);
            expect(vertexFormatForInput(execution.draw, 'a_normal')).toBe('float32x3');

            const scene = expectPreparedUniformBlock(fixture, mesh, material, 'SceneBlock');
            const light = expectPreparedUniformBlock(fixture, mesh, material, 'LightBlock');
            const materialBlock = expectPreparedUniformBlock(
                fixture,
                mesh,
                material,
                'MaterialBlock'
            );
            expect(blockFieldFloats(scene.cpu, sceneBlockLayout, 'u_fogColor', 4)).toEqualishValues(
                0.1,
                0.2,
                0.3,
                1
            );
            expect(
                blockFieldFloats(scene.gpu.snapshotBytes(), sceneBlockLayout, 'u_fogInfo', 2)
            ).toEqualishValues(2, 20);
            expect(
                blockFieldFloats(light.cpu, lightBlockLayout, 'u_ambientLightsColor', 3)
            ).toEqualishValues(0.1, 0.2, 0.3);
            expect(
                blockFieldFloats(
                    light.gpu.snapshotBytes(),
                    lightBlockLayout,
                    'u_directionalLightsColor',
                    3
                )
            ).toEqualishValues(1, 0.5, 2);
            expect(
                blockFieldFloats(light.cpu, lightBlockLayout, 'u_pointLightsColor', 3)
            ).toEqualishValues(0.1, 0.2, 0.3);
            expect(
                blockFieldFloats(light.cpu, lightBlockLayout, 'u_spotLightsColor', 3)
            ).toEqualishValues(0.4, 0.2, 0.1);
            expect(
                blockFieldFloats(light.cpu, lightBlockLayout, 'u_areaLightsColor', 3)
            ).toEqualishValues(0.15, 0.3, 0.45);
            const materialColorField = kind === 'PBR' ? 'u_baseColor' : 'u_diffuseColor';
            expect(
                blockFieldFloats(
                    materialBlock.gpu.snapshotBytes(),
                    materialBlockLayout,
                    materialColorField,
                    4
                )
            ).toEqualishValues(...(kind === 'PBR' ? [0.2, 0.4, 0.8, 1] : [0.25, 0.5, 0.75, 1]));
            if (kind === 'PBR') {
                expect(
                    blockFieldFloats(materialBlock.cpu, materialBlockLayout, 'u_metallic', 1)
                ).toEqualishValues(0.35);
                expect(
                    blockFieldFloats(materialBlock.cpu, materialBlockLayout, 'u_roughness', 1)
                ).toEqualishValues(0.65);
            }
            const areaInfo = rig.manager.areaInfo;
            if (!areaInfo?.ltcTexture1 || !areaInfo.ltcTexture2) {
                throw new Error('Area light LTC textures were not prepared');
            }
            expect(fixture.processor.textures.diagnostics(areaInfo.ltcTexture1)).not.toBeNull();
            expect(fixture.processor.textures.diagnostics(areaInfo.ltcTexture2)).not.toBeNull();

            destroyFixture(fixture);
        }
    );

    it('prepares every concrete light kind at the fixed LightBlock ABI capacities', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh, material } = createLitMesh('PBR');
        const manager = new LightManager();
        manager.addLight(new AmbientLight({ amount: 0.25 }));
        for (let index = 0; index < MAX_DIRECTIONAL_LIGHTS; index += 1) {
            manager.addLight(new DirectionalLight({ amount: 0.1 + index * 0.01 }));
        }
        for (let index = 0; index < MAX_POINT_LIGHTS; index += 1) {
            manager.addLight(new PointLight({ range: 10 + index }));
        }
        for (let index = 0; index < MAX_SPOT_LIGHTS; index += 1) {
            manager.addLight(new SpotLight({ range: 20 + index }));
        }
        for (let index = 0; index < MAX_AREA_LIGHTS; index += 1) {
            manager.addLight(new AreaLight({ width: 2 + index, height: 1 + index }));
        }
        const compile = vi.spyOn(fixture.processor.compiler, 'compile');
        const execution = executeMeshFrame(fixture, mesh, 1, createTarget(), fixture.device, {
            lightManager: manager,
            fog: new Fog()
        });
        await finishSubmission(fixture.backend, execution);

        const compiled = compile.mock.results.at(-1)?.value as
            CompiledShaderArtifactPair | undefined;
        if (!compiled) throw new Error('Maximum-light PBR shader was not compiled');
        const shader = compile.mock.calls.at(-1)?.[0];
        if (!shader) throw new Error('Maximum-light PBR shader input was not captured');
        expect(shader.fs).toContain(
            `#define HILO_DIRECTIONAL_LIGHTS ${String(MAX_DIRECTIONAL_LIGHTS)}`
        );
        expect(shader.fs).toContain(`#define HILO_POINT_LIGHTS ${String(MAX_POINT_LIGHTS)}`);
        expect(shader.fs).toContain(`#define HILO_SPOT_LIGHTS ${String(MAX_SPOT_LIGHTS)}`);
        expect(shader.fs).toContain(`#define HILO_AREA_LIGHTS ${String(MAX_AREA_LIGHTS)}`);
        const light = expectPreparedUniformBlock(fixture, mesh, material, 'LightBlock');
        expect(light.gpu.snapshotBytes()).toHaveLength(lightBlockLayout.byteLength);
        expect(manager.lightInfo).toMatchObject({
            DIRECTIONAL_LIGHTS: MAX_DIRECTIONAL_LIGHTS,
            POINT_LIGHTS: MAX_POINT_LIGHTS,
            SPOT_LIGHTS: MAX_SPOT_LIGHTS,
            AREA_LIGHTS: MAX_AREA_LIGHTS
        });

        destroyFixture(fixture);
    });

    it('keeps the lit draw and pipeline stable while refreshing LightBlock content', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh, material } = createLitMesh('BLINN-PHONG');
        const rig = createLightRig();
        const fog = new Fog();
        const camera = new PerspectiveCamera();
        camera.updateViewProjectionMatrix();
        const createPipeline = vi.spyOn(fixture.device, 'createGraphicsPipeline');
        const first = executeMeshFrame(fixture, mesh, 1, createTarget(), fixture.device, {
            camera,
            lightManager: rig.manager,
            fog
        });
        await finishSubmission(fixture.backend, first);
        const initialPipeline = first.draw.pipeline;
        const light = expectPreparedUniformBlock(fixture, mesh, material, 'LightBlock');

        rig.directional.amount = 0.25;
        rig.point.setPosition(5, 6, 7).updateMatrixWorld(true);
        fixture.backend.resetExecutionLog();
        const animated = executeMeshFrame(fixture, mesh, 2, createTarget(), fixture.device, {
            camera,
            lightManager: rig.manager,
            fog
        });
        await finishSubmission(fixture.backend, animated);

        expect(animated.draw).toBe(first.draw);
        expect(animated.draw.pipeline).toBe(initialPipeline);
        expect(createPipeline).toHaveBeenCalledTimes(1);
        expect(
            blockFieldFloats(
                light.gpu.snapshotBytes(),
                lightBlockLayout,
                'u_directionalLightsColor',
                3
            )
        ).toEqualishValues(0.125, 0.0625, 0.25);
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('write-buffer:'))
        ).toBe(true);

        destroyFixture(fixture);
    });

    it('rebuilds concrete resources on a same-backend device while retaining the draw record', async () => {
        const fixture = await createProcessorFixture(createBackend());
        const { mesh, vertices } = createMesh(new Uint16Array([0, 1, 2]));
        const first = executeMeshFrame(fixture, mesh, 1);
        await finishSubmission(fixture.backend, first);
        const originalPipeline = first.draw.pipeline;
        const originalVertex = fixture.processor.buffers.resolveBuffer(vertices, 'vertex');

        const replacementDevice = fixture.backend.createDevice();
        fixture.processor.recover(replacementDevice);
        expect(originalPipeline.destroyed).toBe(true);
        expect(originalVertex.destroyed).toBe(true);

        fixture.backend.resetExecutionLog();
        const recovered = executeMeshFrame(fixture, mesh, 2, createTarget(), replacementDevice);
        await finishSubmission(fixture.backend, recovered);
        const replacementVertex = fixture.processor.buffers.resolveBuffer(vertices, 'vertex');

        expect(recovered.draw).toBe(first.draw);
        expect(recovered.draw.pipeline).not.toBe(originalPipeline);
        expect(recovered.draw.pipeline.deviceId).toBe(replacementDevice.id);
        expect(replacementVertex).not.toBe(originalVertex);
        expect(replacementVertex.deviceId).toBe(replacementDevice.id);
        expect(fixture.backend.executionLog).toContain('draw-indexed:3');
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('index-buffer:uint16:'))
        ).toBe(true);

        destroyFixture(fixture);
    });
});

describe('MeshDrawProcessor cache and failure boundaries', () => {
    it('validates storage-aware scene lighting before shader compilation or queue execution', async () => {
        const fixture = await createProcessorFixture(new FakeWebGPURHIBackend());
        const { mesh } = createLitMesh('LAMBERT');
        const manager = new LightManager();
        for (let index = 0; index <= MAX_DIRECTIONAL_LIGHTS; index += 1) {
            manager.addLight(new DirectionalLight());
        }
        const shader = new StorageGraphicsShader({
            label: 'scene-storage-light-validation',
            vertexSource: STORAGE_VERTEX_SOURCE,
            fragmentSource: STORAGE_FRAGMENT_SOURCE,
            bindings: [
                {
                    name: 'LightBlock',
                    group: 0,
                    binding: 3,
                    kind: 'uniform-buffer'
                },
                {
                    name: 'lightGrid',
                    group: 3,
                    binding: 0,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: 16
                }
            ]
        });
        const compiler = new StorageGraphicsShaderCompiler();
        await compiler.initialize();
        const compile = vi.spyOn(compiler, 'compile');
        const pipelines = new GPUDrivenPipelineResourceCache(fixture.processor.registry, compiler);
        const beginFrame = vi.spyOn(fixture.device.graphicsQueue, 'beginFrame');

        expect(() =>
            executeStorageMeshPreparationFrame(fixture, mesh, 1, shader, pipelines, false, {
                lightManager: manager
            })
        ).toThrow(
            `DIRECTIONAL_LIGHTS count ${String(MAX_DIRECTIONAL_LIGHTS + 1)} exceeds the fixed UBO capacity ${String(MAX_DIRECTIONAL_LIGHTS)}`
        );
        expect(compile).not.toHaveBeenCalled();
        expect(beginFrame).not.toHaveBeenCalled();
        expect(fixture.processor.active).toBe(false);

        pipelines.destroy();
        destroyFixture(fixture);
    });

    it('prepares planner-owned instanced meshes as explicit single-instance storage draws', async () => {
        const fixture = await createProcessorFixture(new FakeWebGPURHIBackend());
        const { mesh } = createMesh();
        mesh.useInstanced = true;
        mesh.setPosition(2, 0, 0).updateMatrixWorld(true);
        const shader = new StorageGraphicsShader({
            label: 'scene-storage-instanced-fallback',
            vertexSource: STORAGE_MODEL_VERTEX_SOURCE,
            fragmentSource: STORAGE_FRAGMENT_SOURCE,
            bindings: [
                {
                    name: 'ModelBlock',
                    group: 2,
                    binding: 0,
                    kind: 'uniform-buffer'
                },
                {
                    name: 'lightGrid',
                    group: 3,
                    binding: 0,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: 16
                }
            ]
        });
        const compiler = new StorageGraphicsShaderCompiler();
        await compiler.initialize();
        const compile = vi.spyOn(compiler, 'compile');
        const pipelines = new GPUDrivenPipelineResourceCache(fixture.processor.registry, compiler);

        expect(() =>
            executeStorageMeshPreparationFrame(fixture, mesh, 1, shader, pipelines)
        ).toThrow(/renderer-list direct-draw fallback/u);
        const execution = executeStorageMeshPreparationFrame(
            fixture,
            mesh,
            2,
            shader,
            pipelines,
            true
        );
        await finishSubmission(fixture.backend, execution);

        expect(preparedInstanceCount(execution.draw)).toBe(1);
        expect(
            execution.draw.pipeline.descriptor.vertex.shader.artifact.reflection.bindings.some(
                binding => binding.name === 'ModelBlock'
            )
        ).toBe(true);
        const bindGroups = Reflect.get(execution.draw, 'bindGroups') as readonly unknown[];
        expect(bindGroups[2]).not.toBeNull();
        expect(compile).toHaveBeenCalledTimes(1);

        pipelines.destroy();
        destroyFixture(fixture);
    });

    it('reuses a storage-aware scene draw and its stable vertex-layout pipeline across frames', async () => {
        const fixture = await createProcessorFixture(new FakeWebGPURHIBackend());
        const { mesh } = createMesh();
        const shader = new StorageGraphicsShader({
            label: 'scene-storage-cache',
            vertexSource: STORAGE_VERTEX_SOURCE,
            fragmentSource: STORAGE_FRAGMENT_SOURCE,
            bindings: [
                {
                    name: 'lightGrid',
                    group: 3,
                    binding: 0,
                    kind: 'read-only-storage-buffer',
                    minBindingSize: 16
                }
            ]
        });
        const compiler = new StorageGraphicsShaderCompiler();
        await compiler.initialize();
        const compile = vi.spyOn(compiler, 'compile');
        const pipelines = new GPUDrivenPipelineResourceCache(fixture.processor.registry, compiler);
        const preparePipeline = vi.spyOn(pipelines, 'prepareScene');
        const createPipeline = vi.spyOn(fixture.device, 'createGraphicsPipeline');

        const first = executeStorageMeshPreparationFrame(fixture, mesh, 1, shader, pipelines);
        await finishSubmission(fixture.backend, first);
        const firstPipeline = first.draw.pipeline;
        const beginUpdate = vi.spyOn(first.draw, 'beginUpdate');

        const second = executeStorageMeshPreparationFrame(fixture, mesh, 2, shader, pipelines);
        await finishSubmission(fixture.backend, second);

        expect(second.draw).toBe(first.draw);
        expect(second.draw.pipeline).toBe(firstPipeline);
        expect(beginUpdate).not.toHaveBeenCalled();
        expect(createPipeline).toHaveBeenCalledTimes(1);
        expect(compile).toHaveBeenCalledTimes(1);
        expect(preparePipeline.mock.calls).toHaveLength(2);
        expect(preparePipeline.mock.calls[1]?.[2]).toBe(preparePipeline.mock.calls[0]?.[2]);

        pipelines.destroy();
        destroyFixture(fixture);
    });

    it('keeps the steady draw/pipeline and invalidates only the affected preparation layers', async () => {
        const fixture = await createProcessorFixture(new FakeWebGLRHIBackend());
        const { mesh, vertices } = createMesh();
        const createPipeline = vi.spyOn(fixture.device, 'createGraphicsPipeline');
        const getShader = vi.spyOn(Shader, 'getShader');
        const first = executeMeshFrame(fixture, mesh, 1);
        await finishSubmission(fixture.backend, first);
        const initialPipeline = first.draw.pipeline;
        const beginUpdate = vi.spyOn(first.draw, 'beginUpdate');

        const steady = executeMeshFrame(fixture, mesh, 2);
        await finishSubmission(fixture.backend, steady);
        expect(steady.draw).toBe(first.draw);
        expect(steady.draw.pipeline).toBe(initialPipeline);
        expect(beginUpdate).not.toHaveBeenCalled();
        expect(createPipeline).toHaveBeenCalledTimes(1);
        expect(getShader).toHaveBeenCalledTimes(1);

        fixture.backend.resetExecutionLog();
        vertices.setSubData(0, new Float32Array([-0.75]));
        const geometryRevision = executeMeshFrame(fixture, mesh, 3);
        await finishSubmission(fixture.backend, geometryRevision);
        expect(geometryRevision.draw).toBe(first.draw);
        expect(geometryRevision.draw.pipeline).toBe(initialPipeline);
        expect(beginUpdate).toHaveBeenCalledTimes(1);
        expect(createPipeline).toHaveBeenCalledTimes(1);
        expect(getShader).toHaveBeenCalledTimes(1);
        expect(
            fixture.backend.executionLog.some(command => command.startsWith('write-buffer:'))
        ).toBe(true);

        mesh.material = createMesh(undefined, FRAGMENT_SOURCE, 'back').material;
        const stateRevision = executeMeshFrame(fixture, mesh, 4);
        await finishSubmission(fixture.backend, stateRevision);
        expect(stateRevision.draw).toBe(first.draw);
        expect(stateRevision.draw.pipeline).not.toBe(initialPipeline);
        expect(beginUpdate).toHaveBeenCalledTimes(2);
        expect(createPipeline).toHaveBeenCalledTimes(2);
        expect(getShader).toHaveBeenCalledTimes(2);
        const statePipeline = stateRevision.draw.pipeline;

        mesh.material = createMesh(
            undefined,
            `${FRAGMENT_SOURCE}\n// exact shader-source revision`,
            'back'
        ).material;
        const shaderRevision = executeMeshFrame(fixture, mesh, 5);
        await finishSubmission(fixture.backend, shaderRevision);
        expect(shaderRevision.draw).toBe(first.draw);
        expect(shaderRevision.draw.pipeline).not.toBe(statePipeline);
        expect(beginUpdate).toHaveBeenCalledTimes(3);
        expect(createPipeline).toHaveBeenCalledTimes(3);
        expect(getShader).toHaveBeenCalledTimes(3);
        expect(initialPipeline.destroyed).toBe(true);
        expect(statePipeline.destroyed).toBe(true);
        const shaderPipeline = shaderRevision.draw.pipeline;

        const targetRevision = executeMeshFrame(fixture, mesh, 6, createTarget('bgra8unorm'));
        await finishSubmission(fixture.backend, targetRevision);
        expect(targetRevision.draw).toBe(first.draw);
        expect(targetRevision.draw.pipeline).not.toBe(shaderPipeline);
        expect(beginUpdate).toHaveBeenCalledTimes(4);
        expect(createPipeline).toHaveBeenCalledTimes(4);
        expect(getShader).toHaveBeenCalledTimes(3);

        destroyFixture(fixture);
    });

    it('uses submission fences as the recover and destroy lifetime boundary', async () => {
        const fixture = await createProcessorFixture(new FakeWebGPURHIBackend());
        const { mesh } = createMesh();
        const execution = executeMeshFrame(fixture, mesh, 1);
        const replacement = fixture.backend.createDevice();

        expect(fixture.processor.submissions.pendingSubmissionCount).toBe(1);
        expect(() => {
            fixture.processor.recover(replacement);
        }).toThrow(/submissions are in flight/u);
        expect(() => {
            fixture.processor.destroy();
        }).toThrow(/submissions are in flight/u);

        await finishSubmission(fixture.backend, execution);
        expect(fixture.processor.submissions.pendingSubmissionCount).toBe(0);
        expect(fixture.processor.submissions.completedFrame).toBe(1);
        fixture.processor.recover(replacement);

        destroyFixture(fixture);
    });

    it('rolls back resources from an earlier mesh when a later mesh fails and renders next frame', async () => {
        const fixture = await createProcessorFixture(new FakeWebGLRHIBackend());
        const textured = createTexturedMesh();
        const bufferViewId = 'invalid-interleaved-storage';
        const invalidPosition = new GeometryData(new Float32Array(15), 3, {
            bufferViewId,
            stride: 20,
            offset: 0
        });
        const invalidUv = new GeometryData(new Float32Array(15), 2, {
            bufferViewId,
            stride: 20,
            offset: 12
        });
        const invalidMesh = new Mesh({
            geometry: new Geometry({ vertices: invalidPosition, uvs: invalidUv }),
            material: textured.material
        });

        expect(() =>
            fixture.frame.execute(createContext(fixture, 1), scope => {
                fixture.processor.beginFrame(scope.context, scope.uploads);
                fixture.processor.prepare(textured.mesh, createTarget());
                fixture.processor.prepare(invalidMesh, createTarget());
            })
        ).toThrow(/exact same underlying byte range/u);
        expect(fixture.processor.active).toBe(false);
        expect(fixture.processor.textures.active).toBe(false);
        expect(fixture.frame.active).toBe(false);

        const recovered = executeMeshFrame(fixture, textured.mesh, 2);
        await finishSubmission(fixture.backend, recovered);
        expect(recovered.result.diagnostics.drawCount).toBe(1);
        expect(fixture.backend.executionLog).toContain('draw:3');
        expect(fixture.processor.active).toBe(false);
        expect(fixture.processor.textures.active).toBe(false);

        destroyFixture(fixture);
    });

    it('rolls back a build-stage rejection before the graphics queue begins a frame', async () => {
        const fixture = await createProcessorFixture(new FakeWebGLRHIBackend());
        const { mesh, geometry } = createMesh();
        geometry.mode = 0xdead;
        const beginFrame = vi.spyOn(fixture.device.graphicsQueue, 'beginFrame');

        expect(() =>
            fixture.frame.execute(createContext(fixture, 1), scope => {
                fixture.processor.beginFrame(scope.context, scope.uploads);
                fixture.processor.prepare(mesh, createTarget());
            })
        ).toThrow(/Unsupported primitive topology/u);
        expect(beginFrame).not.toHaveBeenCalled();
        expect(fixture.device.graphicsQueue.state).toBe('idle');
        expect(fixture.processor.active).toBe(false);
        expect(fixture.frame.active).toBe(false);

        destroyFixture(fixture);
    });

    it.each([
        ['WebGL immediate', () => new FakeWebGLRHIBackend()],
        ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
    ] as const)(
        'executes combined morph-then-skinning deformation on the %s shared ABI',
        async (_name, createBackend) => {
            const fixture = await createProcessorFixture(createBackend());
            const morph = createMorphMesh();
            const skin = createSkinnedMesh('float32');
            morph.geometry.skinIndices = skin.skinIndices;
            morph.geometry.skinWeights = skin.skinWeights;
            const combined = new SkinnedMesh({
                geometry: morph.geometry,
                material: morph.material,
                skeleton: skin.mesh.skeleton
            });
            combined.updateMatrixWorld(true);

            const execution = executeMeshFrame(fixture, combined, 1);
            await finishSubmission(fixture.backend, execution);
            const inputs =
                execution.draw.pipeline.descriptor.vertex.shader.artifact.reflection.vertexInputs?.map(
                    input => input.name
                ) ?? [];
            expect(inputs).toEqual(
                expect.arrayContaining([
                    'a_morphPosition0',
                    'a_morphPosition1',
                    'a_skinIndices',
                    'a_skinWeights'
                ])
            );
            expectPreparedUniformBlock(fixture, combined, morph.material, 'MorphBlock');
            expectPreparedUniformBlock(fixture, combined, morph.material, 'SkinningBlock');
            expect(execution.result.diagnostics.drawCount).toBe(1);
            expect(fixture.backend.executionLog).toContain('draw:3');

            destroyFixture(fixture);
        }
    );

    it('rejects malformed deformation owners and fixed-ABI overflow before shader compilation', async () => {
        const fixture = await createProcessorFixture(new FakeWebGLRHIBackend());
        const skin = createSkinnedMesh('float32');
        skin.mesh.skeleton = null;
        const compile = vi.spyOn(fixture.processor.compiler, 'compile');

        expect(() =>
            fixture.frame.execute(createContext(fixture, 1), scope => {
                fixture.processor.beginFrame(scope.context, scope.uploads);
                fixture.processor.prepare(skin.mesh, createTarget());
            })
        ).toThrow(/requires a Skeleton/u);
        expect(compile).not.toHaveBeenCalled();

        const morph = createMorphMesh();
        morph.geometry.weights = [0, 0, 0];
        expect(() =>
            fixture.frame.execute(createContext(fixture, 2), scope => {
                fixture.processor.beginFrame(scope.context, scope.uploads);
                fixture.processor.prepare(morph.mesh, createTarget());
            })
        ).toThrow(/more weights than active target slots/u);
        expect(compile).not.toHaveBeenCalled();
        expect(fixture.device.graphicsQueue.state).toBe('idle');

        destroyFixture(fixture);
    });

    it.each([
        ['DIRECTIONAL_LIGHTS', MAX_DIRECTIONAL_LIGHTS, () => new DirectionalLight()],
        ['POINT_LIGHTS', MAX_POINT_LIGHTS, () => new PointLight()],
        ['SPOT_LIGHTS', MAX_SPOT_LIGHTS, () => new SpotLight()],
        ['AREA_LIGHTS', MAX_AREA_LIGHTS, () => new AreaLight()]
    ] as const)(
        'rejects %s overflow before shader compilation or queue execution',
        async (name, limit, createLight) => {
            const fixture = await createProcessorFixture(new FakeWebGLRHIBackend());
            const { mesh } = createLitMesh('LAMBERT');
            const manager = new LightManager();
            for (let index = 0; index <= limit; index += 1) manager.addLight(createLight());
            const compile = vi.spyOn(fixture.processor.compiler, 'compile');
            const beginFrame = vi.spyOn(fixture.device.graphicsQueue, 'beginFrame');

            expect(() =>
                fixture.frame.execute(
                    createContext(fixture, 1, fixture.device, { lightManager: manager }),
                    scope => {
                        fixture.processor.beginFrame(scope.context, scope.uploads);
                        fixture.processor.prepare(mesh, createTarget());
                    }
                )
            ).toThrow(
                `${name} count ${String(limit + 1)} exceeds the fixed UBO capacity ${String(limit)}`
            );
            expect(compile).not.toHaveBeenCalled();
            expect(beginFrame).not.toHaveBeenCalled();
            expect(fixture.processor.active).toBe(false);

            destroyFixture(fixture);
        }
    );

    it('rejects malformed packed light content before shader compilation or queue execution', async () => {
        const fixture = await createProcessorFixture(new FakeWebGLRHIBackend());
        const { mesh } = createLitMesh('PHONG');
        const manager = new LightManager({
            updateCustomInfo(value) {
                if (!value.pointInfo) throw new Error('Point light info was not prepared');
                value.pointInfo.colors[0] = Number.NaN;
            }
        });
        manager.addLight(new PointLight());
        const compile = vi.spyOn(fixture.processor.compiler, 'compile');
        const beginFrame = vi.spyOn(fixture.device.graphicsQueue, 'beginFrame');

        expect(() =>
            fixture.frame.execute(
                createContext(fixture, 1, fixture.device, { lightManager: manager }),
                scope => {
                    fixture.processor.beginFrame(scope.context, scope.uploads);
                    fixture.processor.prepare(mesh, createTarget());
                }
            )
        ).toThrow(/LightBlock point colors\[0\] must be finite/u);
        expect(compile).not.toHaveBeenCalled();
        expect(beginFrame).not.toHaveBeenCalled();
        expect(fixture.processor.active).toBe(false);

        destroyFixture(fixture);
    });

    it('separates Phase 5 shadow samplers from unshadowed lit material preparation', async () => {
        const fixture = await createProcessorFixture(new FakeWebGLRHIBackend());
        const { mesh } = createLitMesh('BLINN-PHONG');
        const manager = new LightManager();
        manager.addLight(new DirectionalLight({ shadow: {} }));
        const compile = vi.spyOn(fixture.processor.compiler, 'compile');
        const beginFrame = vi.spyOn(fixture.device.graphicsQueue, 'beginFrame');

        expect(() =>
            fixture.frame.execute(
                createContext(fixture, 1, fixture.device, { lightManager: manager }),
                scope => {
                    fixture.processor.beginFrame(scope.context, scope.uploads);
                    fixture.processor.prepare(mesh, createTarget());
                }
            )
        ).toThrow(/require a prepared shared shadow atlas binding/u);
        expect(compile).not.toHaveBeenCalled();
        expect(beginFrame).not.toHaveBeenCalled();

        mesh.receiveShadows = false;
        const unshadowed = executeMeshFrame(fixture, mesh, 2, createTarget(), fixture.device, {
            lightManager: manager
        });
        await finishSubmission(fixture.backend, unshadowed);
        const compiled = compile.mock.results.at(-1)?.value as
            CompiledShaderArtifactPair | undefined;
        if (!compiled) throw new Error('Unshadowed lit shader was not compiled');
        expect(compiled.metadata.samplers.map(sampler => sampler.name)).not.toContain(
            'u_directionalLightsShadowMap'
        );
        expect(fixture.backend.executionLog).toContain('draw:3');

        destroyFixture(fixture);
    });
});

describe('MeshDrawProcessor concrete WebGL2 deformation path', () => {
    it('links and executes unsigned skin indices with an integer vertex attribute', async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const native = canvas.getContext('webgl2');
        if (native === null) return;

        const calls: string[] = [];
        const device = createWebGL2RHIDevice(recordingWebGLContext(native, calls));
        const renderer = createRenderer();
        const frame = new RenderGraphFrame();
        const processor = new MeshDrawProcessor(renderer, device);
        try {
            await processor.initialize();
            const { mesh } = createSkinnedMesh('uint8');
            let prepared: PreparedDraw | undefined;
            const context = createRenderGraphFrameContext({
                renderer,
                rhi: device,
                frameIndex: 1,
                camera: new PerspectiveCamera(),
                lightManager: new LightManager(),
                fog: null,
                viewport: { x: 0, y: 0, width: 8, height: 8, minDepth: 0, maxDepth: 1 }
            });
            const result = frame.execute(context, scope => {
                processor.beginFrame(scope.context, scope.uploads);
                prepared = processor.prepare(mesh, createTarget());
                const color = scope.graph.createTexture('concrete skinning color', {
                    size: { width: 8, height: 8 },
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                });
                const pass = new SharedDrawPassParameters({ colorAttachments: 1, draws: 1 });
                pass.label = 'Concrete WebGL2 skinning pass';
                pass.sideEffect = true;
                pass.addColorAttachment({
                    texture: color,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                });
                pass.addDraw(prepared);
                scope.graph.addPass(MainPassTemplate, pass);
            });
            await processor.trackSubmission(1, result.submission);
            await processor.submissions.waitForIdle();
            if (prepared === undefined) throw new Error('Concrete skinning draw was not prepared');

            expect(vertexFormatForInput(prepared, 'a_skinIndices')).toBe('uint8x4');
            expect(result.diagnostics.drawCount).toBe(1);
            expect(calls).toContain('linkProgram');
            expect(calls).toContain('vertexAttribIPointer');
            expect(native.getError()).toBe(native.NO_ERROR);
        } finally {
            await processor.submissions.waitForIdle();
            processor.destroy();
            frame.destroy();
            device.destroy();
        }
    });
});
