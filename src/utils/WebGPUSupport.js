/**
 * WebGPU支持检测
 * @namespace WebGPUSupport
 * @type {Object}
 */
const WebGPUSupport = {
    /**
     * 是否支持 WebGPU
     * @return {Promise<Boolean>}
     */
    async get() {
        if (this._isWebGPUSupport === undefined) {
            try {
                if (!navigator.gpu) {
                    this._isWebGPUSupport = false;
                    return false;
                }

                const adapter = await navigator.gpu.requestAdapter();
                if (!adapter) {
                    this._isWebGPUSupport = false;
                    return false;
                }

                this._isWebGPUSupport = true;
            } catch (e) {
                this._isWebGPUSupport = false;
            }
        }
        return this._isWebGPUSupport;
    },

    /**
     * 同步检测是否支持 WebGPU (仅检测 API 是否存在)
     * @return {Boolean}
     */
    isAvailable() {
        return typeof navigator !== 'undefined' && 'gpu' in navigator;
    }
};

export default WebGPUSupport;
