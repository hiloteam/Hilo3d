import Class from '../core/Class';
import math from '../math/math';
import OrthographicCamera from '../camera/OrthographicCamera';
import PerspectiveCamera from '../camera/PerspectiveCamera';
import Framebuffer from '../renderer/Framebuffer';
import semantic from '../material/semantic';
import GeometryMaterial from '../material/GeometryMaterial';
import Color from '../math/Color';
import Matrix4 from '../math/Matrix4';
import constants from '../constants';

const {
    DEPTH,
    BACK
} = constants;

let shadowMaterial = null;
const clearColor = new Color(1, 1, 1);
const tempMatrix4 = new Matrix4();

const isNeedRenderMesh = function(mesh) {
    return mesh.material.castShadows;
};

/**
 * @class
 * @private
 */
const LightShadow = Class.create(/** @lends LightShadow.prototype */{
    isLightShadow: true,
    className: 'LightShadow',

    light: null,
    renderer: null,
    framebuffer: null,
    camera: null,
    width: 1024,
    height: 1024,
    maxBias: 0.05,
    minBias: 0.005,
    /**
     * 阴影摄像机信息
     * @type {Object}
     */
    cameraInfo: null,
    debug: false,
    constructor(params) {
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
    },
    createFramebuffer() {
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
    },
    updateLightCamera(currentCamera) {
        if (this.light.isDirectionalLight) {
            this.updateDirectionalLightCamera(currentCamera);
        } else if (this.light.isSpotLight) {
            this.updateSpotLightCamera(currentCamera);
        }
    },
    updateDirectionalLightCamera(currentCamera) {
        const light = this.light;

        this.camera.lookAt(light.direction);

        if (this.cameraInfo) {
            this.updateCustumCamera(this.cameraInfo);
        } else {
            const geometry = currentCamera.getGeometry();
            if (geometry) {
                this.camera.updateViewMatrix();
                tempMatrix4.multiply(this.camera.viewMatrix, currentCamera.worldMatrix);
                const bounds = geometry.getBounds(tempMatrix4);

                this.camera.near = -bounds.zMax;
                this.camera.far = -bounds.zMin;
                this.camera.left = bounds.xMin;
                this.camera.right = bounds.xMax;
                this.camera.bottom = bounds.yMin;
                this.camera.top = bounds.yMax;
            }
        }

        this.camera.updateViewMatrix();
    },
    updateCustumCamera(cameraInfo) {
        for (let name in cameraInfo) {
            this.camera[name] = cameraInfo[name];
        }
    },
    updateSpotLightCamera(currentCamera) {
        const light = this.light;
        this.camera.lookAt(light.direction);

        if (this.cameraInfo) {
            this.updateCustumCamera(this.cameraInfo);
        } else {
            this.camera.fov = light.outerCutoff * 2;
            this.camera.near = 0.01;
            this.camera.far = currentCamera.far;
            this.camera.aspect = 1;
        }

        this.camera.updateViewMatrix();
    },
    createCamera(currentCamera) {
        if (!this.camera) {
            if (this.light.isDirectionalLight) {
                this.camera = new OrthographicCamera();
            } else if (this.light.isSpotLight) {
                this.camera = new PerspectiveCamera();
            }
            this.camera.addTo(this.light);
        }

        if (this._cameraMatrixVersion !== currentCamera.matrixVersion) {
            this.updateLightCamera(currentCamera);
            this._cameraMatrixVersion = currentCamera.matrixVersion;
        }
    },
    createShadowMap(currentCamera) {
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
                writeOriginData: true
            });
        }

        framebuffer.bind();
        renderer.state.viewport(0, 0, this.width, this.height);
        renderer.clear(clearColor);
        camera.updateViewProjectionMatrix();
        semantic.setCamera(camera);
        renderer.forceMaterial = shadowMaterial;
        this.renderShadowScene(renderer);
        delete renderer.forceMaterial;
        framebuffer.unbind();
        semantic.setCamera(currentCamera);
        renderer.viewport();
    },
    renderShadowScene(renderer) {
        const renderList = renderer.renderList;
        renderList.traverse((mesh) => {
            if (isNeedRenderMesh(mesh)) {
                renderer.renderMesh(mesh);
            }
        }, (instancedMeshes) => {
            renderer.renderInstancedMeshes(instancedMeshes.filter(mesh => isNeedRenderMesh(mesh)));
        });
    },
    showShadowMap() {
        this.renderer.on('afterRender', () => {
            this.framebuffer.render(0, 0.7, 0.3, 0.3);
        });
    }
});

export default LightShadow;
