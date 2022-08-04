import Class from '../core/Class';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';
import log from '../utils/log';
import {
    each
} from '../utils/util';

const tempMatrix4 = new Matrix4();
const tempVector3 = new Vector3();
const tempFloat32Array = new Float32Array([0, 0, 0]);

/**
 * 光管理类
 * @class
 */
const LightManager = Class.create(/** @lends LightManager.prototype */{
    /**
     * @default true
     * @type {boolean}
     */
    isLightManager: true,
    /**
     * @default LightManager
     * @type {string}
     */
    className: 'LightManager',
    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        /**
         * @type {AmbientLight[]}
         */
        this.ambientLights = [];

        /**
         * @type {DirectionalLight[]}
         */
        this.directionalLights = [];

        /**
         * @type {PointLight[]}
         */
        this.pointLights = [];

        /**
         * @type {SpotLight[]}
         */
        this.spotLights = [];

        /**
         * @type {AreaLight[]}
         */
        this.areaLights = [];

        this.lightInfo = {
            AMBIENT_LIGHTS: 0,
            POINT_LIGHTS: 0,
            DIRECTIONAL_LIGHTS: 0,
            SPOT_LIGHTS: 0,
            AREA_LIGHTS: 0,
            uid: 0
        };

        Object.assign(this, params);
    },
    getRenderOption(option = {}) {
        each(this.lightInfo, (count, name) => {
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
    },
    /**
     * 增加光
     * @param {Light} light 光源
     * @return {LightManager} this
     */
    addLight(light) {
        let lights = null;

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
    },
    /**
     * 获取方向光信息
     * @param  {Camera} camera 摄像机
     * @return {Object}
     */
    getDirectionalInfo(camera) {
        const colors = [];
        const infos = [];
        const shadowMap = [];
        const shadowMapSize = [];
        const lightSpaceMatrix = [];
        const shadowBias = [];

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

        const result = {
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
    },
    /**
     * 获取聚光灯信息
     * @param {Camera} camera 摄像机
     * @return {Object}
     */
    getSpotInfo(camera) {
        const colors = [];
        const infos = [];
        const poses = [];
        const dirs = [];
        const cutoffs = [];
        const shadowMap = [];
        const shadowMapSize = [];
        const lightSpaceMatrix = [];
        const shadowBias = [];
        const ranges = [];
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

        const result = {
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
    },
    /**
     * 获取点光源信息
     * @param  {Camera} camera 摄像机
     * @return {Object}
     */
    getPointInfo(camera) {
        const colors = [];
        const infos = [];
        const poses = [];
        const shadowMap = [];
        const lightSpaceMatrix = [];
        const shadowBias = [];
        const cameras = [];
        const ranges = [];
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

        const result = {
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
    },
    /**
     * 获取面光源信息
     * @param  {Camera} camera 摄像机
     * @return {Object}
     */
    getAreaInfo(camera) {
        const colors = [];
        const poses = [];
        const width = [];
        const height = [];

        let ltcTexture1;
        let ltcTexture2;

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

        const result = {
            colors: new Float32Array(colors),
            poses: new Float32Array(poses),
            width: new Float32Array(width),
            height: new Float32Array(height),
            ltcTexture1,
            ltcTexture2
        };

        return result;
    },
    /**
     * 获取环境光信息
     * @return {Object}
     */
    getAmbientInfo() {
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
    },
    /**
     * 更新所有光源信息
     * @param  {Camera} camera 摄像机
     */
    updateInfo(camera) {
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

        const shadowFilter = light => !!light.shadow;
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
    },
    /**
     * 更新自定义灯光信息
     * @type updateCustomInfoCallback
     * @default null
     */
    updateCustomInfo: null,
    /**
     * 获取光源信息
     * @return {Object}
     */
    getInfo() {
        return this.lightInfo;
    },
    /**
     * 重置所有光源
     */
    reset() {
        this.ambientLights.length = 0;
        this.directionalLights.length = 0;
        this.pointLights.length = 0;
        this.spotLights.length = 0;
        this.areaLights.length = 0;
    },
    getShadowMapCount(type) {
        let lights = [];
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
    },
    createShadowMap(renderer, camera) {
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
});

export default LightManager;

/**
 * 更新自定义灯光回调
 * @callback updateCustomInfoCallback
 * @param { LightManager } lightManager
 * @param { Camera } camera
 */
