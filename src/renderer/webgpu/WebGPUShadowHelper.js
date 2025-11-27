/* global GPUTextureUsage */
/**
 * WebGPU Shadow Mapping Helper
 * Manages shadow map creation, light space matrices, and shadow rendering
 * @class WebGPUShadowHelper
 */
class WebGPUShadowHelper {
    constructor(device, shadowMapSize = 2048) {
        this.device = device;
        this.shadowMapSize = shadowMapSize;
        this.shadowMap = null;
        this.shadowMapView = null;
        this.shadowSampler = null;
        this.lightDirection = { x: -0.5, y: -1, z: -0.5 };
        this.shadowBias = 0.005;
    }

    /**
     * Create shadow map texture
     * @returns {GPUTexture} Shadow map texture
     */
    createShadowMap() {
        if (this.shadowMap) {
            this.shadowMap.destroy();
        }

        this.shadowMap = this.device.createTexture({
            size: {
                width: this.shadowMapSize,
                height: this.shadowMapSize,
                depthOrArrayLayers: 1
            },
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });

        this.shadowMapView = this.shadowMap.createView();

        // Create comparison sampler for shadow sampling
        this.shadowSampler = this.device.createSampler({
            compare: 'less',
            magFilter: 'linear',
            minFilter: 'linear'
        });

        return this.shadowMap;
    }

    /**
     * Set light direction for shadow mapping
     * @param {Object} direction - Light direction vector {x, y, z}
     */
    setLightDirection(direction) {
        this.lightDirection = direction;
    }

    /**
     * Calculate light space matrix for shadow mapping
     * @param {Object} sceneBounds - Scene bounding box
     * @returns {Float32Array} Light space matrix (projection * view)
     */
    calculateLightSpaceMatrix(sceneBounds = { min: [-10, -10, -10], max: [10, 10, 10] }) {
        // Normalize light direction
        const len = Math.sqrt(
            this.lightDirection.x * this.lightDirection.x
            + this.lightDirection.y * this.lightDirection.y
            + this.lightDirection.z * this.lightDirection.z
        );
        const lightDir = {
            x: this.lightDirection.x / len,
            y: this.lightDirection.y / len,
            z: this.lightDirection.z / len
        };

        // Calculate light position (looking at scene center)
        const sceneCenter = [
            (sceneBounds.min[0] + sceneBounds.max[0]) / 2,
            (sceneBounds.min[1] + sceneBounds.max[1]) / 2,
            (sceneBounds.min[2] + sceneBounds.max[2]) / 2
        ];

        const distance = 20;
        const lightPos = [
            sceneCenter[0] - lightDir.x * distance,
            sceneCenter[1] - lightDir.y * distance,
            sceneCenter[2] - lightDir.z * distance
        ];

        // Create light view matrix (lookAt)
        const viewMatrix = WebGPUShadowHelper._createLookAtMatrix(lightPos, sceneCenter, [0, 1, 0]);

        // Create orthographic projection for directional light
        const size = 15;
        const projectionMatrix = WebGPUShadowHelper._createOrthographicMatrix(-size, size, -size, size, 0.1, 50);

        // Multiply projection * view
        const lightSpaceMatrix = WebGPUShadowHelper._multiplyMatrices(projectionMatrix, viewMatrix);

        return lightSpaceMatrix;
    }

    /**
     * Create lookAt view matrix
     * @static
     */
    static _createLookAtMatrix(eye, center, up) {
        const matrix = new Float32Array(16);

        // Calculate z axis (eye - center, normalized)
        let zx = eye[0] - center[0];
        let zy = eye[1] - center[1];
        let zz = eye[2] - center[2];
        let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
        zx /= len;
        zy /= len;
        zz /= len;

        // Calculate x axis (up cross z, normalized)
        let xx = up[1] * zz - up[2] * zy;
        let xy = up[2] * zx - up[0] * zz;
        let xz = up[0] * zy - up[1] * zx;
        len = Math.sqrt(xx * xx + xy * xy + xz * xz);
        xx /= len;
        xy /= len;
        xz /= len;

        // Calculate y axis (z cross x)
        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;

        // Build matrix (column-major)
        matrix[0] = xx;
        matrix[1] = yx;
        matrix[2] = zx;
        matrix[3] = 0;

        matrix[4] = xy;
        matrix[5] = yy;
        matrix[6] = zy;
        matrix[7] = 0;

        matrix[8] = xz;
        matrix[9] = yz;
        matrix[10] = zz;
        matrix[11] = 0;

        matrix[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
        matrix[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
        matrix[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
        matrix[15] = 1;

        return matrix;
    }

    /**
     * Create orthographic projection matrix
     * @static
     */
    static _createOrthographicMatrix(left, right, bottom, top, near, far) {
        const matrix = new Float32Array(16);

        matrix[0] = 2 / (right - left);
        matrix[1] = 0;
        matrix[2] = 0;
        matrix[3] = 0;

        matrix[4] = 0;
        matrix[5] = 2 / (top - bottom);
        matrix[6] = 0;
        matrix[7] = 0;

        matrix[8] = 0;
        matrix[9] = 0;
        matrix[10] = -2 / (far - near);
        matrix[11] = 0;

        matrix[12] = -(right + left) / (right - left);
        matrix[13] = -(top + bottom) / (top - bottom);
        matrix[14] = -(far + near) / (far - near);
        matrix[15] = 1;

        return matrix;
    }

    /**
     * Multiply two 4x4 matrices
     * @static
     */
    static _multiplyMatrices(a, b) {
        const result = new Float32Array(16);

        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                result[i * 4 + j] = a[i * 4 + 0] * b[0 * 4 + j]
                    + a[i * 4 + 1] * b[1 * 4 + j]
                    + a[i * 4 + 2] * b[2 * 4 + j]
                    + a[i * 4 + 3] * b[3 * 4 + j];
            }
        }

        return result;
    }

    /**
     * Get shadow map texture view
     */
    getShadowMapView() {
        return this.shadowMapView;
    }

    /**
     * Get shadow sampler
     */
    getShadowSampler() {
        return this.shadowSampler;
    }

    /**
     * Get shadow bias
     */
    getShadowBias() {
        return this.shadowBias;
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.shadowMap) {
            this.shadowMap.destroy();
            this.shadowMap = null;
        }
    }
}

export default WebGPUShadowHelper;
