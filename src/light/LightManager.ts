import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';
import log from '../utils/log';
import {
    each
} from '../utils/util';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();
const tempFloat32Array = new Float32Array([0, 0, 0]);

interface LightInfo {
    AMBIENT_LIGHTS: number;
    POINT_LIGHTS: number;
    DIRECTIONAL_LIGHTS: number;
    SPOT_LIGHTS: number;
    AREA_LIGHTS: number;
    SHADOW_POINT_LIGHTS?: number;
    SHADOW_SPOT_LIGHTS?: number;
    SHADOW_DIRECTIONAL_LIGHTS?: number;
    uid: string | number;
}

interface DirectionalInfo {
    colors: Float32Array;
    infos: Float32Array;
    shadowMap?: any[];
    shadowMapSize?: Float32Array;
    shadowBias?: Float32Array;
    lightSpaceMatrix?: Float32Array;
}

interface SpotInfo {
    colors: Float32Array;
    infos: Float32Array;
    poses: Float32Array;
    dirs: Float32Array;
    cutoffs: Float32Array;
    ranges: Float32Array;
    shadowMap?: any[];
    shadowMapSize?: Float32Array;
    shadowBias?: Float32Array;
    lightSpaceMatrix?: Float32Array;
}

interface PointInfo {
    colors: Float32Array;
    infos: Float32Array;
    poses: Float32Array;
    ranges: Float32Array;
    shadowMap?: any[];
    shadowBias?: Float32Array;
    lightSpaceMatrix?: Float32Array;
    cameras?: Float32Array;
}

interface AreaInfo {
    colors: Float32Array;
    poses: Float32Array;
    width: Float32Array;
    height: Float32Array;
    ltcTexture1: any;
    ltcTexture2: any;
}

/**
 * 光管理类
 * @class
 */
class LightManager {
    /**
     * @default true
     * @type {boolean}
     */
    readonly isLightManager: boolean = true;

    /**
     * @default LightManager
     * @type {string}
     */
    readonly className: string = 'LightManager';

    /**
     * 是否开启阴影
     * @type {boolean}
     * @default true
     */
    shadowEnabled: boolean = true;

    /**
     * @type {AmbientLight[]}
     */
    ambientLights: any[] = [];

    /**
     * @type {DirectionalLight[]}
     */
    directionalLights: any[] = [];

    /**
     * @type {PointLight[]}
     */
    pointLights: any[] = [];

    /**
     * @type {SpotLight[]}
     */
    spotLights: any[] = [];

    /**
     * @type {AreaLight[]}
     */
    areaLights: any[] = [];

    lightInfo: LightInfo;

    directionalInfo?: DirectionalInfo;

    pointInfo?: PointInfo;

    spotInfo?: SpotInfo;

    areaInfo?: AreaInfo;

    ambientInfo?: Float32Array;

    /**
     * 更新自定义灯光信息
     * @type updateCustomInfoCallback
     * @default null
     */
    updateCustomInfo: ((lightManager: LightManager, camera: any) => void) | null = null;

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params?: any) {
        this.lightInfo = {
            AMBIENT_LIGHTS: 0,
            POINT_LIGHTS: 0,
            DIRECTIONAL_LIGHTS: 0,
            SPOT_LIGHTS: 0,
            AREA_LIGHTS: 0,
            uid: 0
        };

        Object.assign(this, params);
    }

    getRenderOption(option: any = {}): any {
        each(this.lightInfo, (count: number, name: string) => {
            if (name === 'uid' || !count) {
                return;
            }
            option[name] = count;
            const shadowMapCount = this.getShadowMapCount(name);
            if (shadowMapCount) {
                option[name + '_SMC'] = shadowMapCount;
            }
        });
        return option;
    }

    /**
     * 增加光
     * @param {Light} light 光源
     * @return {LightManager} this
     */
    addLight(light: any): this {
        let lights: any[] | null = null;

        if (!light.enabled) {
            return this;
        }

        if (light.isAmbientLight) {
            lights = this.ambientLights;
        } else if (light.isDirectionalLight) {
            lights = this.directionalLights;
        } else if (light.isPointLight) {
            lights = this.pointLights;
        } else if (light.isSpotLight) {
            lights = this.spotLights;
        } else if (light.isAreaLight) {
            lights = this.areaLights;
        } else {
            log.warnOnce(`LightManager.addLight(${light.id})`, 'Not support this light:', light);
        }

        if (lights) {
            if (light.shadow) {
                lights.unshift(light);
            } else {
                lights.push(light);
            }
        }

        return this;
    }

    /**
     * 获取方向光信息
     * @param  {Camera} camera 摄像机
     * @return {Object}
     */
    getDirectionalInfo(camera: any): DirectionalInfo {
        const colors: number[] = [];
        const infos: number[] = [];
        const shadowMap: any[] = [];
        const shadowMapSize: number[] = [];
        const lightSpaceMatrix: number[] = [];
        const shadowBias: number[] = [];

        this.directionalLights.forEach((light, index) => {
            const offset = index * 3;
            light.getRealColor().toRGBArray(colors, offset);

            light.getViewDirection(camera).toArray(infos, offset);

            if (light.shadow && light.lightShadow) {
                shadowMap.push(light.lightShadow.framebuffer.texture);
                shadowMapSize.push(light.lightShadow.width);
                shadowMapSize.push(light.lightShadow.height);
                shadowBias.push(light.lightShadow.minBias, light.lightShadow.maxBias);

                tempMatrix4.copy(camera.worldMatrix);
                tempMatrix4.premultiply(light.lightShadow.camera.viewProjectionMatrix);
                tempMatrix4.toArray(lightSpaceMatrix, index * 16);
            }
        });

        const result: DirectionalInfo = {
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
     * @param {Camera} camera 摄像机
     * @return {Object}
     */
    getSpotInfo(camera: any): SpotInfo {
        const colors: number[] = [];
        const infos: number[] = [];
        const poses: number[] = [];
        const dirs: number[] = [];
        const cutoffs: number[] = [];
        const shadowMap: any[] = [];
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
            cutoffs.push(light._cutoffCos, light._outerCutoffCos);

            camera.getModelViewMatrix(light, tempMatrix4);
            tempMatrix4.getTranslation(tempVector3);
            tempVector3.toArray(poses, offset);

            if (light.shadow && light.lightShadow) {
                shadowMap.push(light.lightShadow.framebuffer.texture);
                shadowMapSize.push(light.lightShadow.width);
                shadowMapSize.push(light.lightShadow.height);
                shadowBias.push(light.lightShadow.minBias, light.lightShadow.maxBias);

                tempMatrix4.multiply(light.lightShadow.camera.viewProjectionMatrix, camera.worldMatrix);
                tempMatrix4.toArray(lightSpaceMatrix, index * 16);
            }
        });

        const result: SpotInfo = {
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
     * @param  {Camera} camera 摄像机
     * @return {Object}
     */
    getPointInfo(camera: any): PointInfo {
        const colors: number[] = [];
        const infos: number[] = [];
        const poses: number[] = [];
        const shadowMap: any[] = [];
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

            if (light.shadow && light.lightShadow) {
                shadowMap.push(light.lightShadow.framebuffer.texture);
                shadowBias.push(light.lightShadow.minBias, light.lightShadow.maxBias);
                camera.worldMatrix.toArray(lightSpaceMatrix, index * 16);
                cameras[index * 2] = light.lightShadow.camera.near;
                cameras[index * 2 + 1] = light.lightShadow.camera.far;
            }
        });

        const result: PointInfo = {
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
     * @param  {Camera} camera 摄像机
     * @return {Object}
     */
    getAreaInfo(camera: any): AreaInfo {
        const colors: number[] = [];
        const poses: number[] = [];
        const width: number[] = [];
        const height: number[] = [];

        let ltcTexture1: any;
        let ltcTexture2: any;

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

        const result: AreaInfo = {
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
     * @return {Object}
     */
    getAmbientInfo(): Float32Array {
        tempFloat32Array[0] = tempFloat32Array[1] = tempFloat32Array[2] = 0;
        this.ambientLights.forEach((light) => {
            const realColor = light.getRealColor();
            tempFloat32Array[0] += realColor.r;
            tempFloat32Array[1] += realColor.g;
            tempFloat32Array[2] += realColor.b;
        });

        tempFloat32Array[0] = Math.min(1, tempFloat32Array[0]);
        tempFloat32Array[1] = Math.min(1, tempFloat32Array[1]);
        tempFloat32Array[2] = Math.min(1, tempFloat32Array[2]);
        return tempFloat32Array;
    }

    /**
     * 更新所有光源信息
     * @param  {Camera} camera 摄像机
     */
    updateInfo(camera: any): void {
        const {
            lightInfo,
            ambientLights,
            directionalLights,
            pointLights,
            spotLights,
            areaLights
        } = this;

        lightInfo.AMBIENT_LIGHTS = ambientLights.length;
        lightInfo.POINT_LIGHTS = pointLights.length;
        lightInfo.DIRECTIONAL_LIGHTS = directionalLights.length;
        lightInfo.SPOT_LIGHTS = spotLights.length;
        lightInfo.AREA_LIGHTS = areaLights.length;

        const shadowFilter = (light: any) => !!light.shadow;
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
     * 获取光源信息
     * @return {Object}
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
     * @param {string} type
     * @returns {number}
     */
    getShadowMapCount(type: string): number {
        if (!this.shadowEnabled) {
            return 0;
        }

        let lights: any[] = [];
        if (type === 'POINT_LIGHTS') {
            lights = this.pointLights;
        } else if (type === 'DIRECTIONAL_LIGHTS') {
            lights = this.directionalLights;
        } else if (type === 'SPOT_LIGHTS') {
            lights = this.spotLights;
        } else if (type === 'AREA_LIGHTS') {
            lights = this.spotLights;
        }

        let count = 0;
        lights.forEach((light) => {
            count += light.shadow ? 1 : 0;
        });
        return count;
    }

    /**
     * 更新光源信息
     * @param {WebGLRenderer} renderer
     * @param {Light[]} lights
     * @param {Camera} camera
     */
    update(renderer: any, camera: any, lights: any[]): void {
        lights.forEach((light) => {
            this.addLight(light);
        });

        this.createShadowMap(renderer, camera);
        this.updateInfo(camera);
    }

    /**
     * 生成阴影贴图
     * @param {WebGLRenderer} renderer
     * @param {Camera} camera
     */
    createShadowMap(renderer: any, camera: any): void {
        if (!this.shadowEnabled) {
            return;
        }

        this.directionalLights.forEach((light) => {
            light.createShadowMap(renderer, camera);
        });
        this.spotLights.forEach((light) => {
            light.createShadowMap(renderer, camera);
        });
        this.pointLights.forEach((light) => {
            light.createShadowMap(renderer, camera);
        });
        this.areaLights.forEach((light) => {
            light.createShadowMap(renderer, camera);
        });
    }
}

export default LightManager;

/**
 * 更新自定义灯光回调
 * @callback updateCustomInfoCallback
 * @param { LightManager } lightManager
 * @param { Camera } camera
 */


/**
 * 灯光信息接口
 * @interface ILightInfo
 * @property {string} uid
 */

/**
 * 灯光管理器接口
 * @interface ILightManager
 * @property {boolean} shadowEnabled
 * @property {ILightInfo} lightInfo
 */

/**
 * 重置所有光源信息
 * @function
 * @name ILightManager#reset
 */

/**
 * 更新光源信息
 * @function
 * @param {WebGLRenderer} renderer
 * @param {Camera} camera
 * @param {Light[]} lights
 * @name ILightManager#update
 */

/**
 * 获取渲染配置
 * @function
 * @param {object} [option]
 * @name ILightManager#getRenderOption
 */
