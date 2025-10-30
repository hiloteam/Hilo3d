/* global GPUTextureUsage */

/**
 * WebGPU Texture Helper
 * Handles texture loading, validation, and GPU texture creation
 * @class
 */
const WebGPUTextureHelper = {
    /**
     * Check if material uses texture
     * @param {Material} material - Material to check
     * @returns {boolean} True if material has a texture
     */
    hasTexture(material) {
        const diffuse = material.diffuse;
        return diffuse && diffuse.isTexture;
    },

    /**
     * Check if texture is ready for use
     * Handles LazyTexture which uses placeholder data URLs
     * @param {Texture} texture - Texture to check
     * @returns {boolean} True if texture image is loaded and ready
     */
    isTextureReady(texture) {
        if (!texture || !texture.image) {
            return false;
        }

        const image = texture.image;

        // Check if image is loaded
        if (!image.complete) {
            return false;
        }

        // For LazyTexture, check that it's not the placeholder data URL
        if (image.src && image.src.startsWith('data:')) {
            return false;
        }

        return true;
    },

    /**
     * Create GPU texture from image
     * @param {GPUDevice} device - WebGPU device
     * @param {HTMLImageElement} image - Source image
     * @returns {GPUTexture} Created GPU texture
     */
    createGPUTexture(device, image) {
        const texture = device.createTexture({
            size: [image.width, image.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING
                   | GPUTextureUsage.COPY_DST
                   | GPUTextureUsage.RENDER_ATTACHMENT
        });

        device.queue.copyExternalImageToTexture(
            { source: image },
            { texture },
            [image.width, image.height]
        );

        return texture;
    },

    /**
     * Create texture sampler
     * @param {GPUDevice} device - WebGPU device
     * @param {Object} options - Sampler options
     * @returns {GPUSampler} Created sampler
     */
    createSampler(device, options = {}) {
        return device.createSampler({
            magFilter: options.magFilter || 'linear',
            minFilter: options.minFilter || 'linear',
            addressModeU: options.addressModeU || 'repeat',
            addressModeV: options.addressModeV || 'repeat'
        });
    },

    /**
     * Get texture from material if ready
     * @param {Material} material - Material to get texture from
     * @returns {Texture|null} Texture if ready, null otherwise
     */
    getReadyTexture(material) {
        if (!this.hasTexture(material)) {
            return null;
        }

        const texture = material.diffuse;
        if (!this.isTextureReady(texture)) {
            return null;
        }

        return texture;
    },

    /**
     * Create texture and sampler for material
     * @param {GPUDevice} device - WebGPU device
     * @param {Material} material - Material with texture
     * @returns {Object|null} Object with texture and sampler, or null if not ready
     */
    createTextureResources(device, material) {
        const texture = this.getReadyTexture(material);
        if (!texture) {
            return null;
        }

        const gpuTexture = this.createGPUTexture(device, texture.image);
        const sampler = this.createSampler(device);

        return {
            texture: gpuTexture,
            sampler,
            view: gpuTexture.createView()
        };
    }
};

export default WebGPUTextureHelper;
