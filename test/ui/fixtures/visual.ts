import {
    AmbientLight,
    BoxGeometry,
    CameraOutput,
    Color,
    DirectionalLight,
    Engine,
    Euler,
    Geometry,
    GeometryData,
    LocalTransform,
    MeshRenderer,
    PBRMaterial,
    PerspectiveCamera,
    Quaternion,
    RENDER_WORLD,
    ShaderMaterial,
    World,
    createRenderExtractionSystem,
    createTransformSystem
} from '../../../src/Hilo3d';
import cameraBlockSource from '../../../src/shader/chunk/cameraBlock.glsl?raw';

const container = document.querySelector<HTMLElement>('#stage');
if (!container) throw new Error('Visual fixture container is missing.');
const backendValue = new URLSearchParams(location.search).get('backend');
if (backendValue !== 'webgl2' && backendValue !== 'webgpu') {
    throw new TypeError('Visual fixture requires backend=webgl2 or backend=webgpu.');
}

function rotation(
    degreeX: number,
    degreeY: number,
    degreeZ: number
): readonly [number, number, number, number] {
    const elements = new Quaternion().fromEuler(
        new Euler().setDegree(degreeX, degreeY, degreeZ)
    ).elements;
    return [elements[0], elements[1], elements[2], elements[3]];
}

async function createRenderWorld(): Promise<World> {
    return World.create({ systems: [createTransformSystem(), createRenderExtractionSystem()] });
}

const clearColor = new Color(0.08, 0.1, 0.14);
const world = await createRenderWorld();
const cameraEntity = world.createEntity();
world.add(cameraEntity, LocalTransform, { position: [0, 0, 4] });
world.add(cameraEntity, PerspectiveCamera, { aspect: 4 / 3, near: 0.1, far: 100 });
world.add(cameraEntity, CameraOutput, { enabled: true });

const meshEntity = world.createEntity();
world.add(meshEntity, LocalTransform, { rotation: rotation(22, 35, 0) });
world.add(meshEntity, MeshRenderer, {
    geometry: new BoxGeometry(),
    material: new PBRMaterial({
        baseColor: new Color(0.82, 0.19, 0.12),
        metallic: 0.2,
        roughness: 0.55
    })
});

const ambientEntity = world.createEntity();
world.add(ambientEntity, AmbientLight, { color: [1, 1, 1], amount: 0.45 });
const directionalEntity = world.createEntity();
world.add(directionalEntity, LocalTransform, {});
world.add(directionalEntity, DirectionalLight, {
    color: [1, 0.96, 0.9],
    amount: 3,
    direction: [-1, -0.8, -0.5]
});

const engine = await Engine.create({
    backend: backendValue,
    container,
    width: 640,
    height: 480,
    pixelRatio: 1,
    antialias: false,
    clearColor
});
engine.frame(world, 0);
await engine.renderer.waitForIdle();
window.__HILO3D_VISUAL_FIRST_FRAME__ = { backend: engine.renderer.backend };

async function runReadbackDiagnostics(): Promise<void> {
    const readbackTarget = engine.renderer.createRenderTarget({
        width: 160,
        height: 120,
        colorAttachments: [
            {
                format: 'rgba8unorm',
                clearValue: {
                    r: clearColor.r,
                    g: clearColor.g,
                    b: clearColor.b,
                    a: clearColor.a
                }
            }
        ],
        depthStencilAttachment: { format: 'depth24plus' },
        label: 'Visual ECS PBR diagnostics'
    });

    async function renderAndRead(): Promise<Uint8Array> {
        const renderWorld = world.getResource(RENDER_WORLD);
        const camera = renderWorld.cameras.get(world.entityIndex(cameraEntity));
        engine.renderer.renderToTarget(readbackTarget, renderWorld, camera);
        return (await readbackTarget.readColorAttachment()).data;
    }

    function changedPixelCount(left: Uint8Array, right: Uint8Array, threshold = 2): number {
        if (left.length !== right.length) {
            throw new RangeError('Visual readbacks must have equal sizes.');
        }
        let count = 0;
        for (let offset = 0; offset < left.length; offset += 4) {
            if (
                Math.abs((left[offset] ?? 0) - (right[offset] ?? 0)) > threshold ||
                Math.abs((left[offset + 1] ?? 0) - (right[offset + 1] ?? 0)) > threshold ||
                Math.abs((left[offset + 2] ?? 0) - (right[offset + 2] ?? 0)) > threshold
            ) {
                count++;
            }
        }
        return count;
    }

    function foregroundColorCount(data: Uint8Array, background: readonly number[]): number {
        const colors = new Set<string>();
        for (let offset = 0; offset < data.length; offset += 4) {
            const red = data[offset] ?? 0;
            const green = data[offset + 1] ?? 0;
            const blue = data[offset + 2] ?? 0;
            if (
                Math.abs(red - (background[0] ?? 0)) <= 1 &&
                Math.abs(green - (background[1] ?? 0)) <= 1 &&
                Math.abs(blue - (background[2] ?? 0)) <= 1
            ) {
                continue;
            }
            colors.add(`${String(red)},${String(green)},${String(blue)}`);
        }
        return colors.size;
    }

    async function readViewportSemantic(): Promise<number[]> {
        const viewportTarget = engine.renderer.createRenderTarget({
            width: 37,
            height: 23,
            depthStencilAttachment: false,
            label: 'ECS CameraBlock viewport diagnostics'
        });
        const diagnosticWorld = await createRenderWorld();
        const diagnosticCamera = diagnosticWorld.createEntity();
        diagnosticWorld.add(diagnosticCamera, LocalTransform, {});
        diagnosticWorld.add(diagnosticCamera, PerspectiveCamera, {
            aspect: 37 / 23,
            near: 0.1,
            far: 10
        });
        const diagnosticMesh = diagnosticWorld.createEntity();
        diagnosticWorld.add(diagnosticMesh, LocalTransform, {});
        diagnosticWorld.add(diagnosticMesh, MeshRenderer, {
            geometry: new Geometry({
                vertices: new GeometryData(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
            }),
            material: new ShaderMaterial({
                sourceRevision: 'EcsViewportSemanticDiagnostics',
                state: { depthTest: false, depthWrite: false, cullMode: 'none' },
                attributes: { a_position: 'POSITION' },
                vs: `#version 300 es
                    in vec3 a_position;
                    void main(void) {
                        gl_Position = vec4(a_position, 1.0);
                    }
                `,
                fs: `#version 300 es
                    precision highp float;
                    ${cameraBlockSource}
                    layout(location = 0) out vec4 fragmentColor;
                    void main(void) {
                        fragmentColor = u_viewport / 255.0;
                    }
                `
            })
        });
        diagnosticWorld.update(0);
        const renderWorld = diagnosticWorld.getResource(RENDER_WORLD);
        engine.renderer.renderToTarget(
            viewportTarget,
            renderWorld,
            renderWorld.cameras.get(diagnosticWorld.entityIndex(diagnosticCamera))
        );
        const bytes = Array.from(
            (
                await viewportTarget.readColorAttachment({
                    x: 18,
                    y: 11,
                    width: 1,
                    height: 1
                })
            ).data
        );
        viewportTarget.destroy();
        diagnosticWorld.destroy();
        return bytes;
    }

    const rotatedLit = await renderAndRead();
    world.set(meshEntity, LocalTransform, {});
    world.update(0);
    const unrotatedLit = await renderAndRead();
    world.set(meshEntity, LocalTransform, { rotation: rotation(22, 35, 0) });
    world.set(directionalEntity, DirectionalLight, {
        color: [1, 0.96, 0.9],
        amount: 3,
        enabled: false,
        direction: [-1, -0.8, -0.5]
    });
    world.update(0);
    const rotatedAmbientOnly = await renderAndRead();
    readbackTarget.destroy();
    const viewportBytes = await readViewportSemantic();

    const backgroundPixel = Array.from(rotatedLit.subarray(0, 4));
    window.__HILO3D_VISUAL_RESULT__ = {
        backend: engine.renderer.backend,
        readback: {
            backgroundPixel,
            transformedPixelCount: changedPixelCount(rotatedLit, unrotatedLit),
            directionalLightPixelCount: changedPixelCount(rotatedLit, rotatedAmbientOnly),
            litForegroundColorCount: foregroundColorCount(rotatedLit, backgroundPixel),
            viewportBytes
        }
    };
}

window.__HILO3D_VISUAL_CONTINUE__ = (): void => {
    delete window.__HILO3D_VISUAL_CONTINUE__;
    void runReadbackDiagnostics();
};

addEventListener(
    'beforeunload',
    () => {
        engine.destroy();
        world.destroy();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_VISUAL_FIRST_FRAME__?: { readonly backend: string };
        __HILO3D_VISUAL_CONTINUE__?: () => void;
        __HILO3D_VISUAL_RESULT__?: {
            readonly backend: string;
            readonly readback: {
                readonly backgroundPixel: number[];
                readonly transformedPixelCount: number;
                readonly directionalLightPixelCount: number;
                readonly litForegroundColorCount: number;
                readonly viewportBytes: number[];
            };
        };
    }
}
