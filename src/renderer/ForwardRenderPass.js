import Class from '../core/Class';
import RenderPass from './RenderPass';

/**
 * @class
 */
const ForwardRenderPass = Class.create(/** @lends ForwardRenderPass.prototype */ {
    Extends: RenderPass,
    /**
   * @default RenderPass
   * @type {string}
   */
    className: 'ForwardRenderPass',

    /**
   * @default true
   * @type {boolean}
   */
    isForwardRenderPass: true,

    /**
   * @type {string}
   * @readonly
   */
    id: 'ForwardRenderPass',

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

export default ForwardRenderPass;
