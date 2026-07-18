/**
 * 渲染信息
 */
class RenderInfo {
    readonly className = 'RenderInfo';
    readonly isRenderInfo = true;
    private _currentFaceCount = 0;
    private _currentDrawCount = 0;
    faceCount = 0;
    drawCount = 0;
    constructor() {
        this.reset();
    }
    /**
     * 增加面数
     * @param num -
     */
    addFaceCount(num: number): void {
        this._currentFaceCount += num;
    }
    /**
     * 增加绘图数
     * @param num -
     */
    addDrawCount(num: number): void {
        this._currentDrawCount += num;
    }
    /**
     * 重置信息
     */
    reset(): void {
        /**
         * 面数
         */
        this.faceCount = Math.floor(this._currentFaceCount);
        /**
         * 绘图数
         */
        this.drawCount = Math.floor(this._currentDrawCount);
        /**
         * 当前面数
         */
        this._currentFaceCount = 0;
        /**
         * 当前绘图数
         */
        this._currentDrawCount = 0;
    }
}
export default RenderInfo;
