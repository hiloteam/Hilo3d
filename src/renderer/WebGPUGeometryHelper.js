/* global GPUBufferUsage */

/**
 * WebGPU Geometry Helper
 * Handles geometry data extraction and buffer creation for WebGPU rendering
 * @class
 */
const WebGPUGeometryHelper = {
    /**
     * Validate if geometry has all required data for rendering
     * @param {Geometry} geometry - The geometry to validate
     * @returns {boolean} True if geometry has vertices, normals, and indices
     */
    validateGeometry(geometry) {
        if (!geometry || !geometry.vertices || !geometry.normals || !geometry.indices) {
            return false;
        }

        if (!geometry.vertices.data || geometry.vertices.data.length === 0) {
            return false;
        }

        if (!geometry.normals.data || geometry.normals.data.length === 0) {
            return false;
        }

        if (!geometry.indices.data || geometry.indices.data.length === 0) {
            return false;
        }

        return true;
    },

    /**
     * Check if geometry has UV coordinates
     * @param {Geometry} geometry - The geometry to check
     * @returns {boolean} True if geometry has UV data
     */
    hasUVs(geometry) {
        return geometry && geometry.uvs && geometry.uvs.data && geometry.uvs.data.length > 0;
    },

    /**
     * Create vertex buffer for geometry
     * @param {GPUDevice} device - WebGPU device
     * @param {Geometry} geometry - Geometry containing vertex data
     * @returns {GPUBuffer} Vertex buffer
     */
    createVertexBuffer(device, geometry) {
        const vertexData = new Float32Array(geometry.vertices.data);
        const buffer = device.createBuffer({
            size: vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Float32Array(buffer.getMappedRange()).set(vertexData);
        buffer.unmap();
        return buffer;
    },

    /**
     * Create normal buffer for geometry
     * @param {GPUDevice} device - WebGPU device
     * @param {Geometry} geometry - Geometry containing normal data
     * @returns {GPUBuffer} Normal buffer
     */
    createNormalBuffer(device, geometry) {
        const normalData = new Float32Array(geometry.normals.data);
        const buffer = device.createBuffer({
            size: normalData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Float32Array(buffer.getMappedRange()).set(normalData);
        buffer.unmap();
        return buffer;
    },

    /**
     * Create UV buffer for geometry
     * @param {GPUDevice} device - WebGPU device
     * @param {Geometry} geometry - Geometry containing UV data
     * @returns {GPUBuffer|null} UV buffer or null if no UVs
     */
    createUVBuffer(device, geometry) {
        if (!this.hasUVs(geometry)) {
            return null;
        }

        const uvData = new Float32Array(geometry.uvs.data);
        const buffer = device.createBuffer({
            size: uvData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Float32Array(buffer.getMappedRange()).set(uvData);
        buffer.unmap();
        return buffer;
    },

    /**
     * Create index buffer for geometry
     * @param {GPUDevice} device - WebGPU device
     * @param {Geometry} geometry - Geometry containing index data
     * @returns {GPUBuffer} Index buffer
     */
    createIndexBuffer(device, geometry) {
        const indexData = new Uint16Array(geometry.indices.data);
        const buffer = device.createBuffer({
            size: indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Uint16Array(buffer.getMappedRange()).set(indexData);
        buffer.unmap();
        return buffer;
    },

    /**
     * Get index count from geometry
     * @param {Geometry} geometry - Geometry to get index count from
     * @returns {number} Number of indices
     */
    getIndexCount(geometry) {
        return geometry.indices.data.length;
    },

    /**
     * Create all geometry buffers
     * @param {GPUDevice} device - WebGPU device
     * @param {Geometry} geometry - Geometry to create buffers for
     * @returns {Object} Object containing all buffers
     */
    createGeometryBuffers(device, geometry) {
        return {
            vertexBuffer: this.createVertexBuffer(device, geometry),
            normalBuffer: this.createNormalBuffer(device, geometry),
            uvBuffer: this.createUVBuffer(device, geometry),
            indexBuffer: this.createIndexBuffer(device, geometry),
            indexCount: this.getIndexCount(geometry)
        };
    }
};

export default WebGPUGeometryHelper;
