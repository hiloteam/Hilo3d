import math from '../math/math';
import OrthographicCamera from '../camera/OrthographicCamera';
import PerspectiveCamera from '../camera/PerspectiveCamera';
import Framebuffer from '../renderer/Framebuffer';
import semantic from '../material/semantic';
import GeometryMaterial from '../material/GeometryMaterial';
import Color from '../math/Color';
import Matrix4 from '../math/Matrix4';
import constants from '../constants';
import CameraHelper from '../helper/CameraHelper';

const {
    DEPTH,
    BACK
} = constants;

let shadowMaterial: GeometryMaterial | null = null;
const clearColor = new Color(1, 1, 1);
const tempMatrix4 = new Matrix4();

const isNeedRenderMesh = function(mesh: any): boolean {
    return mesh.material.castShadows;
};

interface LightShadowParams {
    light: any;
    renderer: any;
    cameraInfo?: any;
    width: number;
    height: number;
    debug?: boolean;
}

/**
 * @class
 */
class LightShadow {
    /**
     * @type {boolean}
     * @default true
     */
    readonly isLightShadow: boolean = true;

    /**
     * @type {string}
     * @default LightShadow
     */
    readonly className: string = 'LightShadow';

    /**
     * @type {string}
     */
    id: string;

    /**
     * @type {Light}
     * @default null
     */
    light: any = null;

    /**
     * @type {WebGLRenderer}
     * @default null
     */
    renderer: any = null;

    /**
     * @type {Framebuffer}
     * @default null
     */
    framebuffer: Framebuffer | null = null;

    /**
     * @type {Camera}
     * @default null
     */
    camera: OrthographicCamera | PerspectiveCamera | null = null;

    /**
     * @type {number}
     * @default 1024
     */
    width: number = 1024;

    /**
     * @type {number}
     * @default 1024
     */
    height: number = 1024;

    /**
     * @type {number}
     * @default 0.05
     */
    maxBias: number = 0.05;

    /**
     * @type {number}
     * @default 0.005
     */
    minBias: number = 0.005;

    /**
     * @type {any}
     * @default null
     */
    cameraInfo: any = null;

    debug: boolean = false;

    private _cameraMatrixVersion?: number;

    private _cameraHelper?: CameraHelper;

    /**
     * @constructs
     * @param {object} params
     * @param {Light} params.light
     * @param {WebGLRenderer} params.renderer
     * @param {object} [params.cameraInfo]
     * @param {number} params.width
     * @param {number} params.height
     * @param {boolean} [params.debug]
     */
    constructor(params: LightShadowParams) {
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

    updateLightCamera(currentCamera: any): void {
        if (this.light.isDirectionalLight) {
            this.updateDirectionalLightCamera(currentCamera);
        } else if (this.light.isSpotLight) {
            this.updateSpotLightCamera(currentCamera);
        }
    }

    updateDirectionalLightCamera(currentCamera: any): void {
        const light = this.light;

        (this.camera as OrthographicCamera).lookAt(light.direction);

        if (this.cameraInfo) {
            this.updateCustomCamera(this.cameraInfo, currentCamera);
        } else {
            const geometry = currentCamera.getGeometry();
            if (geometry) {
                this.camera!.updateViewMatrix();
                tempMatrix4.multiply(this.camera!.viewMatrix, currentCamera.worldMatrix);
                const bounds = geometry.getBounds(tempMatrix4);

                const orthoCamera = this.camera as OrthographicCamera;
                orthoCamera.near = -bounds.zMax;
                orthoCamera.far = -bounds.zMin;
                orthoCamera.left = bounds.xMin;
                orthoCamera.right = bounds.xMax;
                orthoCamera.bottom = bounds.yMin;
                orthoCamera.top = bounds.yMax;
            }
        }

        this.camera!.updateViewMatrix();
    }

    updateCustomCamera(cameraInfo: any, currentCamera: any): void {
        for (let name in cameraInfo) {
            (this.camera as any)[name] = cameraInfo[name];
        }

        if (!cameraInfo.far) {
            (this.camera as any).far = currentCamera.far;
        }

        if (!cameraInfo.near) {
            (this.camera as any).near = currentCamera.near;
        }
    }

    updateSpotLightCamera(currentCamera: any): void {
        const light = this.light;
        (this.camera as PerspectiveCamera).lookAt(light.direction);

        if (this.cameraInfo) {
            this.updateCustomCamera(this.cameraInfo, currentCamera);
        } else {
            const perspCamera = this.camera as PerspectiveCamera;
            perspCamera.fov = light.outerCutoff * 2;
            perspCamera.near = 0.01;
            perspCamera.far = currentCamera.far;
            perspCamera.aspect = 1;
        }

        this.camera!.updateViewMatrix();
    }

    createCamera(currentCamera: any): void {
        if (!this.camera) {
            if (this.light.isDirectionalLight) {
                this.camera = new OrthographicCamera();
            } else if (this.light.isSpotLight) {
                this.camera = new PerspectiveCamera();
            }
            this.camera!.addTo(this.light);
            this._createCameraHelper();
        }

        if (this.light.isDirty || this._cameraMatrixVersion !== currentCamera.matrixVersion) {
            this.updateLightCamera(currentCamera);
            this._cameraMatrixVersion = currentCamera.matrixVersion;
            this.light.isDirty = false;
        }
    }

    createShadowMap(currentCamera: any): void {
        this.createFramebuffer();
        this.createCamera(currentCamera);

        const {
            renderer,
            framebuffer,
            camera
        } = this;

        if (!shadowMaterial) {
            shadowMaterial = new GeometryMaterial({
                vertexType: DEPTH,
                side: BACK,
                writeOriginData: false
            });
        }

        framebuffer!.bind();
        renderer.state.viewport(0, 0, this.width, this.height);
        renderer.clear(clearColor);
        camera!.updateViewProjectionMatrix();
        semantic.setCamera(camera);
        this.renderShadowScene(renderer, shadowMaterial);
        framebuffer!.unbind();
        semantic.setCamera(currentCamera);
        renderer.viewport();
    }

    renderShadowScene(renderer: any, shadowMaterial: GeometryMaterial): void {
        const preForceMaterial = renderer.forceMaterial;

        const renderList = renderer.renderList;
        renderList.traverse((mesh: any) => {
            if (isNeedRenderMesh(mesh)) {
                renderer.forceMaterial = mesh.material.getShadowMaterial(shadowMaterial);
                renderer.renderMesh(mesh);
            }
        }, (instancedMeshes: any[]) => {
            if (instancedMeshes.length) {
                renderer.forceMaterial = instancedMeshes[0].material.getShadowMaterial(shadowMaterial);
                renderer.renderInstancedMeshes(instancedMeshes.filter(mesh => isNeedRenderMesh(mesh)));
            }
        });

        renderer.forceMaterial = preForceMaterial;
    }

    showShadowMap(): void {
        this.renderer.on('afterRender', () => {
            this.framebuffer!.render(0, 0.7, 0.3, 0.3);
        });
    }

    private _createCameraHelper(): void {
        if (!this.debug) {
            return;
        }

        const {
            light,
            camera,
        } = this;

        if (!this._cameraHelper) {
            this._cameraHelper = new CameraHelper({
                camera,
                color: new Color(0, 1, 0),
            });

            light.addChild(this._cameraHelper);
        }
    }
}

export default LightShadow;
