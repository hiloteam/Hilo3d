import PerspectiveCamera from '../camera/PerspectiveCamera';
import type Camera from '../camera/Camera';
import type Mesh from '../core/Mesh';
import type Material from '../material/Material';
import Framebuffer from '../renderer/Framebuffer';
import type WebGLRenderer from '../renderer/WebGLRenderer';
import CubeTexture from '../texture/CubeTexture';
import capabilities from '../renderer/capabilities';
import semantic from '../material/semantic';
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

let shadowMaterial: GeometryMaterial | null = null;
const clearColor = new Color(0, 0, 0, 0);
const tempVector3 = new Vector3();
const lookAtMap = [
    [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
    [0, -1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, -1, 0, 0, -1, 0]
] as const;

type ClippingCamera = Camera & { near: number; far: number | null };

function hasClippingPlanes(camera: Camera): camera is ClippingCamera {
    return (
        'near' in camera &&
        typeof camera.near === 'number' &&
        'far' in camera &&
        (typeof camera.far === 'number' || camera.far === null)
    );
}

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
        const { gl } = this.state;
        const texture = this.texture;
        if (!(texture instanceof CubeTexture)) {
            throw new TypeError('Cube shadow framebuffer requires a cube texture attachment.');
        }
        const glTexture = texture.getGLTexture(this.state);
        this.state.activeTexture(TEXTURE0 + capabilities.MAX_TEXTURE_INDEX);
        this.state.bindTexture(this.target, glTexture);
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
        this.framebuffer = new CubeShadowFramebuffer(this.renderer, {
            target: TEXTURE_CUBE_MAP,
            width: this.width,
            height: this.height
        });
    }

    override updateLightCamera(currentCamera: Camera): void {
        if (!hasClippingPlanes(currentCamera)) {
            throw new TypeError(
                'Point-light shadows require numeric near and far clipping planes.'
            );
        }
        if (!(this.camera instanceof PerspectiveCamera)) {
            throw new TypeError('Point-light shadows require a perspective shadow camera.');
        }
        this.camera.fov = 90;
        this.camera.near = currentCamera.near;
        this.camera.far = currentCamera.far ?? currentCamera.near * 1000;
        this.camera.aspect = 1;
        this.camera.updateViewMatrix();
    }

    override createCamera(currentCamera: Camera): void {
        if (this.camera) return;
        this.camera = new PerspectiveCamera();
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
                tempVector3.fromArray(lookAtMap[0], index * 3).add(camera.position);
                camera.up.fromArray(lookAtMap[1], index * 3);
                camera.lookAt(tempVector3);
                camera.updateViewProjectionMatrix();
                renderer.clear(clearColor);
                semantic.setCamera(camera);
                renderer.forceMaterial = shadowMaterial;
                this.renderShadowScene(renderer);
            }
            camera.matrix.identity();
            camera.updateViewProjectionMatrix();
        } finally {
            renderer.forceMaterial = previousForceMaterial;
            framebuffer.unbind();
            semantic.setCamera(currentCamera);
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
