import Class from '../core/Class';
import Color from '../math/Color';
import EventMixin from '../core/EventMixin';
import RenderInfo from './RenderInfo';
import RenderList from './RenderList';
import WebGPUState from './WebGPUState';
import WebGPUResourceManager from './WebGPUResourceManager';
import LightManager from '../light/LightManager';

/**
 * WebGPU渲染器
 * @class
 * @fires init 初始化事件
 * @fires beforeRender 渲染前事件
 * @fires beforeRenderScene 渲染场景前事件
 * @fires afterRender 渲染后事件
 * @fires initFailed 初始化失败事件
 * @fires contextLost 上下文丢失事件
 * @fires contextRestored 上下文恢复事件
 * @mixes EventMixin
 */
const WebGPURenderer = Class.create(/** @lends WebGPURenderer.prototype */ {
    Mixes: EventMixin,

    /**
     * @default WebGPURenderer
     * @type {String}
     */
    className: 'WebGPURenderer',

    /**
     * @default true
     * @type {Boolean}
     */
    isWebGPURenderer: true,

    /**
     * GPU设备
     * @default null
     * @type {GPUDevice}
     */
    device: null,

    /**
     * GPU适配器
     * @default null
     * @type {GPUAdapter}
     */
    adapter: null,

    /**
     * canvas上下文
     * @default null
     * @type {GPUCanvasContext}
     */
    context: null,

    /**
     * 宽
     * @type {Number}
     * @default 0
     */
    width: 0,

    /**
     * 高
     * @type {Number}
     * @default 0
     */
    height: 0,

    /**
     * 像素密度
     * @type {Number}
     * @default 1
     */
    pixelRatio: 1,

    /**
     * dom元素
     * @type {HTMLCanvasElement}
     * @default null
     */
    domElement: null,

    /**
     * 是否开启透明背景
     * @type {Boolean}
     * @default false
     */
    alpha: false,

    /**
     * 纹理格式
     * @type {String}
     * @default 'bgra8unorm'
     */
    format: 'bgra8unorm',

    /**
     * 是否初始化失败
     * @default false
     * @type {Boolean}
     */
    isInitFailed: false,

    /**
     * 是否初始化
     * @type {Boolean}
     * @default false
     * @private
     */
    _isInit: false,

    /**
     * @constructs
     * @param  {Object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        /**
         * 背景色
         * @type {Color}
         * @default new Color(1, 1, 1, 1)
         */
        this.clearColor = new Color(1, 1, 1);

        Object.assign(this, params);

        /**
         * 渲染信息
         * @type {RenderInfo}
         * @default new RenderInfo
         */
        this.renderInfo = new RenderInfo();

        /**
         * 渲染列表
         * @type {RenderList}
         * @default new RenderList
         */
        this.renderList = new RenderList();

        /**
         * 灯光管理器
         * @type {LightManager}
         * @default new LightManager
         */
        this.lightManager = new LightManager();

        /**
         * 资源管理器
         * @type {WebGPUResourceManager}
         * @default new WebGPUResourceManager
         */
        this.resourceManager = new WebGPUResourceManager();
    },

    /**
     * 改变大小
     * @param  {Number} width  宽
     * @param  {Number} height  高
     * @param  {Boolean} [force=false] 是否强制刷新
     */
    resize(width, height, force) {
        if (force || this.width !== width || this.height !== height) {
            const canvas = this.domElement;
            this.width = width;
            this.height = height;
            canvas.width = width;
            canvas.height = height;

            this.viewport();
        }
    },

    /**
     * 设置viewport
     * @param  {Number} [x=0]  x
     * @param  {Number} [y=0] y
     * @param  {Number} [width=this.width]  width
     * @param  {Number} [height=this.height]  height
     */
    viewport(x, y, width, height) {
        if (this.state) {
            if (x === undefined) {
                x = 0;
            }
            if (y === undefined) {
                y = 0;
            }
            if (width === undefined) {
                width = this.width;
            }
            if (height === undefined) {
                height = this.height;
            }
            this.state.viewport(x, y, width, height);
        }
    },

    /**
     * 是否初始化
     * @type {Boolean}
     * @default false
     * @readOnly
     */
    isInit: {
        get() {
            return this._isInit && !this.isInitFailed;
        }
    },

    /**
     * 初始化回调
     * @return {WebGPURenderer} this
     */
    onInit(callback) {
        if (this._isInit) {
            callback(this);
        } else {
            this.on('init', () => {
                callback(this);
            }, true);
        }
    },

    /**
     * 初始化 context
     */
    async initContext() {
        if (!this._isInit) {
            this._isInit = true;
            try {
                await this._initContext();
                this.fire('init');
            } catch (e) {
                this.isInitFailed = true;
                this.fire('initFailed', e);
                throw e;
            }
        }
    },

    async _initContext() {
        // 检查WebGPU支持
        if (!navigator.gpu) {
            throw new Error('WebGPU is not supported in this browser');
        }

        // 请求适配器
        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });

        if (!this.adapter) {
            throw new Error('Failed to get WebGPU adapter');
        }

        // 请求设备
        this.device = await this.adapter.requestDevice();

        if (!this.device) {
            throw new Error('Failed to get WebGPU device');
        }

        // 获取canvas上下文
        this.context = this.domElement.getContext('webgpu');

        if (!this.context) {
            throw new Error('Failed to get WebGPU context');
        }

        // 配置context
        const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
        this.format = this.alpha ? 'rgba8unorm' : preferredFormat;

        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: this.alpha ? 'premultiplied' : 'opaque'
        });

        /**
         * state，初始化后生成。
         * @type {WebGPUState}
         * @default null
         */
        this.state = new WebGPUState(this.device);

        // 监听设备丢失
        this.device.lost.then((info) => {
            this._onContextLost(info);
        });
    },

    _onContextLost(info) {
        // eslint-disable-next-line no-console
        console.error('WebGPU device lost:', info.message);
        this.fire('contextLost', info);
    },

    /**
     * 清空画布
     * @param  {Color} [clearColor] 清空颜色
     */
    clear(clearColor) {
        clearColor = clearColor || this.clearColor;

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const renderPassDescriptor = {
            colorAttachments: [{
                view: textureView,
                clearValue: {
                    r: clearColor.r,
                    g: clearColor.g,
                    b: clearColor.b,
                    a: clearColor.a
                },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.end();

        this.device.queue.submit([commandEncoder.finish()]);
    },

    /**
     * 渲染
     * @param  {Stage} stage 舞台
     * @param  {Camera} camera 相机
     * @param  {Boolean} [fireEvent=true] 是否触发事件
     */
    render(stage, camera, fireEvent = true) {
        if (!this.isInit) {
            return this;
        }

        if (fireEvent) {
            this.fire('beforeRender');
        }

        this.renderInfo.reset();

        // 清空背景
        this.clear();

        // TODO: 实现完整的渲染管线
        // 这里需要:
        // 1. 收集场景中的可渲染对象
        // 2. 创建或获取渲染管线
        // 3. 设置uniforms和绑定资源
        // 4. 执行绘制命令

        if (fireEvent) {
            this.fire('afterRender');
        }

        return this;
    },

    /**
     * 销毁
     */
    destroy() {
        if (this.device) {
            this.device.destroy();
            this.device = null;
        }
        this.context = null;
        this.adapter = null;
        this._isInit = false;
    }
});

export default WebGPURenderer;
