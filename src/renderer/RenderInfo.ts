import Class from '../core/Class';

/**
 * 渲染信息
 * @class
 */
const RenderInfo = Class.create(/** @lends RenderInfo.prototype */ {
    /**
     * @default RenderInfo
     * @type {String}
     */
    className: 'RenderInfo',

    /**
     * @default true
     * @type {Boolean}
     */
    isRenderInfo: true,

    /**
     * @constructs
     */
    constructor() {
        this.reset();
    },
    /**
     * 增加面数
     * @param {Number} num
     */
    addFaceCount(num) {
        this._currentFaceCount += num;
    },
    /**
     * 增加绘图数
     * @param {Number} num
     */
    addDrawCount(num) {
        this._currentDrawCount += num;
    },
    /**
     * 重置信息
     */
    reset() {
        /**
         * 面数
         * @type {Number}
         * @readOnly
         */
        this.faceCount = Math.floor(this._currentFaceCount);

        /**
         * 绘图数
         * @type {Number}
         * @readOnly
         */
        this.drawCount = Math.floor(this._currentDrawCount);

        /**
         * 当前面数
         * @type {Number}
         * @private
         */
        this._currentFaceCount = 0;

        /**
         * 当前绘图数
         * @private
         * @type {Number}
         */
        this._currentDrawCount = 0;
    }
});

export default RenderInfo;
