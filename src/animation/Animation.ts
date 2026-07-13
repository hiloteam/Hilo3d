import math from '../math/math';
import { EventDispatcher } from '../core/EventMixin';
import type Node from '../core/Node';
import type AnimationStates from './AnimationStates';
import { requireNumber } from '../math/numberArray';

export interface AnimationClip {
    start: number;
    end: number;
    animStatesList?: AnimationStates[];
}

export interface AnimationParameters {
    paused?: boolean;
    currentLoopCount?: number;
    loop?: number;
    currentTime?: number;
    timeScale?: number;
    startTime?: number;
    endTime?: number;
    rootNode?: Node | null;
    animStatesList?: AnimationStates[];
    validAnimationIds?: Readonly<Record<string, boolean>> | null;
    clips?: Record<string, AnimationClip | null>;
}

export interface AnimationTimeRange {
    startTime: number;
    endTime: number;
}
/**
 * 动画类
 */
class Animation extends EventDispatcher {
    static readonly _anims: Animation[] = [];
    /**
     * tick
     * @param dt - 一帧时间
     */
    static tick(dt: number): void {
        this._anims.forEach(anim => {
            anim.tick(dt);
        });
    }
    isAnimation = true;
    className = 'Animation';
    /**
     * 动画是否暂停
     */
    paused = false;
    /**
     * 动画当前播放次数
     */
    currentLoopCount = 0;
    /**
     * 动画需要播放的次数，默认值为 Infinity 表示永远循环
     */
    loop = Infinity;
    /**
     * 动画当前时间
     */
    currentTime = 0;
    /**
     * 动画播放速度
     */
    timeScale = 1;
    /**
     * 动画开始时间
     */
    startTime = 0;
    /**
     * 动画结束时间，初始化后会根据 AnimationStates 来自动获取，也可以通过 play 来改变
     */
    endTime = 0;
    /**
     * 动画整体的最小时间，初始化后会根据 AnimationStates 来自动获取
     */
    clipStartTime = 0;
    /**
     * 动画整体的最大时间，初始化后会根据 AnimationStates 来自动获取
     */
    clipEndTime = 0;
    readonly id: string;
    clips: Record<string, AnimationClip | null> = {};
    nodeNameMap: Record<string, Node> = {};
    private _rootNode: Node | null = null;
    /**
     * 动画根节点，不指定根节点将无法正常播放动画
     */
    get rootNode(): Node | null {
        return this._rootNode;
    }
    /**
     * 动画根节点，不指定根节点将无法正常播放动画
     */
    set rootNode(value: Node | null) {
        this._rootNode = value;
        this._initNodeNameMap();
    }
    private _animStatesList: AnimationStates[] = [];
    /**
     * 动画状态列表
     */
    get animStatesList(): AnimationStates[] {
        return this._animStatesList;
    }
    /**
     * 动画状态列表
     */
    set animStatesList(value: AnimationStates[]) {
        this._animStatesList = value;
        this._initClipTime();
    }
    /**
     * AnimationId集合
     */
    validAnimationIds: Readonly<Record<string, boolean>> | null = null;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: AnimationParameters = {}) {
        super();
        this.id = math.generateUUID(this.className);
        /**
         * 动画剪辑列表，例如 `{ name: { start: 0, end: 1 } }`，play 时可以通过 name 播放某段剪辑。
         */
        Object.assign(this, params);
    }
    /**
     * 添加动画剪辑
     * @param name - 剪辑名字
     * @param start - 动画开始时间
     * @param end - 动画结束时间
     * @param animStatesList - 动画帧列表
     */
    addClip(name: string, start: number, end: number, animStatesList: AnimationStates[]): void {
        this.clips[name] = {
            start,
            end,
            animStatesList
        };
    }
    /**
     * 移除动画剪辑
     * @param name - 需要移除的剪辑名字
     */
    removeClip(name: string): void {
        this.clips[name] = null;
    }
    /**
     * 获取动画列表的时间信息
     * @param animStatesList - 动画列表
     * @returns result `{ startTime, endTime }` 时间信息
     */
    getAnimStatesListTimeInfo(animStatesList: AnimationStates[]): AnimationTimeRange {
        let endTime = 0;
        let startTime = Infinity;
        animStatesList.forEach(animStates => {
            if (animStates.keyTime.length === 0) return;
            endTime = Math.max(
                requireNumber(animStates.keyTime, animStates.keyTime.length - 1),
                endTime
            );
            startTime = Math.min(requireNumber(animStates.keyTime, 0), startTime);
        });
        return {
            startTime,
            endTime
        };
    }
    /**
     * 初始化 clip time
     */
    private _initClipTime(): void {
        const timeInfo = this.getAnimStatesListTimeInfo(this.animStatesList);
        this.clipStartTime = 0;
        this.clipEndTime = timeInfo.endTime;
    }
    /**
     * 初始化 node name map
     */
    _initNodeNameMap(): void {
        if (this._rootNode) {
            const map: Record<string, Node> = (this.nodeNameMap = {});
            this._rootNode.traverse(child => {
                map[child.animationId] = child;
                // fix smd animation bug
                const originName = child.name;
                map[originName] ??= child;
            }, false);
        }
    }
    /**
     * tick
     * @param dt -
     */
    tick(dt: number): void {
        if (this.paused) {
            return;
        }
        this.currentTime += (dt / 1000) * this.timeScale;
        // 当前动画结束
        if (this.currentTime >= this.endTime) {
            this.currentLoopCount++;
            // 渲染最后一帧
            this.currentTime = this.endTime;
            this.updateAnimStates();
            this.fire('loopEnd');
            // 动画完全结束
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
     * @returns this
     */
    updateAnimStates(): this {
        this.animStatesList.forEach(animStates => {
            animStates.updateNodeState(this.currentTime, this.nodeNameMap[animStates.nodeName]);
        });
        return this;
    }
    /**
     * 播放动画(剪辑)
     * @param startOrClipName - 动画开始时间，或者动画剪辑名字
     * @param end - 动画结束时间，如果是剪辑的话不需要传
     */
    play(startOrClipName?: number | string, end?: number): void {
        let start;
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
                throw new RangeError(`Unknown animation clip: ${startOrClipName}`);
            }
        } else {
            start = startOrClipName;
        }
        start ??= this.clipStartTime;
        end ??= this.clipEndTime;
        this.endTime = Math.min(end, this.clipEndTime);
        this.startTime = Math.min(start, this.endTime);
        this.currentTime = this.startTime;
        this.currentLoopCount = 0;
        // 先移除，然后再插入
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
     * @param rootNode - 目标动画根节点
     * @returns clone的动画对象
     */
    clone(rootNode: Node): Animation {
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
