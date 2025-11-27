import Class from '../../core/Class';

/**
 * WebGPU 状态管理
 * WebGPU uses a different state management model compared to WebGL
 * Most state is encapsulated in pipeline objects rather than global state
 * @class
 */
const WebGPUState = Class.create(/** @lends WebGPUState.prototype */ {
    /**
     * @default WebGPUState
     * @type {String}
     */
    className: 'WebGPUState',

    /**
     * @default true
     * @type {Boolean}
     */
    isWebGPUState: true,

    /**
     * @constructs
     * @param  {GPUDevice} device
     */
    constructor(device) {
        /**
         * GPU设备
         * @type {GPUDevice}
         */
        this.device = device;
        this.reset();
    },

    /**
     * 重置状态
     */
    reset() {
        this.currentPipeline = null;
        this.currentBindGroup = null;
        this.currentVertexBuffer = null;
        this.currentIndexBuffer = null;
        this.viewportState = {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            minDepth: 0,
            maxDepth: 1
        };
        this.scissorState = {
            x: 0,
            y: 0,
            width: 0,
            height: 0
        };
    },

    /**
     * 设置viewport
     * @param {Number} x
     * @param {Number} y
     * @param {Number} width
     * @param {Number} height
     * @param {Number} minDepth
     * @param {Number} maxDepth
     */
    viewport(x, y, width, height, minDepth = 0, maxDepth = 1) {
        this.viewportState.x = x;
        this.viewportState.y = y;
        this.viewportState.width = width;
        this.viewportState.height = height;
        this.viewportState.minDepth = minDepth;
        this.viewportState.maxDepth = maxDepth;
    },

    /**
     * 设置scissor
     * @param {Number} x
     * @param {Number} y
     * @param {Number} width
     * @param {Number} height
     */
    scissor(x, y, width, height) {
        this.scissorState.x = x;
        this.scissorState.y = y;
        this.scissorState.width = width;
        this.scissorState.height = height;
    },

    /**
     * 设置当前管线
     * @param {GPURenderPipeline} pipeline
     */
    setPipeline(pipeline) {
        this.currentPipeline = pipeline;
    },

    /**
     * 设置当前绑定组
     * @param {GPUBindGroup} bindGroup
     */
    setBindGroup(bindGroup) {
        this.currentBindGroup = bindGroup;
    }
});

export default WebGPUState;
