import math from '../math/math';
import OrthographicCamera from '../camera/OrthographicCamera';
import PerspectiveCamera from '../camera/PerspectiveCamera';
import Framebuffer from '../renderer/Framebuffer';
import semantic from '../material/semantic';
import GeometryMaterial from '../material/GeometryMaterial';
import Color from '../math/Color';
import Matrix4 from '../math/Matrix4';
import { DEPTH } from '../constants/Hilo';
import { BACK } from '../constants/webgl';
import CameraHelper from '../helper/CameraHelper';
import type Camera from '../camera/Camera';
import type Mesh from '../core/Mesh';
import type Material from '../material/Material';
import type WebGLRenderer from '../renderer/WebGLRenderer';
import type DirectionalLight from './DirectionalLight';
import type SpotLight from './SpotLight';
import type Light from './Light';
import type { ShadowCameraParameters } from './Light';

let shadowMaterial: GeometryMaterial | null = null;
const clearColor = new Color(1, 1, 1);
const tempMatrix4 = new Matrix4();
type ShadowMesh = Mesh & { material: Material };

const isNeedRenderMesh = (mesh: Mesh): mesh is ShadowMesh => {
    return mesh.material?.castShadows === true;
};

export type ShadowCamera = OrthographicCamera | PerspectiveCamera;
type ClippingCamera = Camera & { near: number; far: number | null };

function hasClippingPlanes(camera: Camera): camera is ClippingCamera {
    return (
        'near' in camera &&
        typeof camera.near === 'number' &&
        'far' in camera &&
        (typeof camera.far === 'number' || camera.far === null)
    );
}

function finiteFarPlane(camera: ClippingCamera): number {
    return camera.far ?? camera.near * 1000;
}

function isDirectionalLight(light: Light): light is DirectionalLight {
    return light.isDirectionalLight;
}

function isSpotLight(light: Light): light is SpotLight {
    return light.isSpotLight;
}

export interface LightShadowParameters {
    light: Light;
    renderer: WebGLRenderer;
    width?: number;
    height?: number;
    maxBias?: number;
    minBias?: number;
    cameraInfo?: ShadowCameraParameters;
    debug?: boolean;
}
class LightShadow {
    id: string;
    isLightShadow = true;
    className = 'LightShadow';
    light: Light;
    renderer: WebGLRenderer;
    framebuffer: Framebuffer | null = null;
    camera: ShadowCamera | null = null;
    width = 1024;
    height = 1024;
    maxBias = 0.05;
    minBias = 0.005;
    cameraInfo: ShadowCameraParameters | null = null;
    debug = false;
    private cameraMatrixVersion = -1;
    private cameraHelper: CameraHelper | null = null;
    /**
     * @param params -
     * - `params.light`:
     * - `params.renderer`:
     * - `params.cameraInfo`:
     * - `params.width`:
     * - `params.height`:
     * - `params.debug`:
     */
    constructor(params: LightShadowParameters) {
        this.light = params.light;
        this.renderer = params.renderer;
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
    }
    createFramebuffer(): void {
        if (this.framebuffer) {
            return;
        }
        this.framebuffer = new Framebuffer(this.renderer, {
            width: this.width,
            height: this.height
        });
        if (this.debug) {
            this.showShadowMap();
        }
    }
    updateLightCamera(currentCamera: Camera): void {
        if (isDirectionalLight(this.light)) {
            this.updateDirectionalLightCamera(currentCamera);
        } else if (isSpotLight(this.light)) {
            this.updateSpotLightCamera(currentCamera);
        }
    }
    updateDirectionalLightCamera(currentCamera: Camera): void {
        if (!(this.camera instanceof OrthographicCamera)) {
            throw new TypeError('Directional-light shadows require an orthographic camera.');
        }
        const camera = this.camera;
        const light = this.light;
        if (!isDirectionalLight(light)) {
            throw new TypeError('Directional-light shadow received an incompatible light.');
        }
        camera.lookAt(light.direction);
        if (this.cameraInfo) {
            this.updateCustomCamera(camera, this.cameraInfo, currentCamera);
        } else {
            const geometry = currentCamera.getGeometry();
            camera.updateViewMatrix();
            tempMatrix4.multiply(camera.viewMatrix, currentCamera.worldMatrix);
            const bounds = geometry.getBounds(tempMatrix4);
            camera.near = -bounds.zMax;
            camera.far = -bounds.zMin;
            camera.left = bounds.xMin;
            camera.right = bounds.xMax;
            camera.bottom = bounds.yMin;
            camera.top = bounds.yMax;
        }
        camera.updateViewMatrix();
    }
    updateCustomCamera(
        camera: ShadowCamera,
        cameraInfo: ShadowCameraParameters,
        currentCamera: Camera
    ): void {
        Object.assign(camera, cameraInfo);
        if (cameraInfo.far === undefined) {
            if (!hasClippingPlanes(currentCamera)) {
                throw new TypeError(
                    'The active camera must expose numeric near and far clipping planes.'
                );
            }
            camera.far = finiteFarPlane(currentCamera);
        }
        if (cameraInfo.near === undefined) {
            if (!hasClippingPlanes(currentCamera)) {
                throw new TypeError(
                    'The active camera must expose numeric near and far clipping planes.'
                );
            }
            camera.near = currentCamera.near;
        }
    }
    updateSpotLightCamera(currentCamera: Camera): void {
        if (!(this.camera instanceof PerspectiveCamera)) {
            throw new TypeError('Spot-light shadows require a perspective camera.');
        }
        const camera = this.camera;
        const light = this.light;
        if (!isSpotLight(light)) {
            throw new TypeError('Spot-light shadow received an incompatible light.');
        }
        camera.lookAt(light.direction);
        if (this.cameraInfo) {
            this.updateCustomCamera(camera, this.cameraInfo, currentCamera);
        } else {
            if (!hasClippingPlanes(currentCamera)) {
                throw new TypeError(
                    'The active camera must expose numeric near and far clipping planes.'
                );
            }
            camera.fov = light.outerCutoff * 2;
            camera.near = 0.01;
            camera.far = finiteFarPlane(currentCamera);
            camera.aspect = 1;
        }
        camera.updateViewMatrix();
    }
    createCamera(currentCamera: Camera): void {
        if (!this.camera) {
            if (isDirectionalLight(this.light)) {
                this.camera = new OrthographicCamera();
            } else if (isSpotLight(this.light)) {
                this.camera = new PerspectiveCamera();
            } else {
                throw new TypeError('Only directional and spot lights support planar shadows.');
            }
            this.camera.addTo(this.light);
            this.createCameraHelper();
        }
        if (this.light.isDirty || this.cameraMatrixVersion !== currentCamera.matrixVersion) {
            this.updateLightCamera(currentCamera);
            this.cameraMatrixVersion = currentCamera.matrixVersion;
            this.light.isDirty = false;
        }
    }
    createShadowMap(currentCamera: Camera): void {
        this.createFramebuffer();
        this.createCamera(currentCamera);
        const { renderer, framebuffer, camera } = this;
        if (!framebuffer || !camera) throw new Error('Shadow resources were not initialized.');
        shadowMaterial ??= new GeometryMaterial({
            vertexType: DEPTH,
            side: BACK,
            writeOriginData: false
        });
        framebuffer.bind();
        try {
            renderer.state.viewport(0, 0, this.width, this.height);
            renderer.clear(clearColor);
            camera.updateViewProjectionMatrix();
            semantic.setCamera(camera);
            this.renderShadowScene(renderer, shadowMaterial);
        } finally {
            framebuffer.unbind();
            semantic.setCamera(currentCamera);
            renderer.viewport();
        }
    }
    renderShadowScene(renderer: WebGLRenderer, fallbackMaterial: GeometryMaterial): void {
        const preForceMaterial = renderer.forceMaterial;
        const renderList = renderer.renderList;
        try {
            renderList.traverse(
                mesh => {
                    if (isNeedRenderMesh(mesh)) {
                        renderer.forceMaterial = mesh.material.getShadowMaterial(fallbackMaterial);
                        renderer.renderMesh(mesh);
                    }
                },
                instancedMeshes => {
                    const shadowMeshes = instancedMeshes.filter(mesh => isNeedRenderMesh(mesh));
                    const firstMesh = shadowMeshes[0];
                    if (!firstMesh) return;
                    renderer.forceMaterial = firstMesh.material.getShadowMaterial(fallbackMaterial);
                    renderer.renderInstancedMeshes(shadowMeshes);
                }
            );
        } finally {
            renderer.forceMaterial = preForceMaterial;
        }
    }
    showShadowMap(): void {
        this.renderer.on('afterRender', () => {
            this.framebuffer?.render(0, 0.7, 0.3, 0.3);
        });
    }
    private createCameraHelper(): void {
        if (!this.debug) {
            return;
        }
        const { light, camera } = this;
        if (!camera) throw new Error('Shadow camera is unavailable.');
        if (!this.cameraHelper) {
            this.cameraHelper = new CameraHelper({
                camera,
                color: new Color(0, 1, 0)
            });
            light.addChild(this.cameraHelper);
        }
    }
}
export default LightShadow;
