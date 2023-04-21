import Class from '../core/Class';

/**
 * @class
 */
const RenderPass = Class.create(/** @lends RenderPass.prototype */ {
    /**
   * @default RenderPass
   * @type {string}
   */
    className: 'RenderPass',

    /**
   * @default true
   * @type {boolean}
   */
    isRenderPass: true,

    /**
   * @type {number}
   * @default 0
   */
    priority: 0,

    /**
   * @type {string}
   * @default null
   */
    id: null,

    /**
   * @constructs
   * @param {Object} [params] 初始化参数，所有params都会复制到实例上
   */
    constructor(params) {
        Object.assign(this, params);
    },

    /**
   * @param {WebGLRenderer} renderer
   * @param {Camera} camera
   * @param {Node} scene
   */
    render(renderer, camera, scene) {
        console.log(renderer, camera, scene);
    }
});

export default RenderPass;
