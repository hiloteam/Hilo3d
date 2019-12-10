import Class from '../core/Class';
import PerspectiveCamera from '../camera/PerspectiveCamera';
import Framebuffer from '../renderer/Framebuffer';
import CubeTexture from '../texture/CubeTexture';
import capabilities from '../renderer/capabilities';
import semantic from '../material/semantic';
import GeometryMaterial from '../material/GeometryMaterial';
import Color from '../math/Color';
import Vector3 from '../math/Vector3';
import LightShadow from './LightShadow';
import log from '../utils/log';
import constants from '../constants';

const {
    DISTANCE,
    BACK,
    TEXTURE_CUBE_MAP,
    TEXTURE0,
    TEXTURE_CUBE_MAP_POSITIVE_X,
    NEAREST,
    FRAMEBUFFER,
    FRAMEBUFFER_COMPLETE,
} = constants;

let shadowMaterial = null;
const clearColor = new Color(0, 0, 0, 0);
const tempVector3 = new Vector3();

const LookAtMap = [
    [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
    [0, -1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, -1, 0, 0, -1, 0]
];

const isNeedRenderMesh = function(mesh, camera) {
    if (mesh.material.castShadows) {
        if (!mesh.frustumTest) {
            return true;
        }

        if (camera.isMeshVisible(mesh)) {
            return true;
        }
    }

    return false;
};

/**
 * @class
 * @private
 */
const CubeLightShadow = Class.create(/** @lends CubeLightShadow.prototype */ {
    isLightShadow: true,
    className: 'CubeLightShadow',
    Extends: LightShadow,

    light: null,
    renderer: null,
    framebuffer: null,
    camera: null,
    width: 1024,
    height: 1024,
    maxBias: 0.05,
    minBias: 0.005,
    debug: false,
    constructor(params) {
        CubeLightShadow.superclass.constructor.call(this, params);
    },
    createFramebuffer() {
        if (this.framebuffer) {
            return;
        }

        const size = 1024;
        this.framebuffer = new Framebuffer(this.renderer, {
            target: TEXTURE_CUBE_MAP,
            width: size,
            height: size,
            createTexture() {
                const state = this.state;
                const gl = state.gl;
                const texture = new CubeTexture({
                    image: [null, null, null, null, null, null],
                    type: this.type,
                    format: this.format,
                    internalFormat: this.internalFormat,
                    magFilter: NEAREST,
                    minFilter: NEAREST,
                    width: size,
                    height: size
                });

                if (gl.checkFramebufferStatus(FRAMEBUFFER) !== FRAMEBUFFER_COMPLETE) {
                    log.warn('Framebuffer is not complete', gl.checkFramebufferStatus(FRAMEBUFFER));
                }
                return texture;
            },
            bindTexture(index) {
                index = index || 0;
                const state = this.state;
                const gl = state.gl;
                const glTexture = this.texture.getGLTexture(state);
                state.activeTexture(TEXTURE0 + capabilities.MAX_TEXTURE_INDEX);
                state.bindTexture(this.target, glTexture);
                gl.framebufferTexture2D(FRAMEBUFFER, this.attachment, TEXTURE_CUBE_MAP_POSITIVE_X + index, glTexture, 0);
            }
        });
    },
    updateLightCamera(currentCamera) {
        this.camera.fov = 90;
        this.camera.near = currentCamera.near;
        this.camera.far = currentCamera.far;
        this.camera.aspect = 1;
        this.camera.updateViewMatrix();
    },
    createCamera(currentCamera) {
        if (this.camera) {
            return;
        }
        this.camera = new PerspectiveCamera();
        this.updateLightCamera(currentCamera);
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
                vertexType: DISTANCE,
                side: BACK,
                writeOriginData: false
            });
        }

        framebuffer.bind();
        renderer.state.viewport(0, 0, framebuffer.width, framebuffer.height);

        this.light.worldMatrix.getTranslation(camera.position);
        for (let i = 0; i < 6; i++) {
            framebuffer.bindTexture(i);
            tempVector3.fromArray(LookAtMap[0], i * 3).add(camera.position);
            camera.up.fromArray(LookAtMap[1], i * 3);
            camera.lookAt(tempVector3);
            camera.updateViewProjectionMatrix();

            renderer.clear(clearColor);
            semantic.setCamera(camera);
            renderer.forceMaterial = shadowMaterial;
            this.renderShadowScene(renderer);
        }
        camera.matrix.identity();
        camera.updateViewProjectionMatrix();
        delete renderer.forceMaterial;
        framebuffer.unbind();
        semantic.setCamera(currentCamera);
        renderer.viewport();
    },
    renderShadowScene(renderer) {
        const renderList = renderer.renderList;
        const camera = this.camera;
        renderList.traverse((mesh) => {
            if (isNeedRenderMesh(mesh, camera)) {
                renderer.renderMesh(mesh);
            }
        }, (instancedMeshes) => {
            const needRenderMeshes = instancedMeshes.filter(mesh => isNeedRenderMesh(mesh, camera));
            renderer.renderInstancedMeshes(needRenderMeshes);
        });
    }
});

export default CubeLightShadow;
