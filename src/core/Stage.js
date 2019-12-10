import Class from './Class';
import Node from './Node';
import version from './version';
import WebGLRenderer from '../renderer/WebGLRenderer';
import Ray from '../math/Ray';
import Vector3 from '../math/Vector3';
import browser from '../utils/browser';
import log from '../utils/log';
import {
    getElementRect
} from '../utils/util';

/**
 * 舞台类
 * @class
 * @extends Node
 * @example
 * const stage = new Hilo3d.Stage({
 *     container:document.body,
 *     width:innerWidth,
 *     height:innerHeight
 * });
 */
const Stage = Class.create(/** @lends Stage.prototype */ {
    Extends: Node,

    isStage: true,
    className: 'Stage',

    /**
     * 渲染器
     * @type {WebGLRenderer}
     */
    renderer: null,

    /**
     * 摄像机
     * @type {Camera}
     */
    camera: null,

    /**
     * 像素密度
     * @type {Number}
     * @default 根据设备自动判断
     */
    pixelRatio: null,

    /**
     * 偏移值
     * @type {Number}
     * @default 0
     */
    offsetX: 0,

    /**
     * 偏移值
     * @type {Number}
     * @default 0
     */
    offsetY: 0,

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性，所有属性会透传给 Renderer。
     * @param {HTMLElement} container stage的容器
     * @param {Number} [params.pixelRatio=根据设备自动判断] 像素密度。
     * @param {Color} [params.clearColor=new Color(1, 1, 1, 1)] 背景色。
     * @param {Boolean} [params.useFramebuffer=false] 是否使用Framebuffer，有后处理需求时需要。
     * @param {Object} [params.framebufferOption={}] framebufferOption Framebuffer的配置，useFramebuffer为true时生效。
     * @param {Boolean} [params.useLogDepth=false] 是否使用对数深度，处理深度冲突。
     * @param {Boolean} [params.alpha=false] 是否背景透明。
     * @param {Boolean} [params.depth=true] 是否需要深度缓冲区。
     * @param {Boolean} [params.stencil=false] 是否需要模版缓冲区。
     * @param {Boolean} [params.antialias=true] 是否抗锯齿。
     * @param {Boolean} [params.premultipliedAlpha=true] 是否需要 premultipliedAlpha。
     * @param {Boolean} [params.preserveDrawingBuffer=false] 是否需要 preserveDrawingBuffer。
     * @param {Boolean} [params.failIfMajorPerformanceCaveat=false] 是否需要 failIfMajorPerformanceCaveat。
     * @param {Boolean} [params.gameMode=false] 是否开启游戏模式，UC 浏览器专用
     */
    constructor(params) {
        if (!params.width) {
            params.width = window.innerWidth;
        }

        if (!params.height) {
            params.height = window.innerHeight;
        }

        if (!params.pixelRatio) {
            let pixelRatio = window.devicePixelRatio || 1;
            pixelRatio = Math.min(pixelRatio, 1024 / Math.max(params.width, params.height), 2);
            pixelRatio = Math.max(pixelRatio, 1);
            params.pixelRatio = pixelRatio;
        }

        Stage.superclass.constructor.call(this, params);
        this.initRenderer(params);

        log.log(`Hilo3d version: ${version}`);
    },
    /**
     * 初始化渲染器
     * @private
     * @param  {Object} params
     */
    initRenderer(params) {
        const canvas = this.canvas = this.createCanvas(params);
        this.renderer = new WebGLRenderer(Object.assign(params, {
            domElement: canvas
        }));
        this.resize(this.width, this.height, this.pixelRatio, true);
    },
    /**
     * 生成canvas
     * @private
     * @param  {Object} params
     * @return {Canvas}
     */
    createCanvas(params) {
        let canvas;
        if (params.canvas) {
            canvas = params.canvas;
        } else {
            canvas = document.createElement('canvas');
        }

        if (params.container) {
            params.container.appendChild(canvas);
        }

        return canvas;
    },
    /**
     * 缩放舞台
     * @param  {Number} width 舞台宽
     * @param  {Number} height 舞台高
     * @param  {Number} [pixelRatio=this.pixelRatio] 像素密度
     * @param  {Boolean} [force=false] 是否强制刷新
     * @return {Stage} 舞台本身。链式调用支持。
     */
    resize(width, height, pixelRatio, force) {
        if (pixelRatio === undefined) {
            pixelRatio = this.pixelRatio;
        }

        if (force || this.width !== width || this.height !== height || this.pixelRatio !== pixelRatio) {
            this.width = width;
            this.height = height;
            this.pixelRatio = pixelRatio;
            this.rendererWidth = width * pixelRatio;
            this.rendererHeight = height * pixelRatio;

            const canvas = this.canvas;
            const renderer = this.renderer;

            renderer.resize(this.rendererWidth, this.rendererHeight, force);
            canvas.style.width = this.width + 'px';
            canvas.style.height = this.height + 'px';
            this.updateDomViewport();
        }
        return this;
    },
    /**
     * 设置舞台偏移值
     * @param {Number} x x
     * @param {Number} y y
     * @return {Stage} 舞台本身。链式调用支持。
     */
    setOffset(x, y) {
        if (this.offsetX !== x || this.offsetY !== y) {
            this.offsetX = x;
            this.offsetY = y;

            const pixelRatio = this.pixelRatio;
            this.renderer.setOffset(x * pixelRatio, y * pixelRatio);
        }
        return this;
    },
    /**
     * 改viewport
     * @param  {Number} x      x
     * @param  {Number} y      y
     * @param  {Number} width  width
     * @param  {Number} height height
     * @return {Stage} 舞台本身。链式调用支持。
     */
    viewport(x, y, width, height) {
        this.resize(width, height, this.pixelRatio, true);
        this.setOffset(x, y);
        return this;
    },
    /**
     * 渲染一帧
     * @param  {Number} dt 间隔时间
     * @return {Stage} 舞台本身。链式调用支持。
     */
    tick(dt) {
        this.traverseUpdate(dt);
        if (this.camera) {
            this.renderer.render(this, this.camera, true);
        }
        return this;
    },
    /**
     * @language=zh
     * 开启/关闭舞台的DOM事件响应。要让舞台上的可视对象响应用户交互，必须先使用此方法开启舞台的相应事件的响应。
     * @param {String|Array} type 要开启/关闭的事件名称或数组。
     * @param {Boolean} enabled 指定开启还是关闭。如果不传此参数，则默认为开启。
     * @return {Stage} 舞台本身。链式调用支持。
     */
    enableDOMEvent(types, enabled = true) {
        const canvas = this.canvas;
        const handler = this._domListener || (this._domListener = (e) => {
            this._onDOMEvent(e);
        });
        types = typeof types === 'string' ? [types] : types;

        types.forEach((type) => {
            if (enabled) {
                canvas.addEventListener(type, handler, false);
            } else {
                canvas.removeEventListener(type, handler);
            }
        });
        return this;
    },
    /**
     * @language=zh
     * DOM事件处理函数。此方法会把事件调度到事件的坐标点所对应的可视对象。
     * @private
     */
    _onDOMEvent(event) {
        const canvas = this.canvas;
        const target = this._eventTarget;

        const type = event.type;
        const isTouch = type.indexOf('touch') === 0;

        // calculate stageX/stageY
        let posObj = event;
        if (isTouch) {
            const touches = event.touches;
            const changedTouches = event.changedTouches;
            if (touches && touches.length) {
                posObj = touches[0];
            } else if (changedTouches && changedTouches.length) {
                posObj = changedTouches[0];
            }
        }

        const domViewport = this.domViewport || this.updateDomViewport();
        const x = (posObj.pageX || posObj.clientX) - domViewport.left;
        const y = (posObj.pageY || posObj.clientY) - domViewport.top;
        event.stageX = x;
        event.stageY = y;

        // 鼠标事件需要阻止冒泡方法 Prevent bubbling on mouse events.
        event.stopPropagation = function() {
            this._stopPropagationed = true;
        };

        const meshResult = this.getMeshResultAtPoint(x, y, true);
        const obj = meshResult.mesh;
        event.hitPoint = meshResult.point;

        // fire mouseout/touchout event for last event target
        const leave = type === 'mouseout';
        // 当obj和target不同 且obj不是target的子元素时才触发out事件 fire out event when obj and target isn't the same as well as obj is not a child element to target.
        if (target && (target !== obj && (!target.contains || !target.contains(obj)) || leave)) {
            let out = false;
            if (type === 'touchmove') {
                out = 'touchout';
            } else if (type === 'mousemove' || leave || !obj) {
                out = 'mouseout';
            }

            if (out) {
                const outEvent = Object.assign({}, event);
                outEvent.type = out;
                outEvent.eventTarget = target;
                target._fireMouseEvent(outEvent);
            }
            event.lastEventTarget = target;
            this._eventTarget = null;
        }

        // fire event for current view
        if (obj && obj.pointerEnabled && type !== 'mouseout') {
            event.eventTarget = this._eventTarget = obj;
            obj._fireMouseEvent(event);
        }

        // set cursor for current view
        if (!isTouch) {
            let cursor = (obj && obj.pointerEnabled && obj.useHandCursor) ? 'pointer' : '';
            canvas.style.cursor = cursor;
        }

        // fix android: `touchmove` fires only once
        if (browser.android && type === 'touchmove') {
            event.preventDefault();
        }
    },
    /**
     * 更新 DOM viewport
     * @return {Object} DOM viewport, {left, top, right, bottom}
     */
    updateDomViewport() {
        const canvas = this.canvas;
        let domViewport = null;
        if (canvas.parentNode) {
            domViewport = this.domViewport = getElementRect(canvas);
        }
        return domViewport;
    },
    /**
     * 获取指定点的 mesh
     * @param  {Number}  x
     * @param  {Number}  y
     * @param  {Boolean} [eventMode=false]
     * @return {Mesh|null}
     */
    getMeshResultAtPoint(x, y, eventMode = false) {
        const camera = this.camera;
        let ray = this._ray;
        if (!ray) {
            ray = this._ray = new Ray();
        }
        ray.fromCamera(camera, x, y, this.width, this.height);
        const hitResult = this.raycast(ray, true, eventMode);
        if (hitResult) {
            return hitResult[0];
        }

        if (!this._stageResultAtPoint) {
            this._stageResultAtPoint = {
                mesh: this,
                point: new Vector3()
            };
        }

        const point = this._stageResultAtPoint.point;
        point.copy(camera.unprojectVector(point.set(x, y, 0), this.width, this.height));
        return this._stageResultAtPoint;
    },
    /**
     * 释放 WebGL 资源
     * @return {Stage} this
     */
    releaseGLResource() {
        this.renderer.releaseGLResource();
        return this;
    },
    /**
     * 销毁
     * @return {Stage} this
     */
    destroy() {
        this.releaseGLResource();
        this.traverse((child) => {
            child.off();
            child.parent = null;
        });
        this.children.length = 0;
        this.renderer.off();

        return this;
    }
});

export default Stage;
