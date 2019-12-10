import Class from '../core/Class';
import math from '../math/math';
import EventMixin from '../core/EventMixin';
import log from '../utils/log';

/**
 * 动画类
 * @class
 * @mixes EventMixin
 * @fires end 动画完全结束事件
 * @fires loopEnd 动画每次循环结束事件
 */
const Animation = Class.create(/** @lends Animation.prototype */{
    Statics: {
        _anims: [],
        /**
         * tick
         * @memberOf Animation
         * @static
         * @param  {Number} dt 一帧时间
         */
        tick(dt) {
            this._anims.forEach(anim => anim.tick(dt));
        }
    },
    Mixes: EventMixin,
    /**
     * @default true
     * @type {boolean}
     */
    isAnimation: true,
    /**
     * @default Animation
     * @type {string}
     */
    className: 'Animation',
    /**
     * 动画是否暂停
     * @default false
     * @type {boolean}
     */
    paused: false,
    /**
     * 动画当前播放次数
     * @default 0
     * @type {number}
     */
    currentLoopCount: 0,
    /**
     * 动画需要播放的次数，默认值为 Infinity 表示永远循环
     * @default Infinity
     * @type {number}
     */
    loop: Infinity,
    /**
     * 动画当前时间
     * @default 0
     * @type {number}
     */
    currentTime: 0,
    /**
     * 动画播放速度
     * @default 1
     * @type {number}
     */
    timeScale: 1,
    /**
     * 动画开始时间
     * @default 0
     * @type {number}
     */
    startTime: 0,
    /**
     * 动画结束时间，初始化后会根据 AnimationStates 来自动获取，也可以通过 play 来改变
     * @default 0
     * @type {number}
     */
    endTime: 0,
    /**
     * 动画整体的最小时间，初始化后会根据 AnimationStates 来自动获取
     * @default 0
     * @type {number}
     */
    clipStartTime: 0,
    /**
     * 动画整体的最大时间，初始化后会根据 AnimationStates 来自动获取
     * @default 0
     * @type {number}
     */
    clipEndTime: 0,
    nodeNameMap: null,
    _rootNode: null,
    /**
     * 动画根节点，不指定根节点将无法正常播放动画
     * @default null
     * @type {Node}
     */
    rootNode: {
        get() {
            return this._rootNode;
        },
        set(value) {
            this._rootNode = value;
            this.initNodeNameMap();
        }
    },
    /**
     * AnimationId集合
     * @type {Object}
     */
    validAnimationIds: null,
    /**
     * @constructs
     * @param {Object} parmas 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(parmas) {
        /**
         * @type {string}
         */
        this.id = math.generateUUID(this.className);
        /**
         * 动画状态列表
         * @default []
         * @type {AnimationStates[]}
         */
        this.animStatesList = [];
        /**
         * 动画剪辑列表，{ name: { start: 0, end: 1} }，play的时候可以通过name来播放某段剪辑
         * @default {}
         * @type {Object}
         */
        this.clips = {};
        Object.assign(this, parmas);
        this.initClipTime();
    },
    /**
     * 添加动画剪辑
     * @param {string} name 剪辑名字
     * @param {number} start 动画开始时间
     * @param {number} end 动画结束时间
     * @param {Array.<AnimationState>} animStatesList 动画帧列表
     */
    addClip(name, start, end, animStatesList) {
        this.clips[name] = {
            start,
            end,
            animStatesList
        };
    },
    /**
     * 移除动画剪辑
     * @param {string} name 需要移除的剪辑名字
     */
    removeClip(name) {
        this.clips[name] = null;
    },
    /**
     * 获取动画列表的时间信息
     * @param  {AnimationStates[]} animStatesList 动画列表
     * @return {Object} result {startTime, endTime} 时间信息
     */
    getAnimStatesListTimeInfo(animStatesList) {
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
    },
    initClipTime() {
        const timeInfo = this.getAnimStatesListTimeInfo(this.animStatesList);
        this.clipStartTime = timeInfo.startTime;
        this.clipEndTime = timeInfo.endTime;
    },
    initNodeNameMap() {
        if (this._rootNode) {
            const map = this.nodeNameMap = {};
            this._rootNode.traverse((child) => {
                map[child.animationId] = child;

                // fix smd animation bug
                const originName = child.name;
                if (originName !== undefined && !map[originName]) {
                    map[originName] = child;
                }
            }, false);
        }
    },
    tick(dt) {
        if (this.paused) {
            return;
        }
        this.currentTime += dt / 1000 * this.timeScale;

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
    },
    /**
     * 更新动画状态
     * @return {Animation} this
     */
    updateAnimStates() {
        this.animStatesList.forEach((animStates) => {
            animStates.updateNodeState(this.currentTime, this.nodeNameMap[animStates.nodeName]);
        });

        return this;
    },
    /**
     * 播放动画(剪辑)
     * @param {number|string} [startOrClipName=0] 动画开始时间，或者动画剪辑名字
     * @param {number} [end=this.clipEndTime] 动画结束时间，如果是剪辑的话不需要传
     */
    play(startOrClipName, end) {
        let start;
        if (typeof startOrClipName === 'string') {
            const clip = this.clips[startOrClipName];
            if (clip) {
                start = clip.start;
                end = clip.end;
                if (clip.animStatesList) {
                    this.animStatesList = clip.animStatesList;
                    this.initClipTime();
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

        // 先移除，然后再插入
        this.stop();
        this.paused = false;
        Animation._anims.push(this);
    },
    /**
     * 停止动画，这个会将动画从Ticker中移除，需要重新调用play才能再次播放
     */
    stop() {
        this.paused = true;
        const anims = Animation._anims;
        const index = anims.indexOf(this);
        if (index !== -1) {
            anims.splice(index, 1);
        }
    },
    /**
     * 暂停动画，这个不会将动画从Ticker中移除
     */
    pause() {
        this.paused = true;
    },
    /**
     * 恢复动画播放，只能针对 pause 暂停后恢复
     */
    resume() {
        this.paused = false;
    },
    /**
     * clone动画
     * @param {Node} rootNode 目标动画根节点
     * @return {Animation} clone的动画对象
     */
    clone(rootNode) {
        const anim = new this.constructor({
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
});

export default Animation;
