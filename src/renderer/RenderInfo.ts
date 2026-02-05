/**
 * 渲染信息
 * @class
 */
class RenderInfo {
    /**
     * @default RenderInfo
     * @type {String}
     */
    className: string = 'RenderInfo';

    /**
     * @default true
     * @type {Boolean}
     */
    isRenderInfo: boolean = true;

    /**
     * 面数
     * @type {Number}
     * @readOnly
     */
    faceCount: number = 0;

    /**
     * 绘图数
     * @type {Number}
     * @readOnly
     */
    drawCount: number = 0;

    /**
     * 当前面数
     * @type {Number}
     * @private
     */
    private _currentFaceCount: number = 0;

    /**
     * 当前绘图数
     * @private
     * @type {Number}
     */
    private _currentDrawCount: number = 0;

    /**
     * @constructs
     */
    constructor() {
        this.reset();
    }

    /**
     * 增加面数
     * @param num 面数
     */
    addFaceCount(num: number): void {
        this._currentFaceCount += num;
    }

    /**
     * 增加绘图数
     * @param num 绘图数
     */
    addDrawCount(num: number): void {
        this._currentDrawCount += num;
    }

    /**
     * 重置信息
     */
    reset(): void {
        this.faceCount = Math.floor(this._currentFaceCount);
        this.drawCount = Math.floor(this._currentDrawCount);
        this._currentFaceCount = 0;
        this._currentDrawCount = 0;
    }
}

export default RenderInfo;
