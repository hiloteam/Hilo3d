import Node, { type NodeParameters, type NodePointerEvent, type NodeRaycastInfo } from './Node';
import version from './version';
import WebGLRenderer from '../renderer/WebGLRenderer';
import WebGPURenderer, { type WebGPUFramebufferParameters } from '../renderer/WebGPURenderer';
import type { RendererBackend } from '../renderer/Renderer';
import type { FramebufferParameters } from '../renderer/Framebuffer';
import Ray from '../math/Ray';
import Vector3 from '../math/Vector3';
import type Color from '../math/Color';
import type Camera from '../camera/Camera';
import log from '../utils/log';
import { getElementRect } from '../utils/util';

type DOMViewport = ReturnType<typeof getElementRect>;

interface DOMPointerInfo {
    pageX: number;
    pageY: number;
    clientX: number;
    clientY: number;
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    button: number;
    buttons: number;
    pressure: number;
    width: number;
    height: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
}

const DOM_EVENT_OPTIONS: AddEventListenerOptions = { passive: false };
const DIRECT_MANIPULATION_EVENTS = new Set([
    'pointerdown',
    'pointermove',
    'touchstart',
    'touchmove'
]);
const EXIT_EVENTS = new Set(['pointerout', 'pointerleave', 'mouseout', 'mouseleave', 'touchout']);
const CANCEL_EVENTS = new Set(['pointercancel', 'touchcancel']);
const END_EVENTS = new Set(['pointerup', 'mouseup', 'touchend']);

function getOutEventType(type: string): string | null {
    if (type.startsWith('pointer')) return 'pointerout';
    if (type.startsWith('mouse')) return 'mouseout';
    if (type.startsWith('touch')) return 'touchout';
    return null;
}

function getDOMPointerInfo(event: Event): DOMPointerInfo {
    if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
        return {
            pageX: event.pageX,
            pageY: event.pageY,
            clientX: event.clientX,
            clientY: event.clientY,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            button: event.button,
            buttons: event.buttons,
            pressure: event.pressure,
            width: event.width,
            height: event.height,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey
        };
    }

    if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
        const touch = event.changedTouches[0] ?? event.touches[0];
        if (touch) {
            return {
                pageX: touch.pageX,
                pageY: touch.pageY,
                clientX: touch.clientX,
                clientY: touch.clientY,
                pointerId: touch.identifier,
                pointerType: 'touch',
                isPrimary: touch === event.touches[0] || event.touches.length === 0,
                button: 0,
                buttons: event.type === 'touchend' || event.type === 'touchcancel' ? 0 : 1,
                pressure: touch.force,
                width: touch.radiusX * 2,
                height: touch.radiusY * 2,
                altKey: event.altKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey
            };
        }
    }

    if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) {
        return {
            pageX: event.pageX,
            pageY: event.pageY,
            clientX: event.clientX,
            clientY: event.clientY,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: event.button,
            buttons: event.buttons,
            pressure: event.buttons === 0 ? 0 : 0.5,
            width: 1,
            height: 1,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey
        };
    }

    return {
        pageX: 0,
        pageY: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 0,
        pointerType: '',
        isPrimary: true,
        button: 0,
        buttons: 0,
        pressure: 0,
        width: 1,
        height: 1,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false
    };
}

export interface StageParameters<
    Backend extends RendererBackend = 'webgl2'
> extends NodeParameters {
    /** Graphics backend. Selection is explicit; unsupported WebGPU never falls back silently. */
    backend?: Backend;
    container?: HTMLElement;
    canvas?: HTMLCanvasElement;
    camera?: Camera | null;
    width?: number;
    height?: number;
    pixelRatio?: number;
    clearColor?: Color;
    useInstanced?: boolean;
    useFramebuffer?: boolean;
    framebufferOption?: Backend extends 'webgpu'
        ? WebGPUFramebufferParameters
        : FramebufferParameters;
    useLogDepth?: boolean;
    alpha?: boolean;
    depth?: boolean;
    stencil?: boolean;
    antialias?: boolean;
    premultipliedAlpha?: boolean;
    preserveDrawingBuffer?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    gameMode?: boolean;
}

export type StageRenderer<Backend extends RendererBackend> = Backend extends 'webgpu'
    ? WebGPURenderer
    : WebGLRenderer;

export interface StagePointerEvent extends NodePointerEvent {
    stageX: number;
    stageY: number;
    originalEvent: Event;
    lastEventTarget?: Node;
    preventDefault(): void;
    stopPropagation(): void;
}

function containsNode(parent: Node, possibleChild: Node): boolean {
    for (let node: Node | null = possibleChild.parent; node; node = node.parent) {
        if (node === parent) return true;
    }
    return false;
}
/**
 * 舞台类
 * @example
 * ```ts
 * const stage = new Hilo3d.Stage({
 *     container:document.body,
 *     width:innerWidth,
 *     height:innerHeight
 * });
 * ```
 */
class Stage<Backend extends RendererBackend = 'webgl2'> extends Node {
    static override readonly typeName: string = 'Stage';
    isStage = true;
    override className = 'Stage';
    /**
     * 渲染器
     */
    renderer: StageRenderer<Backend>;
    /** Resolves when the selected graphics backend is ready for rendering. */
    readonly ready: Promise<void>;
    /**
     * 摄像机
     */
    camera: Camera | null = null;
    /**
     * 像素密度
     */
    pixelRatio = 1;
    /**
     * 偏移值
     */
    offsetX = 0;
    /**
     * 偏移值
     */
    offsetY = 0;
    /**
     * 舞台宽度
     */
    width = 0;
    /**
     * 舞台高度
     */
    height = 0;
    /**
     * canvas
     */
    canvas: HTMLCanvasElement;
    rendererWidth = 0;
    rendererHeight = 0;
    domViewport: DOMViewport | null = null;
    private _domListener: EventListener | null = null;
    private readonly _eventTargets = new Map<number, Node>();
    private readonly _enabledDOMEvents = new Set<string>();
    private _previousTouchAction: string | null = null;
    private _ray: Ray | null = null;
    private _stageResultAtPoint: NodeRaycastInfo | null = null;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性，所有属性会透传给 Renderer。
     * - `params.container`: stage的容器, 如果有，会把canvas加进container里。
     * - `params.canvas`: stage的canvas，不传会自动创建。
     * - `params.camera`: stage的摄像机。
     * - `params.width`: stage的宽，默认网页宽度
     * - `params.height`: stage的高，默认网页高度
     * - `params.pixelRatio`: 像素密度。
     * - `params.clearColor`: 背景色。
     * - `params.useFramebuffer`: 是否使用当前 backend 的离屏 render target。
     * - `params.framebufferOption`: 当前 backend 的 render-target 配置，useFramebuffer 为 true 时生效。
     * - `params.useLogDepth`: 是否使用对数深度，处理深度冲突。
     * - `params.alpha`: 是否背景透明。
     * - `params.depth`: 是否需要深度缓冲区。
     * - `params.stencil`: 是否需要模版缓冲区。
     * - `params.antialias`: 是否抗锯齿。
     * - `params.premultipliedAlpha`: 是否需要 premultipliedAlpha。
     * - `params.preserveDrawingBuffer`: 是否需要 preserveDrawingBuffer。
     * - `params.failIfMajorPerformanceCaveat`: 是否需要 failIfMajorPerformanceCaveat。
     */
    constructor(params: StageParameters<Backend> = {}) {
        const width = params.width ?? window.innerWidth;
        const height = params.height ?? window.innerHeight;
        let pixelRatio = params.pixelRatio;
        if (!pixelRatio) {
            pixelRatio = window.devicePixelRatio || 1;
            pixelRatio = Math.min(pixelRatio, 1024 / Math.max(width, height), 2);
            pixelRatio = Math.max(pixelRatio, 1);
        }
        const resolvedParams: StageParameters<Backend> = { ...params, width, height, pixelRatio };
        super();
        Object.assign(this, resolvedParams);
        this.canvas = this.createCanvas(resolvedParams);
        const renderer =
            resolvedParams.backend === 'webgpu'
                ? new WebGPURenderer({
                      ...(resolvedParams as StageParameters<'webgpu'>),
                      domElement: this.canvas
                  })
                : new WebGLRenderer({
                      ...(resolvedParams as StageParameters),
                      domElement: this.canvas
                  });
        this.renderer = renderer as StageRenderer<Backend>;
        this.ready = renderer.ready;
        this.resize(this.width, this.height, this.pixelRatio, true);
        log.log(`Hilo3d version: ${version}`);
    }

    /** Construct and await an asynchronously initialized backend. */
    static async create<Backend extends RendererBackend = 'webgl2'>(
        params: StageParameters<Backend> = {}
    ): Promise<Stage<Backend>> {
        const stage = new Stage(params);
        await stage.ready;
        return stage;
    }
    /**
     * 生成canvas
     * @param params -
     */
    private createCanvas(params: {
        readonly canvas?: HTMLCanvasElement;
        readonly container?: HTMLElement;
    }): HTMLCanvasElement {
        let canvas: HTMLCanvasElement;
        if (params.canvas) {
            canvas = params.canvas;
        } else {
            canvas = document.createElement('canvas');
        }
        if (params.container) {
            params.container.appendChild(canvas);
        }
        return canvas;
    }
    /**
     * 缩放舞台
     * @param width - 舞台宽
     * @param height - 舞台高
     * @param pixelRatio - 像素密度
     * @param force - 是否强制刷新
     * @returns 舞台本身。链式调用支持。
     */
    resize(width: number, height: number, pixelRatio?: number, force?: boolean): this {
        pixelRatio ??= this.pixelRatio;
        if (
            force ||
            this.width !== width ||
            this.height !== height ||
            this.pixelRatio !== pixelRatio
        ) {
            this.width = width;
            this.height = height;
            this.pixelRatio = pixelRatio;
            this.rendererWidth = width * pixelRatio;
            this.rendererHeight = height * pixelRatio;
            const canvas = this.canvas;
            const renderer = this.renderer;
            renderer.resize(this.rendererWidth, this.rendererHeight, force);
            canvas.style.width = `${String(this.width)}px`;
            canvas.style.height = `${String(this.height)}px`;
            this.updateDomViewport();
        }
        return this;
    }
    /**
     * 设置舞台偏移值
     * @param x - x
     * @param y - y
     * @returns 舞台本身。链式调用支持。
     */
    setOffset(x: number, y: number): this {
        if (this.offsetX !== x || this.offsetY !== y) {
            this.offsetX = x;
            this.offsetY = y;
            const pixelRatio = this.pixelRatio;
            this.renderer.setOffset(x * pixelRatio, y * pixelRatio);
        }
        return this;
    }
    /**
     * 改viewport
     * @param x - x
     * @param y - y
     * @param width - width
     * @param height - height
     * @returns 舞台本身。链式调用支持。
     */
    viewport(x: number, y: number, width: number, height: number): this {
        this.resize(width, height, this.pixelRatio, true);
        this.setOffset(x, y);
        return this;
    }
    /**
     * 渲染一帧
     * @param dt - 间隔时间
     * @returns 舞台本身。链式调用支持。
     */
    tick(dt: number): this {
        this.traverseUpdate(dt);
        if (this.camera) {
            this.renderer.render(this, this.camera, true);
        }
        return this;
    }
    /**
     * 开启/关闭舞台的DOM事件响应。要让舞台上的可视对象响应用户交互，必须先使用此方法开启舞台的相应事件的响应。
     * @param types - 要开启/关闭的事件名称或数组。
     * @param enabled - 指定开启还是关闭。如果不传此参数，则默认为开启。
     * @returns 舞台本身。链式调用支持。
     */
    enableDOMEvent(types: string | readonly string[], enabled = true): this {
        const canvas = this.canvas;
        const handler =
            this._domListener ??
            (this._domListener = (e: Event) => {
                this._onDOMEvent(e);
            });
        types = typeof types === 'string' ? [types] : types;
        types.forEach(type => {
            if (enabled && !this._enabledDOMEvents.has(type)) {
                canvas.addEventListener(type, handler, DOM_EVENT_OPTIONS);
                this._enabledDOMEvents.add(type);
            } else if (!enabled && this._enabledDOMEvents.has(type)) {
                canvas.removeEventListener(type, handler, DOM_EVENT_OPTIONS);
                this._enabledDOMEvents.delete(type);
            }
        });
        this.updateTouchAction();
        return this;
    }

    private updateTouchAction(): void {
        const handlesDirectManipulation = [...this._enabledDOMEvents].some(type =>
            DIRECT_MANIPULATION_EVENTS.has(type)
        );
        if (handlesDirectManipulation && this._previousTouchAction === null) {
            this._previousTouchAction = this.canvas.style.touchAction;
            this.canvas.style.touchAction = 'none';
        } else if (!handlesDirectManipulation && this._previousTouchAction !== null) {
            this.canvas.style.touchAction = this._previousTouchAction;
            this._previousTouchAction = null;
        }
    }
    /**
     * DOM事件处理函数。此方法会把事件调度到事件的坐标点所对应的可视对象。
     */
    private _onDOMEvent(event: Event): void {
        const canvas = this.canvas;
        const type = event.type;
        const domViewport = this.domViewport ?? this.updateDomViewport();
        const pointerInfo = getDOMPointerInfo(event);
        const target = this._eventTargets.get(pointerInfo.pointerId) ?? null;
        const x = pointerInfo.pageX - domViewport.left;
        const y = pointerInfo.pageY - domViewport.top;
        const pointerEvent: StagePointerEvent = {
            type,
            stageX: x,
            stageY: y,
            ...pointerInfo,
            originalEvent: event,
            preventDefault: () => {
                event.preventDefault();
            },
            stopPropagation() {
                this._stopPropagationed = true;
            }
        };
        const meshResult = this.getMeshResultAtPoint(x, y, true);
        const obj = meshResult?.mesh ?? null;
        if (meshResult) pointerEvent.hitPoint = meshResult.point;

        if (CANCEL_EVENTS.has(type)) {
            const cancelTarget = target ?? obj;
            if (cancelTarget?.pointerEnabled) {
                pointerEvent.eventTarget = cancelTarget;
                cancelTarget._firePointerEvent(pointerEvent);
            }
            this._eventTargets.delete(pointerInfo.pointerId);
            canvas.style.cursor = '';
            return;
        }

        if (EXIT_EVENTS.has(type)) {
            const exitTarget = target ?? obj;
            if (exitTarget?.pointerEnabled) {
                pointerEvent.eventTarget = exitTarget;
                exitTarget._firePointerEvent(pointerEvent);
            }
            this._eventTargets.delete(pointerInfo.pointerId);
            canvas.style.cursor = '';
            return;
        }

        // A target transition emits the matching modern or compatibility
        // boundary event without relying on browser or device detection.
        if (target && target !== obj && (!obj || !containsNode(target, obj))) {
            const outType = getOutEventType(type);
            if (outType) {
                const outEvent: StagePointerEvent = { ...pointerEvent, type: outType };
                outEvent.eventTarget = target;
                target._firePointerEvent(outEvent);
            }
            pointerEvent.lastEventTarget = target;
            this._eventTargets.delete(pointerInfo.pointerId);
        }

        if (obj?.pointerEnabled) {
            pointerEvent.eventTarget = obj;
            this._eventTargets.set(pointerInfo.pointerId, obj);
            obj._firePointerEvent(pointerEvent);
        } else {
            this._eventTargets.delete(pointerInfo.pointerId);
        }

        if (END_EVENTS.has(type) && pointerInfo.pointerType !== 'mouse') {
            this._eventTargets.delete(pointerInfo.pointerId);
        }
        canvas.style.cursor =
            pointerInfo.pointerType === 'touch'
                ? ''
                : obj?.pointerEnabled && obj.useHandCursor
                  ? 'pointer'
                  : '';
    }
    /**
     * 更新 DOM viewport
     * @returns DOM viewport，格式为 `{ left, top, right, bottom }`
     */
    updateDomViewport(): DOMViewport {
        const canvas = this.canvas;
        const domViewport = getElementRect(canvas);
        this.domViewport = domViewport;
        return domViewport;
    }
    /**
     * 获取指定点的 mesh
     * @param x -
     * @param y -
     * @param eventMode -
     */
    getMeshResultAtPoint(x: number, y: number, eventMode = false): NodeRaycastInfo | null {
        const camera = this.camera;
        if (!camera) return null;
        const ray = (this._ray ??= new Ray());
        ray.fromCamera(camera, x, y, this.width, this.height);
        const hitResult = this.raycast(ray, true, eventMode);
        const firstHit = hitResult?.[0];
        if (firstHit && !(firstHit instanceof Vector3)) {
            return firstHit;
        }
        this._stageResultAtPoint ??= {
            mesh: this,
            point: new Vector3()
        };
        const point = this._stageResultAtPoint.point;
        point.copy(camera.unprojectVector(point.set(x, y, 0), this.width, this.height));
        return this._stageResultAtPoint;
    }
    /**
     * 释放当前图形后端资源。
     * @returns this
     */
    releaseGPUResources(): this {
        this.renderer.releaseGPUResources();
        return this;
    }
    /**
     * 销毁
     * @returns this
     */
    override destroy(): this {
        this.enableDOMEvent([...this._enabledDOMEvents], false);
        this._eventTargets.clear();
        super.destroy(this.renderer);
        this.traverse(child => {
            child.off();
            child.parent = null;
        });
        this.children.length = 0;
        this.renderer.destroy();
        return this;
    }
}
export default Stage;
