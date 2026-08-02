import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    Geometry,
    GeometryData,
    Mesh,
    Node,
    PBRMaterial,
    PerspectiveCamera,
    ShaderMaterial,
    Stage,
    Vector3
} from '../../../src/Hilo3d';
import cameraBlockSource from '../../../src/shader/chunk/cameraBlock.glsl?raw';

const container = document.querySelector<HTMLElement>('#stage');
if (!container) throw new Error('Visual fixture container is missing.');
const backendValue = new URLSearchParams(location.search).get('backend');
if (backendValue !== 'webgl2' && backendValue !== 'webgpu') {
    throw new TypeError('Visual fixture requires backend=webgl2 or backend=webgpu.');
}

const clearColor = new Color(0.08, 0.1, 0.14);
const camera = new PerspectiveCamera({ aspect: 4 / 3, near: 0.1, far: 100, z: 4 });
const stage = await Stage.create({
    backend: backendValue,
    container,
    camera,
    width: 640,
    height: 480,
    pixelRatio: 1,
    antialias: false,
    clearColor
});

const mesh = new Mesh({
    geometry: new BoxGeometry(),
    material: new PBRMaterial({
        baseColor: new Color(0.82, 0.19, 0.12),
        metallic: 0.2,
        roughness: 0.55
    }),
    rotationX: 22,
    rotationY: 35
});
stage.addChild(mesh);
stage.addChild(new AmbientLight({ color: new Color(1, 1, 1), amount: 0.45 }));
const directionalLight = new DirectionalLight({
    color: new Color(1, 0.96, 0.9),
    amount: 3,
    direction: new Vector3(-1, -0.8, -0.5)
});
stage.addChild(directionalLight);

stage.tick(0);
await stage.renderer.waitForIdle();
window.__HILO3D_VISUAL_FIRST_FRAME__ = { backend: stage.renderer.backend };

async function runReadbackDiagnostics(): Promise<void> {
    const readbackTarget = stage.renderer.createRenderTarget({
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
        label: 'Visual PBR diagnostics'
    });

    async function renderAndRead(): Promise<Uint8Array> {
        stage.renderer.renderToTarget(readbackTarget, stage, camera);
        return (await readbackTarget.readColorAttachment()).data;
    }

    function changedPixelCount(left: Uint8Array, right: Uint8Array, threshold = 2): number {
        if (left.length !== right.length)
            throw new RangeError('Visual readbacks must have equal sizes.');
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
        const viewportTarget = stage.renderer.createRenderTarget({
            width: 37,
            height: 23,
            depthStencilAttachment: false,
            label: 'CameraBlock viewport diagnostics'
        });
        const viewportScene = new Node();
        viewportScene.addChild(
            new Mesh({
                geometry: new Geometry({
                    vertices: new GeometryData(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
                }),
                material: new ShaderMaterial({
                    sourceRevision: 'ViewportSemanticDiagnostics',
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
            })
        );
        stage.renderer.renderToTarget(viewportTarget, viewportScene, camera);
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
        return bytes;
    }

    const rotatedLit = await renderAndRead();
    mesh.setRotation(0, 0, 0);
    const unrotatedLit = await renderAndRead();
    mesh.setRotation(22, 35, 0);
    directionalLight.enabled = false;
    const rotatedAmbientOnly = await renderAndRead();
    directionalLight.enabled = true;
    readbackTarget.destroy();
    const viewportBytes = await readViewportSemantic();

    const backgroundPixel = Array.from(rotatedLit.subarray(0, 4));
    window.__HILO3D_VISUAL_RESULT__ = {
        backend: stage.renderer.backend,
        readback: {
            backgroundPixel,
            transformedPixelCount: changedPixelCount(rotatedLit, unrotatedLit),
            directionalLightPixelCount: changedPixelCount(rotatedLit, rotatedAmbientOnly),
            litForegroundColorCount: foregroundColorCount(rotatedLit, backgroundPixel),
            viewportBytes
        }
    };
}

window.__HILO3D_VISUAL_CONTINUE__ = () => {
    delete window.__HILO3D_VISUAL_CONTINUE__;
    void runReadbackDiagnostics();
};

declare global {
    interface Window {
        __HILO3D_VISUAL_FIRST_FRAME__?: { backend: string };
        __HILO3D_VISUAL_CONTINUE__?: () => void;
        __HILO3D_VISUAL_RESULT__?: {
            backend: string;
            readback: {
                backgroundPixel: number[];
                transformedPixelCount: number;
                directionalLightPixelCount: number;
                litForegroundColorCount: number;
                viewportBytes: number[];
            };
        };
    }
}
