/* global GPUBufferUsage */

/**
 * WebGPU Buffer Helper
 * 负责创建和管理各种GPU缓冲区（顶点、法线、UV、索引、Uniform等）
 * @class
 */
class WebGPUBufferHelper {
    /**
     * @param {GPUDevice} device
     * @param {WebGPUResourceManager} resourceManager
     */
    constructor(device, resourceManager) {
        this.device = device;
        this.resourceManager = resourceManager;
    }

    /**
     * 创建或获取顶点缓冲区
     * @param {Geometry} geometry
     * @return {GPUBuffer}
     */
    getOrCreateVertexBuffer(geometry) {
        const key = `vb_${geometry.id}`;
        let buffer = this.resourceManager.getBuffer(key);
        
        if (!buffer && geometry.vertices && geometry.vertices.data) {
            buffer = this.device.createBuffer({
                size: geometry.vertices.data.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(buffer, 0, geometry.vertices.data);
            this.resourceManager.setBuffer(key, buffer);
        }
        
        return buffer;
    }

    /**
     * 创建或获取法线缓冲区
     * @param {Geometry} geometry
     * @return {GPUBuffer}
     */
    getOrCreateNormalBuffer(geometry) {
        const key = `nb_${geometry.id}`;
        let buffer = this.resourceManager.getBuffer(key);
        
        if (!buffer && geometry.normals && geometry.normals.data) {
            buffer = this.device.createBuffer({
                size: geometry.normals.data.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(buffer, 0, geometry.normals.data);
            this.resourceManager.setBuffer(key, buffer);
        }
        
        return buffer;
    }

    /**
     * 创建或获取UV缓冲区
     * @param {Geometry} geometry
     * @return {GPUBuffer|null}
     */
    getOrCreateUVBuffer(geometry) {
        if (!geometry.uvs || !geometry.uvs.data) {
            return null;
        }
        
        const key = `uv_${geometry.id}`;
        let buffer = this.resourceManager.getBuffer(key);
        
        if (!buffer) {
            buffer = this.device.createBuffer({
                size: geometry.uvs.data.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(buffer, 0, geometry.uvs.data);
            this.resourceManager.setBuffer(key, buffer);
        }
        
        return buffer;
    }

    /**
     * 创建或获取索引缓冲区
     * @param {Geometry} geometry
     * @return {{buffer: GPUBuffer|null, count: Number}}
     */
    getOrCreateIndexBuffer(geometry) {
        if (!geometry.indices || !geometry.indices.data) {
            return { buffer: null, count: 0 };
        }
        
        const key = `ib_${geometry.id}`;
        let buffer = this.resourceManager.getBuffer(key);
        const count = geometry.indices.data.length;
        
        if (!buffer) {
            buffer = this.device.createBuffer({
                size: geometry.indices.data.byteLength,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(buffer, 0, geometry.indices.data);
            this.resourceManager.setBuffer(key, buffer);
        }
        
        return { buffer, count };
    }

    /**
     * 创建Uniform缓冲区
     * @param {Number} size 缓冲区大小（字节）
     * @param {TypedArray} [data] 初始数据
     * @return {GPUBuffer}
     */
    createUniformBuffer(size, data) {
        const buffer = this.device.createBuffer({
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        if (data) {
            this.device.queue.writeBuffer(buffer, 0, data);
        }
        
        return buffer;
    }

    /**
     * 更新Uniform缓冲区数据
     * @param {GPUBuffer} buffer
     * @param {TypedArray} data
     * @param {Number} [offset=0]
     */
    updateUniformBuffer(buffer, data, offset = 0) {
        this.device.queue.writeBuffer(buffer, offset, data);
    }
}

export default WebGPUBufferHelper;
