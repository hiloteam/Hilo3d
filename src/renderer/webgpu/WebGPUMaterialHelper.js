import Color from '../../math/Color';

/**
 * WebGPU Material Helper
 * 负责处理材质相关的逻辑，包括材质属性提取、材质uniform创建等
 * @class
 */
class WebGPUMaterialHelper {
    /**
     * @param {GPUDevice} device
     */
    constructor(device) {
        this.device = device;
    }

    /**
     * 检查材质是否有纹理
     * @param {Material} material
     * @return {Boolean}
     */
    hasTexture(material) {
        const diffuse = material.diffuse;
        return diffuse && diffuse.isTexture;
    }

    /**
     * 检查纹理是否已加载完成
     * @param {Material} material
     * @return {Boolean}
     */
    isTextureReady(material) {
        const diffuse = material.diffuse;
        if (!diffuse || !diffuse.isTexture) {
            return false;
        }
        
        // LazyTexture在加载完成前会使用占位图（data URL）
        const imageComplete = diffuse.image && diffuse.image.complete;
        const notPlaceholder = !diffuse.isLazyTexture || 
            (diffuse.image.src && !diffuse.image.src.startsWith('data:'));
        
        return imageComplete && notPlaceholder;
    }

    /**
     * 提取材质的diffuse颜色
     * @param {Material} material
     * @param {Boolean} useTexture 是否使用纹理
     * @return {Color}
     */
    getDiffuseColor(material, useTexture) {
        if (useTexture) {
            // 使用纹理时返回白色，让纹理颜色通过
            return new Color(1, 1, 1);
        }
        
        const diffuse = material.diffuse;
        if (diffuse && diffuse.r !== undefined) {
            return diffuse;
        }
        
        return new Color(0.5, 0.5, 0.5);
    }

    /**
     * 创建材质uniform数据
     * @param {Material} material
     * @param {Boolean} useTexture
     * @return {Float32Array}
     */
    createMaterialUniformData(material, useTexture) {
        const diffuseColor = this.getDiffuseColor(material, useTexture);
        const specular = material.specular || new Color(1, 1, 1);
        const emission = material.emission || new Color(0, 0, 0);
        const shininess = material.shininess || 32;
        const opacity = material.transparency !== undefined ? material.transparency : 1;

        const materialData = new Float32Array(16);
        
        // diffuseColor (vec4)
        materialData[0] = diffuseColor.r || diffuseColor._r || 0.5;
        materialData[1] = diffuseColor.g || diffuseColor._g || 0.5;
        materialData[2] = diffuseColor.b || diffuseColor._b || 0.5;
        materialData[3] = diffuseColor.a || diffuseColor._a || 1;
        
        // specularColor (vec4)
        materialData[4] = specular.r || specular._r || 1;
        materialData[5] = specular.g || specular._g || 1;
        materialData[6] = specular.b || specular._b || 1;
        materialData[7] = 1;
        
        // emissionColor (vec4)
        materialData[8] = emission.r || emission._r || 0;
        materialData[9] = emission.g || emission._g || 0;
        materialData[10] = emission.b || emission._b || 0;
        materialData[11] = 1;
        
        // shininess, opacity, padding
        materialData[12] = shininess;
        materialData[13] = opacity;
        materialData[14] = 0;
        materialData[15] = 0;

        return materialData;
    }

    /**
     * 获取材质的blend模式配置
     * @param {Material} material
     * @return {Object|undefined}
     */
    getBlendMode(material) {
        if (!material.transparent) {
            return undefined;
        }
        
        return {
            color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
            },
            alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
            },
        };
    }

    /**
     * 获取材质的cull mode
     * @param {Material} material
     * @return {String}
     */
    getCullMode(material) {
        // FRONT_AND_BACK = 1032, BACK = 1029, FRONT = 1028
        if (material.side === 1032) return 'none'; // FRONT_AND_BACK
        if (material.side === 1029) return 'front'; // BACK - cull front faces
        return 'back'; // FRONT (1028) or default - cull back faces
    }
}

export default WebGPUMaterialHelper;
