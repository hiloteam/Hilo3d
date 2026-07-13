import PerspectiveCamera from '../camera/PerspectiveCamera';
import type Camera from '../camera/Camera';
import type Mesh from '../core/Mesh';
import type Material from '../material/Material';
import Framebuffer from '../renderer/Framebuffer';
import type WebGLRenderer from '../renderer/WebGLRenderer';
import CubeTexture from '../texture/CubeTexture';
import GeometryMaterial from '../material/GeometryMaterial';
import Color from '../math/Color';
import Vector3 from '../math/Vector3';
import LightShadow, { type LightShadowParameters } from './LightShadow';
import type PointLight from './PointLight';
import { DISTANCE } from '../constants/Hilo';
import {
    BACK,
    FRAMEBUFFER,
    NEAREST,
    TEXTURE0,
    TEXTURE_CUBE_MAP,
    TEXTURE_CUBE_MAP_POSITIVE_X
} from '../constants/webgl';
import {
    POINT_SHADOW_DIRECTIONS,
    POINT_SHADOW_UPS,
    resolvePointShadowCameraPlanes
} from './PointShadowCamera';

let shadowMaterial: GeometryMaterial | null = null;
const clearColor = new Color(0, 0, 0, 0);
const tempVector3 = new Vector3();
type ShadowMesh = Mesh & { material: Material };

function needsShadowRender(mesh: Mesh, camera: Camera): mesh is ShadowMesh {
    return (
        mesh.material !== null &&
        mesh.material.castShadows &&
        (!mesh.frustumTest || camera.isMeshVisible(mesh))
    );
}

class CubeShadowFramebuffer extends Framebuffer {
    override createTexture(): CubeTexture {
        const texture = new CubeTexture({
            image: [null, null, null, null, null, null],
            type: this.type,
            format: this.format,
            internalFormat: this.internalFormat,
            magFilter: NEAREST,
            minFilter: NEAREST,
            width: this.width,
            height: this.height
        });
        return texture;
    }

    override bindTexture(index = 0): void {
        if (!Number.isSafeInteger(index) || index < 0 || index > 5) {
            throw new RangeError('Cube shadow face index must be an integer from 0 through 5.');
        }
        this.bind();
        const { gl } = this.state;
        const texture = this.texture;
        if (!(texture instanceof CubeTexture) || texture.target !== TEXTURE_CUBE_MAP) {
            throw new TypeError('Cube shadow framebuffer requires a cube texture attachment.');
        }
        const glTexture = texture.getGLTexture(this.state);
        this.state.activeTexture(TEXTURE0 + this.state.capabilities.MAX_TEXTURE_INDEX);
        this.state.bindTexture(TEXTURE_CUBE_MAP, glTexture);
        gl.framebufferTexture2D(
            FRAMEBUFFER,
            this.attachment,
            TEXTURE_CUBE_MAP_POSITIVE_X + index,
            glTexture,
            0
        );
    }
}

export type CubeLightShadowParameters = Omit<LightShadowParameters, 'light'> & {
    light: PointLight;
};

/** Cube-map shadow renderer used by point lights. */
class CubeLightShadow extends LightShadow {
    override className = 'CubeLightShadow';

    override createFramebuffer(): void {
        if (this.framebuffer) return;
        if (this.width !== this.height) {
            throw new RangeError('Point-light cube shadows require equal width and height.');
        }
        this.framebuffer = new CubeShadowFramebuffer(this.renderer, {
            target: TEXTURE_CUBE_MAP,
            width: this.width,
            height: this.height
        });
    }

    override updateLightCamera(currentCamera: Camera): void {
        if (!(this.camera instanceof PerspectiveCamera)) {
            throw new TypeError('Point-light shadows require a perspective shadow camera.');
        }
        const clipping = resolvePointShadowCameraPlanes(this.light, currentCamera);
        this.camera.fov = 90;
        this.camera.near = clipping.near;
        this.camera.far = clipping.far;
        this.camera.aspect = 1;
        this.camera.updateViewMatrix();
    }

    override createCamera(currentCamera: Camera): void {
        this.camera ??= new PerspectiveCamera();
        this.updateLightCamera(currentCamera);
    }

    override createShadowMap(currentCamera: Camera): void {
        this.createFramebuffer();
        this.createCamera(currentCamera);
        const { renderer, framebuffer, camera } = this;
        if (!framebuffer || !(camera instanceof PerspectiveCamera)) {
            throw new Error('Point-light shadow resources were not initialized.');
        }

        shadowMaterial ??= new GeometryMaterial({
            vertexType: DISTANCE,
            side: BACK,
            writeOriginData: false
        });

        const previousForceMaterial = renderer.forceMaterial;
        framebuffer.bind();
        try {
            renderer.state.viewport(0, 0, framebuffer.width, framebuffer.height);
            this.light.worldMatrix.getTranslation(camera.position);
            for (let index = 0; index < 6; index++) {
                framebuffer.bindTexture(index);
                const direction = POINT_SHADOW_DIRECTIONS[index] ?? POINT_SHADOW_DIRECTIONS[0];
                const up = POINT_SHADOW_UPS[index] ?? POINT_SHADOW_UPS[0];
                tempVector3.set(direction[0], direction[1], direction[2]).add(camera.position);
                camera.up.set(up[0], up[1], up[2]);
                camera.lookAt(tempVector3);
                camera.updateViewProjectionMatrix();
                renderer.clear(clearColor);
                this.beginCameraPass(camera, [0, 0, framebuffer.width, framebuffer.height]);
                renderer.forceMaterial = shadowMaterial;
                this.renderShadowScene(renderer);
            }
            camera.matrix.identity();
            camera.updateViewProjectionMatrix();
        } finally {
            renderer.forceMaterial = previousForceMaterial;
            framebuffer.unbind();
            this.beginCameraPass(currentCamera);
            renderer.viewport();
        }
    }

    override renderShadowScene(renderer: WebGLRenderer): void {
        const { camera } = this;
        if (!camera) throw new Error('Point-light shadow camera is unavailable.');
        renderer.renderList.traverse(
            mesh => {
                if (needsShadowRender(mesh, camera)) renderer.renderMesh(mesh);
            },
            instancedMeshes => {
                renderer.renderInstancedMeshes(
                    instancedMeshes.filter(mesh => needsShadowRender(mesh, camera))
                );
            }
        );
    }
}

export default CubeLightShadow;
