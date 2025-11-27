import Matrix4 from '../../math/Matrix4';

/**
 * WebGPU Uniform Helper
 * 负责创建和管理uniform相关逻辑，包括MVP矩阵计算、uniform数据创建等
 * @class
 */
class WebGPUUniformHelper {
    /**
     * @param {GPUDevice} device
     */
    constructor(device) {
        this.device = device;
    }

    /**
     * 计算MVP矩阵uniform数据
     * @param {Mesh} mesh
     * @param {Camera} camera
     * @return {Float32Array} 包含MVP、Model、Normal矩阵的数据
     */
    // eslint-disable-next-line class-methods-use-this
    createMVPUniformData(mesh, camera) {
        // 更新矩阵
        mesh.updateMatrixWorld();
        camera.updateViewProjectionMatrix();

        // 计算MVP矩阵
        const mvpMatrix = new Matrix4();
        mvpMatrix.multiply(camera.viewProjectionMatrix, mesh.worldMatrix);

        // 计算法线矩阵（模型矩阵的逆转置）
        // TODO: 对于非均匀缩放，应该使用逆转置矩阵
        const normalMatrix = new Matrix4();
        normalMatrix.copy(mesh.worldMatrix);

        // 创建uniform数据：3个4x4矩阵 = 48个float
        const uniformData = new Float32Array(48);
        uniformData.set(mvpMatrix.elements, 0);
        uniformData.set(mesh.worldMatrix.elements, 16);
        uniformData.set(normalMatrix.elements, 32);

        return uniformData;
    }

    /**
     * 获取MVP uniform缓冲区大小
     * @return {Number} 字节数
     */
    // eslint-disable-next-line class-methods-use-this
    getMVPUniformSize() {
        return 192; // 3 * mat4x4 (64 bytes each)
    }

    /**
     * 获取材质uniform缓冲区大小
     * @return {Number} 字节数
     */
    // eslint-disable-next-line class-methods-use-this
    getMaterialUniformSize() {
        return 64; // vec4 * 4 = 64 bytes
    }
}

export default WebGPUUniformHelper;
