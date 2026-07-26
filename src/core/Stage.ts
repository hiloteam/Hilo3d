import Node, { type NodeParameters, type NodePointerEvent, type NodeRaycastInfo } from './Node';
import version from './version';
import Renderer, {
    type RendererBackend,
    type RendererFrame,
    type RendererOptions,
    type RendererSupportOptions
} from '../render/Renderer';
import Ray from '../math/Ray';
import Vector3 from '../math/Vector3';
import type Color from '../math/Color';
import Camera from '../camera/Camera';
import type Fog from './Fog';
import log from '../utils/log';
import { getElementRect } from '../utils/util';
import type { RenderPipelineFactory } from '../render/pipeline/RenderPipeline';
import { snapshotRenderPipelineFactory } from '../render/pipeline/RenderPipelineFactory';
import {
    describeWebGL2OnlyRendererOption,
    describeWebGPUOnlyPipelineRequirement,
    describeWebGPUOnlyRendererFeature
} from '../render/internal/RenderPipelineBackendSelection';
import { setCameraCompositionSingleSample } from '../render/internal/CameraCompositionPolicy';

type DOMViewport = ReturnType<typeof getElementRect>;
const STAGE_CONSTRUCTION_TOKEN = Symbol('Stage construction');

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
const compareCameraPriority = (left: Camera, right: Camera): number =>
    left.priority - right.priority;

function compare2DDisplayOrder(left: Node, right: Node): number {
    if (left.sortingLayer !== right.sortingLayer) {
        return left.sortingLayer - right.sortingLayer;
    }
    return left.zIndex - right.zIndex;
}

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

export interface StageCommonParameters extends NodeParameters {
    container?: HTMLElement;
    canvas?: HTMLCanvasElement;
    camera?: Camera | null;
    /**
     * Ordered cameras rendered into one Render Graph/RHI submission. Later cameras overlay earlier
     * cameras and preserve their color unless `camera.clearColor` is enabled.
     */
    cameras?: readonly Camera[];
    fog?: Fog | null;
    width?: number;
    height?: number;
    pixelRatio?: number;
    clearColor?: Color;
    useInstanced?: boolean;
    useLogDepth?: boolean;
    alpha?: boolean;
    depth?: boolean;
    stencil?: boolean;
    antialias?: boolean;
    premultipliedAlpha?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    gameMode?: boolean;
    /** Renderer-local scriptable pipeline factory snapshotted during Stage.create(). */
    renderPipeline?: RenderPipelineFactory;
}

/** Requested backend policy. `auto` probes WebGPU first and otherwise selects WebGL 2. */
export type StageBackend = RendererBackend | 'auto';

export type StageBackendParameters<Backend extends StageBackend> = [StageBackend] extends [Backend]
    ? RendererSupportOptions & {
          backend?: StageBackend;
          /** Supplying this WebGL2-only option makes `auto` select WebGL 2. */
          preserveDrawingBuffer?: boolean;
      }
    : [RendererBackend] extends [Backend]
      ? RendererSupportOptions & {
            backend: RendererBackend;
            /** Dynamic backend selection is guarded at runtime when this WebGL2-only option exists. */
            preserveDrawingBuffer?: boolean;
        }
      : Backend extends 'webgpu'
        ? RendererSupportOptions & {
              /** Explicit WebGPU selection never falls back silently. */
              backend: 'webgpu';
              /** WebGPU has no preserved default framebuffer; use an explicit copy/readback pass. */
              preserveDrawingBuffer?: never;
          }
        : Backend extends 'auto'
          ? RendererSupportOptions & {
                /** The asynchronous factory defaults to WebGPU-first automatic selection. */
                backend?: 'auto';
                /** Supplying this WebGL2-only option makes `auto` select WebGL 2. */
                preserveDrawingBuffer?: boolean;
            }
          : {
                backend?: 'webgl2';
                preserveDrawingBuffer?: boolean;
            };

export type StageParameters<Backend extends StageBackend = 'auto'> = StageCommonParameters & {
    backend?: Backend;
} & StageBackendParameters<Backend>;

function snapshotStageParameters(
    params: StageParameters<StageBackend>
): StageParameters<StageBackend> {
    const renderPipeline =
        params.renderPipeline === undefined
            ? undefined
            : snapshotRenderPipelineFactory(params.renderPipeline);
    const requiredFeatureSet = new Set(params.requiredFeatures ?? []);
    for (const feature of renderPipeline?.requirements?.requiredFeatures ?? []) {
        requiredFeatureSet.add(feature);
    }
    const requiredLimits: Record<string, number> = { ...(params.requiredLimits ?? {}) };
    for (const [name, value] of Object.entries(
        renderPipeline?.requirements?.requiredLimits ?? {}
    )) {
        requiredLimits[name] = Math.max(requiredLimits[name] ?? 0, value);
    }
    return {
        ...params,
        ...(renderPipeline === undefined ? {} : { renderPipeline }),
        ...(requiredFeatureSet.size === 0 ? {} : { requiredFeatures: [...requiredFeatureSet] }),
        ...(Object.keys(requiredLimits).length === 0 ? {} : { requiredLimits })
    };
}

function createStageCanvas(params: {
    readonly canvas?: HTMLCanvasElement;
    readonly container?: HTMLElement;
}): HTMLCanvasElement {
    const canvas = params.canvas ?? document.createElement('canvas');
    if (params.container) params.container.appendChild(canvas);
    return canvas;
}

async function resolveStageBackendSnapshot(
    params: StageParameters<StageBackend>
): Promise<RendererBackend> {
    const requestedBackend: unknown = params.backend ?? 'auto';
    if (requestedBackend !== 'auto') {
        if (requestedBackend !== 'webgpu' && requestedBackend !== 'webgl2') {
            throw new TypeError(`Unsupported Stage backend ${String(requestedBackend)}`);
        }
    }
    const webGPURequirement =
        describeWebGPUOnlyRendererFeature(params.requiredFeatures) ??
        describeWebGPUOnlyPipelineRequirement(params.renderPipeline?.requirements);
    const webGL2Option = describeWebGL2OnlyRendererOption(params);
    if (requestedBackend === 'webgl2') {
        if (webGPURequirement !== null) {
            throw new TypeError(
                `Stage configuration conflict: ${webGPURequirement} requires WebGPU, but backend webgl2 was requested`
            );
        }
        return 'webgl2';
    }
    if (requestedBackend === 'webgpu') {
        if (webGL2Option !== null) {
            throw new TypeError(
                `Stage configuration conflict: ${webGL2Option}, but backend webgpu was requested`
            );
        }
        return 'webgpu';
    }
    if (webGL2Option !== null) {
        if (webGPURequirement !== null) {
            throw new TypeError(
                `Stage configuration conflict: ${webGPURequirement} requires WebGPU, but ${webGL2Option}`
            );
        }
        return 'webgl2';
    }
    if (await Renderer.isBackendSupported('webgpu', params)) return 'webgpu';
    if (webGPURequirement !== null) {
        throw new Error(
            `No compatible Stage backend: ${webGPURequirement} requires WebGPU, but no compatible WebGPU adapter is available`
        );
    }
    return 'webgl2';
}

/** @internal Resolve a requested backend without creating a device, context, or GPU resource. */
export function resolveStageBackend(
    params: StageParameters<StageBackend> = {}
): Promise<RendererBackend> {
    return resolveStageBackendSnapshot(snapshotStageParameters(params));
}

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
 * Create stages asynchronously with `Stage.create()`.
 *
 * @example
 * ```ts
 * const stage = await Hilo3d.Stage.create({
 *     container:document.body,
 *     width:innerWidth,
 *     height:innerHeight
 * });
 * ```
 */
class Stage<Backend extends RendererBackend = RendererBackend> extends Node {
    static override readonly typeName: string = 'Stage';
    isStage = true;
    override className = 'Stage';
    /**
     * 渲染器
     */
    renderer: Renderer<Backend>;
    /** Resolves when the selected graphics backend is ready for rendering. */
    readonly ready: Promise<void>;
    /** Ordered cameras rendered by `tick()`. */
    readonly cameras: Camera[] = [];
    /**
     * Legacy primary-camera alias. Assigning replaces the first camera while retaining any
     * additional overlay cameras.
     */
    get camera(): Camera | null {
        this.sortCameras();
        return this.cameras[0] ?? null;
    }
    set camera(value: Camera | null) {
        this.sortCameras();
        if (value === null) {
            if (this.cameras.length > 0) this.cameras.shift();
            return;
        }
        if (!(value instanceof Camera)) {
            throw new TypeError('Stage.camera must be a Camera or null.');
        }
        const existingIndex = this.cameras.indexOf(value);
        if (existingIndex > 0) this.cameras.splice(existingIndex, 1);
        if (this.cameras.length === 0) this.cameras.push(value);
        else this.cameras[0] = value;
    }
    /** Scene fog consumed consistently by every renderer backend. */
    fog: Fog | null = null;
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
    private readonly _renderCameraComposition = (frame: RendererFrame): void => {
        for (const camera of this.cameras) frame.render(this, camera, true);
    };
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性，所有属性会透传给 Renderer。
     * - `params.container`: stage的容器, 如果有，会把canvas加进container里。
     * - `params.canvas`: stage的canvas，不传会自动创建。
     * - `params.camera`: stage的摄像机。
     * - `params.width`: stage的宽，默认网页宽度
     * - `params.height`: stage的高，默认网页高度
     * - `params.pixelRatio`: 像素密度。
     * - `params.clearColor`: 背景色。
     * - `params.useLogDepth`: 是否使用对数深度，处理深度冲突。
     * - `params.alpha`: 是否背景透明。
     * - `params.depth`: 是否需要深度缓冲区。
     * - `params.stencil`: 是否需要模版缓冲区。
     * - `params.antialias`: 是否抗锯齿。
     * - `params.premultipliedAlpha`: 是否需要 premultipliedAlpha。
     * - `params.preserveDrawingBuffer`: WebGL2-only preserved default framebuffer option.
     * - `params.failIfMajorPerformanceCaveat`: 是否需要 failIfMajorPerformanceCaveat。
     */
    private constructor(
        params: StageParameters<Backend>,
        canvas: HTMLCanvasElement,
        renderer: Renderer<Backend>,
        token: typeof STAGE_CONSTRUCTION_TOKEN
    ) {
        super();
        if (token !== STAGE_CONSTRUCTION_TOKEN) {
            throw new TypeError('Stage cannot be constructed directly; use await Stage.create()');
        }
        const { camera, cameras, ...stageParameters } = params;
        Object.assign(this, stageParameters);
        if (cameras !== undefined) this.setCameras(cameras);
        else this.camera = camera ?? null;
        this.canvas = canvas;
        this.renderer = renderer;
        this.canvas.dataset['hilo3dBackend'] = renderer.backend;
        this.ready = renderer.ready;
        this.resize(this.width, this.height, this.pixelRatio, true);
        log.log(`Hilo3d version: ${version}`);
    }

    /** Construct and await the WebGPU-first automatic backend policy. */
    static create(params?: StageParameters): Promise<Stage>;
    /** Construct and await an explicitly selected backend. */
    static create<Backend extends RendererBackend>(
        params: StageParameters<Backend>
    ): Promise<Stage<Backend>>;
    /** Construct from a runtime backend policy whose resolved backend is not known statically. */
    static create(params: StageParameters<StageBackend>): Promise<Stage>;
    static async create(params: StageParameters<StageBackend> = {}): Promise<Stage> {
        const parameterSnapshot = snapshotStageParameters(params);
        const backend = await resolveStageBackendSnapshot(parameterSnapshot);
        const width = parameterSnapshot.width ?? window.innerWidth;
        const height = parameterSnapshot.height ?? window.innerHeight;
        let pixelRatio = parameterSnapshot.pixelRatio;
        if (!pixelRatio) {
            pixelRatio = window.devicePixelRatio || 1;
            pixelRatio = Math.min(pixelRatio, 1024 / Math.max(width, height), 2);
            pixelRatio = Math.max(pixelRatio, 1);
        }
        const resolvedParams: StageParameters<RendererBackend> = {
            ...parameterSnapshot,
            backend,
            width,
            height,
            pixelRatio
        };
        const canvas = createStageCanvas(resolvedParams);
        const renderer = await Renderer.create({
            ...resolvedParams,
            backend,
            domElement: canvas
        } as RendererOptions);
        return new Stage(resolvedParams, canvas, renderer, STAGE_CONSTRUCTION_TOKEN);
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
            this.rendererWidth = Math.max(1, Math.round(width * pixelRatio));
            this.rendererHeight = Math.max(1, Math.round(height * pixelRatio));
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
        this.sortCameras();
        const cameras = this.cameras;
        if (cameras.length === 1) {
            const camera = cameras[0];
            if (camera) this.renderer.render(this, camera, true);
        } else if (cameras.length > 1) {
            let preserveDepthStencil = false;
            for (let index = 1; index < cameras.length; index += 1) {
                const camera = cameras[index];
                if (camera && (!camera.clearDepth || !camera.clearStencil)) {
                    preserveDepthStencil = true;
                    break;
                }
            }
            if (preserveDepthStencil) {
                for (const camera of cameras) setCameraCompositionSingleSample(camera, true);
            }
            try {
                this.renderer.renderFrame(this._renderCameraComposition);
            } finally {
                if (preserveDepthStencil) {
                    for (const camera of cameras) setCameraCompositionSingleSample(camera, false);
                }
            }
        }
        return this;
    }
    /**
     * Replace the ordered camera composition.
     * @param cameras - Unique Camera instances in back-to-front render order.
     */
    setCameras(cameras: readonly Camera[]): this {
        const unique = new Set<Camera>();
        for (const camera of cameras) {
            if (!(camera instanceof Camera)) {
                throw new TypeError('Stage cameras must contain only Camera instances.');
            }
            if (unique.has(camera)) {
                throw new TypeError('Stage cameras cannot contain the same Camera more than once.');
            }
            unique.add(camera);
        }
        this.cameras.length = 0;
        for (const camera of cameras) this.cameras.push(camera);
        return this;
    }
    /**
     * Append a camera after existing cameras.
     * @param camera - Camera to add.
     */
    addCamera(camera: Camera): this {
        if (!(camera instanceof Camera)) {
            throw new TypeError('Stage.addCamera() requires a Camera.');
        }
        if (!this.cameras.includes(camera)) this.cameras.push(camera);
        return this;
    }
    /**
     * Remove a camera from the composition.
     * @param camera - Camera to remove.
     */
    removeCamera(camera: Camera): this {
        const index = this.cameras.indexOf(camera);
        if (index >= 0) this.cameras.splice(index, 1);
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
        const ray = (this._ray ??= new Ray());
        this.sortCameras();
        // Later cameras draw on top, so they receive pointer priority. Layer filtering mirrors the
        // renderer's per-camera scene collection.
        for (let cameraIndex = this.cameras.length - 1; cameraIndex >= 0; cameraIndex -= 1) {
            const camera = this.cameras[cameraIndex];
            if (!camera) continue;
            camera.updateViewProjectionMatrix();
            ray.fromCamera(camera, x, y, this.width, this.height);
            const isCamera2D = Reflect.get(camera, 'isCamera2D') === true;
            const hitResult = this.raycast(ray, !isCamera2D, eventMode);
            if (!hitResult) continue;
            let top2DHit: NodeRaycastInfo | null = null;
            for (const hit of hitResult) {
                if (hit instanceof Vector3) continue;
                if (!camera.isLayerVisible(hit.mesh)) continue;
                if (!isCamera2D) return hit;
                if (top2DHit === null || compare2DDisplayOrder(top2DHit.mesh, hit.mesh) <= 0) {
                    top2DHit = hit;
                }
            }
            if (top2DHit !== null) return top2DHit;
        }
        const camera = this.cameras.at(-1);
        if (!camera) return null;
        this._stageResultAtPoint ??= {
            mesh: this,
            point: new Vector3()
        };
        const point = this._stageResultAtPoint.point;
        point.copy(camera.unprojectVector(point.set(x, y, 0), this.width, this.height));
        return this._stageResultAtPoint;
    }
    private sortCameras(): void {
        let sorted = true;
        for (let index = 1; index < this.cameras.length; index += 1) {
            const previous = this.cameras[index - 1];
            const current = this.cameras[index];
            if (previous && current && previous.priority > current.priority) {
                sorted = false;
                break;
            }
        }
        if (sorted) return;
        this.cameras.sort(compareCameraPriority);
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
