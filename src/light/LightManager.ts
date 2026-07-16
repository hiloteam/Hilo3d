import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';
import AmbientLight from './AmbientLight';
import AreaLight from './AreaLight';
import DirectionalLight from './DirectionalLight';
import type Light from './Light';
import PointLight from './PointLight';
import SpotLight from './SpotLight';
import type Camera from '../camera/Camera';
import type WebGLRenderer from '../renderer/WebGLRenderer';
import type Texture from '../texture/Texture';
import type { TextureBinding } from '../texture/Texture';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();
const tempFloat32Array = new Float32Array([0, 0, 0]);

export type LightGroupName =
    'AMBIENT_LIGHTS' | 'POINT_LIGHTS' | 'DIRECTIONAL_LIGHTS' | 'SPOT_LIGHTS' | 'AREA_LIGHTS';

const lightGroupNames: readonly LightGroupName[] = [
    'AMBIENT_LIGHTS',
    'POINT_LIGHTS',
    'DIRECTIONAL_LIGHTS',
    'SPOT_LIGHTS',
    'AREA_LIGHTS'
];

export interface LightInfo {
    AMBIENT_LIGHTS: number;
    POINT_LIGHTS: number;
    DIRECTIONAL_LIGHTS: number;
    SPOT_LIGHTS: number;
    AREA_LIGHTS: number;
    SHADOW_POINT_LIGHTS: number;
    SHADOW_DIRECTIONAL_LIGHTS: number;
    SHADOW_SPOT_LIGHTS: number;
    uid: string;
}

interface ShadowInfo {
    shadowMap?: TextureBinding[];
    shadowMapSize?: Float32Array;
    shadowBias?: Float32Array;
    lightSpaceMatrix?: Float32Array;
}

export interface DirectionalLightInfo extends ShadowInfo {
    colors: Float32Array;
    infos: Float32Array;
}

export interface SpotLightInfo extends DirectionalLightInfo {
    poses: Float32Array;
    dirs: Float32Array;
    cutoffs: Float32Array;
    ranges: Float32Array;
}

export interface PointLightInfo extends ShadowInfo {
    colors: Float32Array;
    infos: Float32Array;
    poses: Float32Array;
    ranges: Float32Array;
    cameras?: Float32Array;
}

export interface AreaLightInfo {
    colors: Float32Array;
    poses: Float32Array;
    width: Float32Array;
    height: Float32Array;
    ltcTexture1: Texture | null;
    ltcTexture2: Texture | null;
}

export interface LightManagerParameters {
    shadowEnabled?: boolean;
    updateCustomInfo?: ((manager: LightManager, camera: Camera) => void) | null;
}
/**
 * 光管理类
 */
class LightManager {
    ambientLights: AmbientLight[] = [];
    directionalLights: DirectionalLight[] = [];
    pointLights: PointLight[] = [];
    spotLights: SpotLight[] = [];
    areaLights: AreaLight[] = [];
    lightInfo: LightInfo = {
        AMBIENT_LIGHTS: 0,
        POINT_LIGHTS: 0,
        DIRECTIONAL_LIGHTS: 0,
        SPOT_LIGHTS: 0,
        AREA_LIGHTS: 0,
        SHADOW_POINT_LIGHTS: 0,
        SHADOW_DIRECTIONAL_LIGHTS: 0,
        SHADOW_SPOT_LIGHTS: 0,
        uid: '0_0_0_0_0_0_0_0'
    };
    directionalInfo: DirectionalLightInfo | null = null;
    pointInfo: PointLightInfo | null = null;
    spotInfo: SpotLightInfo | null = null;
    areaInfo: AreaLightInfo | null = null;
    ambientInfo: Float32Array = new Float32Array(3);
    isLightManager = true;
    className = 'LightManager';
    /**
     * 是否开启阴影
     */
    shadowEnabled = true;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: LightManagerParameters = {}) {
        Object.assign(this, params);
    }
    getRenderOption(option: Record<string, number> = {}): Record<string, number> {
        for (const name of lightGroupNames) {
            const count = this.lightInfo[name];
            if (!count) continue;
            option[name] = count;
            const shadowMapCount = this.getShadowMapCount(name);
            if (shadowMapCount) {
                option[`${name}_SMC`] = shadowMapCount;
            }
        }
        return option;
    }
    /**
     * 增加光
     * @param light - 光源
     * @returns this
     */
    addLight(light: Light): this {
        if (!light.enabled) {
            return this;
        }
        const insert = <Value extends Light>(list: Value[], value: Value): void => {
            if (value.shadow) list.unshift(value);
            else list.push(value);
        };
        if (light instanceof AmbientLight) insert(this.ambientLights, light);
        else if (light instanceof DirectionalLight) insert(this.directionalLights, light);
        else if (light instanceof PointLight) insert(this.pointLights, light);
        else if (light instanceof SpotLight) insert(this.spotLights, light);
        else if (light instanceof AreaLight) insert(this.areaLights, light);
        else throw new TypeError(`Unsupported light type: ${light.constructor.name}.`);
        return this;
    }
    /**
     * 获取方向光信息
     * @param camera - 摄像机
     */
    getDirectionalInfo(camera: Camera): DirectionalLightInfo {
        const colors: number[] = [];
        const infos: number[] = [];
        const shadowMap: TextureBinding[] = [];
        const shadowMapSize: number[] = [];
        const lightSpaceMatrix: number[] = [];
        const shadowBias: number[] = [];
        this.directionalLights.forEach((light, index) => {
            const offset = index * 3;
            light.getRealColor().toRGBArray(colors, offset);
            light.getViewDirection(camera).toArray(infos, offset);
            if (
                light.shadow &&
                light.lightShadow?.framebuffer?.texture &&
                light.lightShadow.camera
            ) {
                shadowMap.push(light.lightShadow.framebuffer.texture);
                shadowMapSize.push(light.lightShadow.width);
                shadowMapSize.push(light.lightShadow.height);
                shadowBias.push(light.lightShadow.minBias, light.lightShadow.maxBias);
                tempMatrix4.copy(camera.worldMatrix);
                tempMatrix4.premultiply(light.lightShadow.camera.viewProjectionMatrix);
                tempMatrix4.toArray(lightSpaceMatrix, index * 16);
            }
        });
        const result: DirectionalLightInfo = {
            colors: new Float32Array(colors),
            infos: new Float32Array(infos)
        };
        if (shadowMap.length) {
            result.shadowMap = shadowMap;
            result.shadowMapSize = new Float32Array(shadowMapSize);
            result.shadowBias = new Float32Array(shadowBias);
            result.lightSpaceMatrix = new Float32Array(lightSpaceMatrix);
        }
        return result;
    }
    /**
     * 获取聚光灯信息
     * @param camera - 摄像机
     */
    getSpotInfo(camera: Camera): SpotLightInfo {
        const colors: number[] = [];
        const infos: number[] = [];
        const poses: number[] = [];
        const dirs: number[] = [];
        const cutoffs: number[] = [];
        const shadowMap: TextureBinding[] = [];
        const shadowMapSize: number[] = [];
        const lightSpaceMatrix: number[] = [];
        const shadowBias: number[] = [];
        const ranges: number[] = [];
        this.spotLights.forEach((light, index) => {
            const offset = index * 3;
            light.getRealColor().toRGBArray(colors, offset);
            light.toInfoArray(infos, offset);
            light.getViewDirection(camera).toArray(dirs, offset);
            ranges.push(light.range);
            cutoffs.push(light.cutoffCos, light.outerCutoffCos);
            camera.getModelViewMatrix(light, tempMatrix4);
            tempMatrix4.getTranslation(tempVector3);
            tempVector3.toArray(poses, offset);
            if (
                light.shadow &&
                light.lightShadow?.framebuffer?.texture &&
                light.lightShadow.camera
            ) {
                shadowMap.push(light.lightShadow.framebuffer.texture);
                shadowMapSize.push(light.lightShadow.width);
                shadowMapSize.push(light.lightShadow.height);
                shadowBias.push(light.lightShadow.minBias, light.lightShadow.maxBias);
                tempMatrix4.multiply(
                    light.lightShadow.camera.viewProjectionMatrix,
                    camera.worldMatrix
                );
                tempMatrix4.toArray(lightSpaceMatrix, index * 16);
            }
        });
        const result: SpotLightInfo = {
            colors: new Float32Array(colors),
            infos: new Float32Array(infos),
            poses: new Float32Array(poses),
            dirs: new Float32Array(dirs),
            cutoffs: new Float32Array(cutoffs),
            ranges: new Float32Array(ranges)
        };
        if (shadowMap.length) {
            result.shadowMap = shadowMap;
            result.shadowMapSize = new Float32Array(shadowMapSize);
            result.shadowBias = new Float32Array(shadowBias);
            result.lightSpaceMatrix = new Float32Array(lightSpaceMatrix);
        }
        return result;
    }
    /**
     * 获取点光源信息
     * @param camera - 摄像机
     */
    getPointInfo(camera: Camera): PointLightInfo {
        const colors: number[] = [];
        const infos: number[] = [];
        const poses: number[] = [];
        const shadowMap: TextureBinding[] = [];
        const lightSpaceMatrix: number[] = [];
        const shadowBias: number[] = [];
        const cameras: number[] = [];
        const ranges: number[] = [];
        this.pointLights.forEach((light, index) => {
            const offset = index * 3;
            light.getRealColor().toRGBArray(colors, offset);
            light.toInfoArray(infos, offset);
            ranges.push(light.range);
            camera.getModelViewMatrix(light, tempMatrix4);
            tempMatrix4.getTranslation(tempVector3);
            tempVector3.toArray(poses, offset);
            if (
                light.shadow &&
                light.lightShadow?.framebuffer?.texture &&
                light.lightShadow.camera
            ) {
                shadowMap.push(light.lightShadow.framebuffer.texture);
                shadowBias.push(light.lightShadow.minBias, light.lightShadow.maxBias);
                camera.worldMatrix.toArray(lightSpaceMatrix, index * 16);
                cameras[index * 2] = light.lightShadow.camera.near;
                cameras[index * 2 + 1] =
                    light.lightShadow.camera.far ?? light.lightShadow.camera.near * 1000;
            }
        });
        const result: PointLightInfo = {
            colors: new Float32Array(colors),
            infos: new Float32Array(infos),
            poses: new Float32Array(poses),
            ranges: new Float32Array(ranges)
        };
        if (shadowMap.length) {
            result.shadowMap = shadowMap;
            result.shadowBias = new Float32Array(shadowBias);
            result.lightSpaceMatrix = new Float32Array(lightSpaceMatrix);
            result.cameras = new Float32Array(cameras);
        }
        return result;
    }
    /**
     * 获取面光源信息
     * @param camera - 摄像机
     */
    getAreaInfo(camera: Camera): AreaLightInfo {
        const colors: number[] = [];
        const poses: number[] = [];
        const width: number[] = [];
        const height: number[] = [];
        let ltcTexture1: Texture | null = null;
        let ltcTexture2: Texture | null = null;
        this.areaLights.forEach((light, index) => {
            const offset = index * 3;
            light.getRealColor().toRGBArray(colors, offset);
            camera.getModelViewMatrix(light, tempMatrix4);
            tempMatrix4.getTranslation(tempVector3);
            tempVector3.toArray(poses, offset);
            const quat = tempMatrix4.getRotation();
            tempMatrix4.fromQuat(quat);
            tempVector3.set(light.width * 0.5, 0, 0);
            tempVector3.transformMat4(tempMatrix4);
            tempVector3.toArray(width, offset);
            tempVector3.set(0.0, light.height * 0.5, 0.0);
            tempVector3.transformMat4(tempMatrix4);
            tempVector3.toArray(height, offset);
            ltcTexture1 = light.ltcTexture1;
            ltcTexture2 = light.ltcTexture2;
        });
        const result: AreaLightInfo = {
            colors: new Float32Array(colors),
            poses: new Float32Array(poses),
            width: new Float32Array(width),
            height: new Float32Array(height),
            ltcTexture1,
            ltcTexture2
        };
        return result;
    }
    /**
     * 获取环境光信息
     */
    getAmbientInfo(): Float32Array {
        tempFloat32Array[0] = tempFloat32Array[1] = tempFloat32Array[2] = 0;
        this.ambientLights.forEach(light => {
            const realColor = light.getRealColor();
            tempFloat32Array[0] = (tempFloat32Array[0] ?? 0) + realColor.r;
            tempFloat32Array[1] = (tempFloat32Array[1] ?? 0) + realColor.g;
            tempFloat32Array[2] = (tempFloat32Array[2] ?? 0) + realColor.b;
        });
        tempFloat32Array[0] = Math.min(1, tempFloat32Array[0]);
        tempFloat32Array[1] = Math.min(1, tempFloat32Array[1]);
        tempFloat32Array[2] = Math.min(1, tempFloat32Array[2]);
        return tempFloat32Array;
    }
    /**
     * 更新所有光源信息
     * @param camera - 摄像机
     */
    updateInfo(camera: Camera): void {
        const { lightInfo, ambientLights, directionalLights, pointLights, spotLights, areaLights } =
            this;
        lightInfo.AMBIENT_LIGHTS = ambientLights.length;
        lightInfo.POINT_LIGHTS = pointLights.length;
        lightInfo.DIRECTIONAL_LIGHTS = directionalLights.length;
        lightInfo.SPOT_LIGHTS = spotLights.length;
        lightInfo.AREA_LIGHTS = areaLights.length;
        const shadowFilter = (light: Light): boolean => light.shadow !== null;
        lightInfo.SHADOW_POINT_LIGHTS = pointLights.filter(shadowFilter).length;
        lightInfo.SHADOW_SPOT_LIGHTS = spotLights.filter(shadowFilter).length;
        lightInfo.SHADOW_DIRECTIONAL_LIGHTS = directionalLights.filter(shadowFilter).length;
        lightInfo.uid = [
            lightInfo.AMBIENT_LIGHTS,
            lightInfo.POINT_LIGHTS,
            lightInfo.SHADOW_POINT_LIGHTS,
            lightInfo.DIRECTIONAL_LIGHTS,
            lightInfo.SHADOW_DIRECTIONAL_LIGHTS,
            lightInfo.SPOT_LIGHTS,
            lightInfo.SHADOW_SPOT_LIGHTS,
            lightInfo.AREA_LIGHTS
        ].join('_');
        this.directionalInfo = this.getDirectionalInfo(camera);
        this.pointInfo = this.getPointInfo(camera);
        this.spotInfo = this.getSpotInfo(camera);
        this.areaInfo = this.getAreaInfo(camera);
        this.ambientInfo = this.getAmbientInfo();
        if (this.updateCustomInfo) {
            this.updateCustomInfo(this, camera);
        }
    }
    /**
     * 更新自定义灯光信息
     */
    updateCustomInfo: ((manager: LightManager, camera: Camera) => void) | null = null;
    /**
     * 获取光源信息
     */
    getInfo(): LightInfo {
        return this.lightInfo;
    }
    /**
     * 重置所有光源
     */
    reset(): void {
        this.ambientLights.length = 0;
        this.directionalLights.length = 0;
        this.pointLights.length = 0;
        this.spotLights.length = 0;
        this.areaLights.length = 0;
    }
    /**
     * 获取阴影贴图数量
     * @param type -
     */
    getShadowMapCount(type: LightGroupName): number {
        if (!this.shadowEnabled) {
            return 0;
        }
        let lights: Light[] = [];
        if (type === 'POINT_LIGHTS') {
            lights = this.pointLights;
        } else if (type === 'DIRECTIONAL_LIGHTS') {
            lights = this.directionalLights;
        } else if (type === 'SPOT_LIGHTS') {
            lights = this.spotLights;
        } else if (type === 'AREA_LIGHTS') {
            lights = this.areaLights;
        }
        let count = 0;
        lights.forEach(light => {
            count += light.shadow ? 1 : 0;
        });
        return count;
    }
    /**
     * 更新光源信息
     * @param renderer -
     * @param lights -
     * @param camera -
     */
    update(renderer: WebGLRenderer, camera: Camera, lights: readonly Light[]): void {
        lights.forEach(light => {
            this.addLight(light);
        });
        this.createShadowMap(renderer, camera);
        this.updateInfo(camera);
    }
    /**
     * 生成阴影贴图
     * @param renderer -
     * @param camera -
     */
    createShadowMap(renderer: WebGLRenderer, camera: Camera): void {
        if (!this.shadowEnabled) {
            return;
        }
        this.directionalLights.forEach(light => {
            if (light.shadow) light.createShadowMap(renderer, camera);
        });
        this.spotLights.forEach(light => {
            if (light.shadow) light.createShadowMap(renderer, camera);
        });
        this.pointLights.forEach(light => {
            if (light.shadow) light.createShadowMap(renderer, camera);
        });
        this.areaLights.forEach(light => {
            if (light.shadow) light.createShadowMap(renderer, camera);
        });
    }
}
export default LightManager;
