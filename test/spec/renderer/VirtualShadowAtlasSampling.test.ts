import { describe, expect, it, vi } from 'vitest';
import {
    AmbientLight,
    BoxGeometry,
    ClusteredForwardPlusPipelineFactory,
    Color,
    DirectionalLight,
    Matrix4,
    Mesh,
    Node,
    PBRMaterial,
    PerspectiveCamera,
    Renderer,
    Vector3
} from '../../../src/Hilo3d';
import {
    RendererStorageBuffer,
    type StorageBuffer,
    type StorageBufferDescriptor
} from '../../../src/render/StorageBuffer';
import SharedRendererDriver from '../../../src/render/internal/SharedRendererDriver';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';
import type {
    RenderPipelineContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import { FullscreenRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import {
    VIRTUAL_SHADOW_ATLAS_POSITION_SOURCE,
    VIRTUAL_SHADOW_ATLAS_SAMPLING_SOURCE
} from '../../../src/render/pipeline/internal/virtualShadowAtlasCoordinates';
import Shader from '../../../src/shader/Shader';

const SIZE = 128;
const PHYSICAL_PAGES = 64;
const CLIPMAP = 'Virtual shadow directional clipmap database';
const STATES = [
    'Virtual shadow physical residency state A',
    'Virtual shadow physical residency state B'
];
const SHADOW_POINTS = [new Vector3(-1.55, 0, -1.85), new Vector3(2.5, 0, 4.5)];
const CLEAR_POINTS = [new Vector3(-2, 0, 3.8), new Vector3(2.8, 0, -2.8)];

type CameraBasis = 'rigid' | 'scaled' | 'sheared';

async function createView(
    virtual: boolean,
    biasFixture = false,
    cameraBasis: CameraBasis = 'rigid'
) {
    const depthScale = cameraBasis === 'rigid' ? 1 : 0.125;
    const floor = new BoxGeometry({ width: 16, height: 0.1, depth: 16 });
    const casters = biasFixture
        ? [new BoxGeometry({ width: 2, height: 0.4, depth: 1 })]
        : [
              new BoxGeometry({ width: 1.6, height: 2, depth: 1.3 }),
              new BoxGeometry({ width: 0.8, height: 3, depth: 2.2 })
          ];
    const material = new PBRMaterial({
        baseColor: new Color(0.7, 0.7, 0.7),
        metallic: 0,
        roughness: 1
    });
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: [floor, ...casters].map(geometry => ({ geometry, material })),
        maxObjects: 4,
        maxLights: 4,
        maxLightsPerCluster: 4,
        maxLightIndices: 8192,
        maxViewportWidth: SIZE,
        maxViewportHeight: SIZE,
        bloomStrength: 0,
        ...(virtual
            ? {
                  virtualShadows: {
                      virtualResolution: 1024,
                      pageSize: 64,
                      physicalPageCount: PHYSICAL_PAGES,
                      maxPageUpdatesPerFrame: PHYSICAL_PAGES,
                      directionalClipmapLevels: 1,
                      firstDirectionalClipmapExtent: 48
                  }
              }
            : {})
    });
    const observed = new Map<string, StorageBuffer>();
    const original = Reflect.get(SharedRendererDriver.prototype, 'createPipelineStorageBuffer');
    const creation = vi
        .spyOn(SharedRendererDriver.prototype, 'createPipelineStorageBuffer')
        .mockImplementation(function (
            this: SharedRendererDriver,
            descriptor: Readonly<StorageBufferDescriptor>
        ): StorageBuffer {
            const observe = descriptor.label !== undefined && STATES.includes(descriptor.label);
            const buffer = original.call(
                this,
                observe && !descriptor.usage.includes('copy-source')
                    ? { ...descriptor, usage: [...descriptor.usage, 'copy-source'] }
                    : descriptor
            );
            if (observe || descriptor.label === CLIPMAP) observed.set(buffer.label, buffer);
            return buffer;
        });
    const renderer = await (async () => {
        try {
            return await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: SIZE,
                height: SIZE,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
        } finally {
            creation.mockRestore();
        }
    })();
    const target = renderer.createRenderTarget({
        width: SIZE,
        height: SIZE,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
    });
    const scene = new Node();
    new Mesh({
        geometry: floor,
        material,
        y: -0.05,
        castShadows: false,
        receiveShadows: true
    }).addTo(scene);
    for (let index = 0; index < casters.length; index++) {
        const geometry = casters[index];
        if (geometry === undefined) throw new Error('Missing caster geometry');
        new Mesh({
            geometry,
            material,
            x: biasFixture ? 0 : index === 0 ? -2 : 2,
            y: biasFixture ? 0.2 : index === 0 ? 1 : 1.5,
            z: biasFixture ? -1 : index === 0 ? -3 : 2.5,
            castShadows: true
        }).addTo(scene);
    }
    new AmbientLight({ amount: 0.04 }).addTo(scene);
    new DirectionalLight({
        direction: biasFixture ? new Vector3(0.2, -0.2, 1) : new Vector3(0.3, -1, 0.5),
        amount: 3,
        shadow: {
            width: 1024,
            height: 1024,
            cascadeCount: 1,
            cascadeMaxDistance: 40 / depthScale,
            minBias: biasFixture ? 0.002 : 0.00001,
            maxBias: biasFixture ? 0.012 : 0.00001
        }
    }).addTo(scene);
    const camera = new PerspectiveCamera({
        aspect: 1,
        near: 0.1 / depthScale,
        far: 170 / depthScale,
        fov: 45,
        depthMode: 'reversed'
    });
    camera.setPosition(0, 10, 12).lookAt(new Vector3(0, 0, 0));
    if (cameraBasis !== 'rigid') {
        const affine = new Matrix4().fromArray(
            cameraBasis === 'scaled'
                ? [0.125, 0, 0, 0, 0, 0.125, 0, 0, 0, 0, 0.125, 0, 0, 0, 0, 1]
                : [0.125, 0, 0, 0, 0.005, 0.125, 0, 0, 0.01, 0, 0.125, 0, 0, 0, 0, 1]
        );
        // Keep the same eye position, and compensate view-space near/far distances. The scaled
        // case preserves the visible image; the second case additionally changes the view basis
        // nonuniformly and shears it. Both must retain the same authored CSM/VSM bias relationship.
        camera.matrix.multiply(affine);
    }
    const capture = async (): Promise<Uint8Array> => {
        for (let frame = 0; frame < 4; frame++) {
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
        }
        return (await target.readColorAttachment()).data;
    };
    const physicalPages = async (points: readonly Vector3[]): Promise<number[]> => {
        const clipmap = observed.get(CLIPMAP);
        if (!(clipmap instanceof RendererStorageBuffer))
            throw new Error('Missing clipmap CPU recipe');
        const bytes = clipmap.cpuData();
        const floats = new Float32Array(bytes);
        const signed = new Int32Array(bytes);
        const matrix = new Matrix4().fromArray(floats.subarray(52, 68));
        const records: Uint32Array[] = [];
        for (const label of STATES) {
            const buffer = observed.get(label);
            if (buffer === undefined) throw new Error('Missing physical page state');
            const read = await buffer.read();
            records.push(
                new Uint32Array(read.data.buffer, read.data.byteOffset, read.data.byteLength / 4)
            );
        }
        return points.map(point => {
            const projected = point.clone().transformMat4(matrix);
            const x = Math.floor((projected.x * 0.5 + 0.5) * 16) + (signed[68] ?? 0);
            const y = Math.floor((0.5 - projected.y * 0.5) * 16) + (signed[69] ?? 0);
            let physical = -1,
                timestamp = -1;
            for (const state of records)
                for (let page = 0; page < PHYSICAL_PAGES; page++) {
                    const base = page * 64;
                    if (
                        state[base + 5] === 1 &&
                        state[base + 8] === 0 &&
                        state[base] === 0 &&
                        ((state[base + 1] ?? 0) | 0) === x &&
                        ((state[base + 2] ?? 0) | 0) === y &&
                        state[base + 3] === (signed[70] ?? 0) &&
                        (state[base + 4] ?? 0) > timestamp
                    ) {
                        timestamp = state[base + 4] ?? 0;
                        physical = page;
                    }
                }
            return physical;
        });
    };
    return {
        camera,
        capture,
        physicalPages,
        destroy(): void {
            target.destroy();
            scene.destroy(renderer);
            renderer.destroy();
        }
    };
}

function intensity(pixels: Uint8Array, camera: PerspectiveCamera, point: Vector3): number {
    const projected = point.clone().transformMat4(camera.viewProjectionMatrix);
    const x = Math.floor((projected.x * 0.5 + 0.5) * SIZE);
    const y = Math.floor((0.5 - projected.y * 0.5) * SIZE);
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
            const index = ((y + dy) * SIZE + x + dx) * 4;
            sum += (pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0);
        }
    return sum / 27;
}

function atlasFixtureFactory(): RenderPipelineFactory {
    const portableCoordinates = Shader.shaders['method/portableCoordinates.glsl'];
    if (portableCoordinates === undefined) throw new Error('Missing portable coordinates source');
    const vertex = `#version 300 es
precision highp float;
out vec2 v_topLeft;
${VIRTUAL_SHADOW_ATLAS_POSITION_SOURCE}
void main() {
    v_topLeft = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(hiloVirtualShadowAtlasNDC(v_topLeft, vec2(0.0), vec2(1.0)), 0.0, 1.0);
}`;
    const pass = (name: string, body: string) =>
        new FullscreenRenderPass({
            name,
            shader: new Shader({
                vs: vertex,
                fs: `#version 300 es
precision highp float;
in vec2 v_topLeft;
out vec4 color;
${body}`
            }),
            pipelineState: {
                ...DEFAULT_MATERIAL_PIPELINE_STATE,
                depthTest: false,
                depthWrite: false,
                cullMode: 'none'
            }
        });
    const write = pass(
        'Asymmetric physical atlas',
        `void main() {
    vec2 page = v_topLeft * vec2(2.0, 4.0);
    color = vec4((floor(page.x) + 1.0) / 3.0, (floor(page.y) + 1.0) / 5.0, fract(page.y), 1.0);
}`
    );
    const read = pass(
        'Production physical atlas normalization',
        `uniform sampler2D u_atlas;
${portableCoordinates}
${VIRTUAL_SHADOW_ATLAS_SAMPLING_SOURCE}
void main() {
    vec2 page = v_topLeft.x < 0.5 ? vec2(1.0, 0.0) : vec2(0.0, 3.0);
    vec2 localUV = vec2(0.25, v_topLeft.y < 0.5 ? 0.25 : 0.75);
    vec2 atlasUV = (page + localUV) / vec2(2.0, 4.0);
    color = texture(u_atlas, hiloVirtualShadowAtlasSampleUV(atlasUV));
}`
    );
    return {
        name: 'Portable physical atlas fixture',
        create() {
            return {
                name: 'Portable physical atlas fixture',
                record(context: RenderPipelineContext): void {
                    const atlas = context.graph.createTexture('Asymmetric atlas attachment', {
                        format: 'rgba8unorm',
                        extent: { width: 64, height: 64 },
                        sampleCount: 1
                    });
                    context.graph.addPass(write, {
                        inputTextures: [],
                        colorAttachments: [
                            {
                                texture: atlas,
                                loadOp: 'clear',
                                storeOp: 'store',
                                clearValue: { r: 0, g: 0, b: 0, a: 0 }
                            }
                        ]
                    });
                    context.graph.addPass(read, {
                        inputTextures: [atlas],
                        colorAttachments: [
                            {
                                texture: context.graph.importOutput().color(0),
                                loadOp: 'clear',
                                storeOp: 'store',
                                clearValue: { r: 0, g: 0, b: 0, a: 0 }
                            }
                        ]
                    });
                },
                destroy(): void {
                    // The graph and renderer own the transient attachment and compiled passes.
                }
            };
        }
    };
}

describe('Virtual shadow atlas sampling', () => {
    it.each(['webgl2', 'webgpu'] as const)(
        'normalizes nonadjacent atlas rows and asymmetric local V through the production helper on %s',
        async backend => {
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 16,
                height: 16,
                antialias: false,
                renderPipeline: atlasFixtureFactory()
            });
            const target = renderer.createRenderTarget({
                width: 16,
                height: 16,
                colorAttachments: [{ format: 'rgba8unorm' }]
            });
            const scene = new Node();
            const camera = new PerspectiveCamera({ aspect: 1 });
            try {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const pixels = (await target.readColorAttachment()).data;
                for (const [x, y, red, green, blue] of [
                    [3, 3, 170, 51, 64],
                    [12, 3, 85, 204, 64],
                    [3, 12, 170, 51, 191],
                    [12, 12, 85, 204, 191]
                ]) {
                    if (x === undefined || y === undefined)
                        throw new Error('Invalid expected atlas location');
                    const index = (y * 16 + x) * 4;
                    expect(pixels[index]).toBeCloseTo(red ?? 0, 0);
                    expect(pixels[index + 1]).toBeCloseTo(green ?? 0, 0);
                    expect(pixels[index + 2]).toBeCloseTo(blue ?? 0, 0);
                    expect(pixels[index + 3]).toBe(255);
                }
            } finally {
                target.destroy();
                scene.destroy(renderer);
                renderer.destroy();
            }
        }
    );
    it.each(['rigid', 'scaled', 'sheared'] as const)(
        'preserves the authored stable-shadow bias with a %s camera basis',
        async cameraBasis => {
            const reference = await createView(false, true, cameraBasis);
            const virtual = await createView(true, true, cameraBasis);
            try {
                const expected = await reference.capture(),
                    actual = await virtual.capture();
                const point = new Vector3(0.2, 0, 0.5);
                const clearPoint = new Vector3(-2, 0, 0.5);
                const expectedShadow = intensity(expected, reference.camera, point);
                const actualShadow = intensity(actual, virtual.camera, point);
                const clear = intensity(expected, reference.camera, clearPoint);
                const actualClear = intensity(actual, virtual.camera, clearPoint);
                const pages = await virtual.physicalPages([point]);
                console.info({ expectedShadow, actualShadow, clear, actualClear, pages });
                expect(pages[0]).toBeGreaterThanOrEqual(0);
                expect(expectedShadow).toBeLessThan(clear * 0.5);
                expect(actualShadow).toBeLessThan(clear * 0.5);
                expect(actualClear).toBeGreaterThan(clear * 0.8);
            } finally {
                virtual.destroy();
                reference.destroy();
            }
        }
    );
    it('preserves asymmetric receiver shadows in distinct nonadjacent physical atlas rows', async () => {
        const reference = await createView(false);
        const virtual = await createView(true);
        try {
            const expected = await reference.capture(),
                actual = await virtual.capture();
            const expectedShadow = SHADOW_POINTS.map(point =>
                intensity(expected, reference.camera, point)
            );
            const actualShadow = SHADOW_POINTS.map(point =>
                intensity(actual, virtual.camera, point)
            );
            const clear = CLEAR_POINTS.map(point => intensity(expected, reference.camera, point));
            const actualClear = CLEAR_POINTS.map(point => intensity(actual, virtual.camera, point));
            const pages = await virtual.physicalPages(SHADOW_POINTS);
            console.info({ expectedShadow, actualShadow, clear, actualClear, pages });
            expect(pages.every(page => page >= 0)).toBe(true);
            expect(
                Math.abs(Math.floor((pages[0] ?? -1) / 8) - Math.floor((pages[1] ?? -1) / 8))
            ).toBeGreaterThanOrEqual(2);
            for (let index = 0; index < SHADOW_POINTS.length; index++) {
                expect(expectedShadow[index]).toBeLessThan((clear[index] ?? 0) * 0.5);
                expect(actualShadow[index]).toBeLessThan((clear[index] ?? 0) * 0.5);
                expect(actualClear[index]).toBeGreaterThan((clear[index] ?? 0) * 0.8);
            }
        } finally {
            virtual.destroy();
            reference.destroy();
        }
    });
});
