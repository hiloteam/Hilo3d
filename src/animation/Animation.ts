import math from '../math/math';
/* eslint-disable class-methods-use-this */
import { EventObject, EventMixinCallback } from '../core/EventMixin';
import log from '../utils/log';
import AnimationStates from './AnimationStates';

interface EventListener {
    listener: EventMixinCallback;
    once?: boolean;
}

interface AnimationClip {
    start: number;
    end: number;
    animStatesList?: AnimationStates[];
}

interface AnimationParams {
    rootNode?: any;
    animStatesList?: AnimationStates[];
    timeScale?: number;
    loop?: number;
    paused?: boolean;
    currentTime?: number;
    startTime?: number;
    endTime?: number;
    clips?: Record<string, AnimationClip>;
}

/**
 * 动画类
 * @class
 * @fires end 动画完全结束事件
 * @fires loopEnd 动画每次循环结束事件
 */
class Animation {
    private static _anims: Animation[] = [];

    /**
     * tick
     * @param {Number} dt 一帧时间
     */
    static tick(dt: number): void {
        Animation._anims.forEach(anim => anim.tick(dt));
    }

    /**
     * @default true
     * @type {boolean}
     */
    isAnimation: boolean = true;

    /**
     * @default Animation
     * @type {string}
     */
    className: string = 'Animation';

    /**
     * 动画是否暂停
     * @default false
     * @type {boolean}
     */
    paused: boolean = false;

    /**
     * 动画当前播放次数
     * @default 0
     * @type {number}
     */
    currentLoopCount: number = 0;

    /**
     * 动画需要播放的次数，默认值为 Infinity 表示永远循环
     * @default Infinity
     * @type {number}
     */
    loop: number = Infinity;

    /**
     * 动画当前时间
     * @default 0
     * @type {number}
     */
    currentTime: number = 0;

    /**
     * 动画播放速度
     * @default 1
     * @type {number}
     */
    timeScale: number = 1;

    /**
     * 动画开始时间
     * @default 0
     * @type {number}
     */
    startTime: number = 0;

    /**
     * 动画结束时间，初始化后会根据 AnimationStates 来自动获取，也可以通过 play 来改变
     * @default 0
     * @type {number}
     */
    endTime: number = 0;

    /**
     * 动画整体的最小时间，初始化后会根据 AnimationStates 来自动获取
     * @default 0
     * @type {number}
     */
    clipStartTime: number = 0;

    /**
     * 动画整体的最大时间，初始化后会根据 AnimationStates 来自动获取
     * @default 0
     * @type {number}
     */
    clipEndTime: number = 0;

    nodeNameMap: Record<string, any> | null = null;

    private _rootNode: any = null;

    private _animStatesList: AnimationStates[] = [];

    /**
     * AnimationId集合
     * @type {Object}
     */
    validAnimationIds: any = null;

    /**
     * @type {string}
     */
    id: string | number;

    /**
     * 动画剪辑列表，{ name: { start: 0, end: 1} }，play的时候可以通过name来播放某段剪辑
     * @default {}
     * @type {Object}
     */
    clips: Record<string, AnimationClip> = {};

    private _listeners: Record<string, EventListener[]> | null = null;

    /**
     * 动画根节点，不指定根节点将无法正常播放动画
     * @default null
     * @type {Node}
     */
    get rootNode(): any {
        return this._rootNode;
    }

    set rootNode(value: any) {
        this._rootNode = value;
        this._initNodeNameMap();
    }

    /**
     * 动画状态列表
     * @default []
     * @type {AnimationStates[]}
     */
    get animStatesList(): AnimationStates[] {
        return this._animStatesList;
    }

    set animStatesList(value: AnimationStates[]) {
        this._animStatesList = value;
        this._initClipTime();
    }

    /**
     * @constructs
     * @param {Object} [parmas] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(parmas?: AnimationParams) {
        this.id = math.generateUUID(this.className);
        this.clips = {};
        this._animStatesList = [];
        Object.assign(this, parmas);
    }

    /**
     * 增加一个事件监听。
     * @param {String} type 要监听的事件类型。
     * @param {EventMixinCallback} listener 事件监听回调函数。
     * @param {Boolean} [once] 是否是一次性监听，即回调函数响应一次后即删除，不再响应。
     * @return {Animation} 对象本身。链式调用支持。
     */
    on(type: string, listener: EventMixinCallback, once?: boolean): Animation {
        const listeners = (this._listeners = this._listeners || {});
        const eventListeners = (listeners[type] = listeners[type] || []);
        for (let i = 0, len = eventListeners.length; i < len; i++) {
            const el = eventListeners[i];
            if (el.listener === listener) {
                return this;
            }
        }
        eventListeners.push({
            listener,
            once
        });
        return this;
    }

    /**
     * 删除一个事件监听。如果不传入任何参数，则删除所有的事件监听；如果不传入第二个参数，则删除指定类型的所有事件监听。
     * @param {String} [type] 要删除监听的事件类型。
     * @param {EventMixinCallback} [listener] 要删除监听的回调函数。
     * @returns {Animation} 对象本身。链式调用支持。
     */
    off(type?: string, listener?: EventMixinCallback): Animation {
        if (arguments.length === 0) {
            this._listeners = null;
            return this;
        }

        const eventListeners = this._listeners && this._listeners[type!];
        if (eventListeners && eventListeners.length > 0) {
            if (arguments.length === 1) {
                delete this._listeners![type!];
                return this;
            }

            for (let i = 0, len = eventListeners.length; i < len; i++) {
                const el = eventListeners[i];
                if (el.listener === listener) {
                    eventListeners.splice(i, 1);
                    break;
                }
            }
        }
        return this;
    }

    /**
     * 发送事件。当第一个参数类型为Object时，则把它作为一个整体事件对象。
     * @param {String|EventObject} [type] 要发送的事件类型或者一个事件对象。
     * @param {Object} [detail] 要发送的事件的具体信息，即事件随带参数。
     * @returns {Boolean} 是否成功调度事件。
     */
    fire(type: string | EventObject, detail?: any): boolean {
        let event: EventObject | undefined;
        let eventType: string;
        if (typeof type === 'string') {
            eventType = type;
        } else {
            event = type;
            eventType = type.type;
        }

        const listeners = this._listeners;
        if (!listeners) return false;

        const eventListeners = listeners[eventType];
        if (eventListeners && eventListeners.length > 0) {
            const eventListenersCopy = eventListeners.slice(0);
            event = event || new EventObject(eventType, this, detail);
            if (event._stopped) return false;

            for (let i = 0; i < eventListenersCopy.length; i++) {
                const el = eventListenersCopy[i];
                el.listener.call(this, event);
                if (el.once) {
                    const index = eventListeners.indexOf(el);
                    if (index > -1) {
                        eventListeners.splice(index, 1);
                    }
                }
            }

            return true;
        }
        return false;
    }

    /**
     * 添加动画剪辑
     * @param {string} name 剪辑名字
     * @param {number} start 动画开始时间
     * @param {number} end 动画结束时间
     * @param {AnimationStates[]} animStatesList 动画帧列表
     */
    addClip(name: string, start: number, end: number, animStatesList?: AnimationStates[]): void {
        this.clips[name] = {
            start,
            end,
            animStatesList
        };
    }

    /**
     * 移除动画剪辑
     * @param {string} name 需要移除的剪辑名字
     */
    removeClip(name: string): void {
        delete this.clips[name];
    }

    /**
     * 获取动画列表的时间信息
     * @param  {AnimationStates[]} animStatesList 动画列表
     * @return {Object} result {startTime, endTime} 时间信息
     */
    getAnimStatesListTimeInfo(animStatesList: AnimationStates[]): { startTime: number; endTime: number } {
        let endTime = 0;
        let startTime = Infinity;
        animStatesList.forEach((animStates) => {
            endTime = Math.max(animStates.keyTime[animStates.keyTime.length - 1], endTime);
            startTime = Math.min(animStates.keyTime[0], startTime);
        });

        return {
            startTime,
            endTime
        };
    }

    /**
     * 初始化 clip time
     * @private
     */
    private _initClipTime(): void {
        const timeInfo = this.getAnimStatesListTimeInfo(this.animStatesList);
        this.clipStartTime = 0;
        this.clipEndTime = timeInfo.endTime;
    }

    /**
     * 初始化 node name map
     */
    private _initNodeNameMap(): void {
        if (this._rootNode) {
            const map = this.nodeNameMap = {};
            this._rootNode.traverse((child: any) => {
                map[child.animationId] = child;

                const originName = child.name;
                if (originName !== undefined && !map[originName]) {
                    map[originName] = child;
                }
            }, false);
        }
    }

    /**
     * tick
     * @param  {Number} dt
     */
    tick(dt: number): void {
        if (this.paused) {
            return;
        }
        this.currentTime += dt / 1000 * this.timeScale;

        if (this.currentTime >= this.endTime) {
            this.currentLoopCount++;

            this.currentTime = this.endTime;
            this.updateAnimStates();
            this.fire('loopEnd');

            if (!this.loop || this.currentLoopCount >= this.loop) {
                this.stop();
                this.fire('end');
            } else {
                this.currentTime = this.startTime;
            }
        } else {
            this.updateAnimStates();
        }
    }

    /**
     * 更新动画状态
     * @return {Animation} this
     */
    updateAnimStates(): Animation {
        this.animStatesList.forEach((animStates) => {
            animStates.updateNodeState(this.currentTime, this.nodeNameMap![animStates.nodeName]);
        });

        return this;
    }

    /**
     * 播放动画(剪辑)
     * @param {number|string} [startOrClipName=0] 动画开始时间，或者动画剪辑名字
     * @param {number} [end=this.clipEndTime] 动画结束时间，如果是剪辑的话不需要传
     */
    play(startOrClipName?: number | string, end?: number): void {
        let start: number | undefined;
        if (typeof startOrClipName === 'string') {
            const clip = this.clips[startOrClipName];
            if (clip) {
                start = clip.start;
                end = clip.end;
                if (clip.animStatesList) {
                    this.animStatesList = clip.animStatesList;
                    this._initClipTime();
                }
            } else {
                log.warn('no this animation clip name:' + startOrClipName);
            }
        } else {
            start = startOrClipName;
        }

        if (start === undefined) {
            start = this.clipStartTime;
        }
        if (end === undefined) {
            end = this.clipEndTime;
        }

        this.endTime = Math.min(end, this.clipEndTime);
        this.startTime = Math.min(start, this.endTime);
        this.currentTime = this.startTime;
        this.currentLoopCount = 0;

        this.stop();
        this.paused = false;
        Animation._anims.push(this);
    }

    /**
     * 停止动画，这个会将动画从Ticker中移除，需要重新调用play才能再次播放
     */
    stop(): void {
        this.paused = true;
        const anims = Animation._anims;
        const index = anims.indexOf(this);
        if (index !== -1) {
            anims.splice(index, 1);
        }
    }

    /**
     * 暂停动画，这个不会将动画从Ticker中移除
     */
    pause(): void {
        this.paused = true;
    }

    /**
     * 恢复动画播放，只能针对 pause 暂停后恢复
     */
    resume(): void {
        this.paused = false;
    }

    /**
     * clone动画
     * @param {Node} rootNode 目标动画根节点
     * @return {Animation} clone的动画对象
     */
    clone(rootNode: any): Animation {
        const anim = new Animation({
            rootNode,
            animStatesList: this.animStatesList,
            timeScale: this.timeScale,
            loop: this.loop,
            paused: this.paused,
            currentTime: this.currentTime,
            startTime: this.startTime,
            endTime: this.endTime,
            clips: this.clips
        });
        if (!this.paused) {
            anim.play();
        }
        return anim;
    }
}

export default Animation;
