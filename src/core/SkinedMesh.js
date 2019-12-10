import Class from './Class';
import Mesh from './Mesh';
import Matrix4 from '../math/Matrix4';
import DataTexture from '../texture/DataTexture';
import capabilities from '../renderer/capabilities';

const tempMatrix1 = new Matrix4();
const tempMatrix2 = new Matrix4();

/**
 * 蒙皮Mesh
 * @class
 * @extends Mesh
 */
const SkinedMesh = Class.create(/** @lends SkinedMesh.prototype */{
    Extends: Mesh,
    /**
     * @default true
     * @type {boolean}
     */
    isSkinedMesh: true,
    /**
     * @default SkinedMesh
     * @type {string}
     */
    className: 'SkinedMesh',
    _rootNode: null,
    /**
     * 这个骨骼Mesh的根节点，改变后会自动根据 jointNames 来更新 jointNodeList
     * @default null
     * @type {Node}
     */
    rootNode: {
        get() {
            return this._rootNode;
        },
        set(node) {
            this._rootNode = node;
            this.initJointNodeList();
        }
    },
    /**
     * 骨骼节点数组
     * @default null
     * @type {Node[]}
     */
    jointNodeList: null,
    /**
     * 是否支持 Instanced
     * @default false
     * @type {boolean}
     */
    useInstanced: false,
    /**
     * 骨骼矩阵DataTexture
     * @default null
     * @type {DataTexture}
     */
    jointMatTexture: null,
    /**
     * 是否开启视锥体裁剪
     * @default false
     * @type {Boolean}
     */
    frustumTest: false,
    /**
     * @constructs
     * @param {object} params 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        /**
         * 当前骨骼Mesh关联的骨骼名字列表
         * @default []
         * @type {string[]}
         */
        this.jointNames = [];

        /**
         * 当前骨骼Mesh的 inverseBindMatrices
         * @default []
         * @type {Array}
         */
        this.inverseBindMatrices = [];
        SkinedMesh.superclass.constructor.call(this, params);
    },
    initJointNodeList() {
        if (!this._rootNode) {
            return;
        }
        const jointMap = {};
        this._rootNode.traverse((child) => {
            if ('jointName' in child) {
                jointMap[child.jointName] = child;
            }
        });
        this.jointNodeList = [];
        this.jointNames.forEach((name) => {
            this.jointNodeList.push(jointMap[name]);
        });
    },
    /**
     * 获取每个骨骼对应的矩阵数组
     * @return {Float32Array} 返回矩阵数组
     */
    getJointMat() {
        if (!this.jointNodeList) {
            return undefined;
        }
        if (!this.jointMat) {
            this.jointMat = new Float32Array(this.jointNodeList.length * 16);
        }

        if (this._rootNode || !this.clonedFrom) {
            tempMatrix2.invert(this.worldMatrix);
        } else {
            tempMatrix2.invert(this.clonedFrom.worldMatrix);
        }

        this.jointNodeList.forEach((node, i) => {
            tempMatrix1.copy(tempMatrix2);
            tempMatrix1.multiply(node.worldMatrix);
            tempMatrix1.multiply(this.inverseBindMatrices[i]);
            tempMatrix1.toArray(this.jointMat, i * 16);
        });
        return this.jointMat;
    },
    /**
     * 根据当前骨骼数来生成骨骼矩阵的 jointMatTexture
     * @return {DataTexture}
     */
    initJointMatTexture() {
        if (!this.jointMatTexture) {
            const jointMat = this.getJointMat();
            this.jointMatTexture = new DataTexture({
                data: jointMat
            });
        }
        return this.jointMatTexture;
    },
    /**
     * 将 getJointMat 获取的骨骼矩阵数组更新到 jointMatTexture 中
     */
    updateJointMatTexture() {
        if (!this.jointMatTexture) {
            this.initJointMatTexture();
        } else {
            const jointMat = this.getJointMat();
            this.jointMatTexture.data.set(jointMat, 0);
            this.jointMatTexture.needUpdate = true;
        }
    },
    clone(isChild) {
        const mesh = Mesh.prototype.clone.call(this, isChild);
        Object.assign(mesh, {
            useInstanced: this.useInstanced,
            jointNames: this.jointNames.slice(),
            inverseBindMatrices: this.inverseBindMatrices.map(m => m.clone()),
            jointNodeList: this.jointNodeList
        });
        mesh.clonedFrom = this;
        return mesh;
    },
    getRenderOption(opt = {}) {
        SkinedMesh.superclass.getRenderOption.call(this, opt);
        const jointCount = this.jointNames.length;
        if (jointCount) {
            opt.JOINT_COUNT = jointCount;
            if (capabilities.VERTEX_TEXTURE_FLOAT) {
                let maxJointCount = (capabilities.MAX_VERTEX_UNIFORM_VECTORS - 22) / 4;
                if (jointCount > maxJointCount) {
                    opt.JOINT_MAT_MAP = 1;
                }
            }
        }
        return opt;
    }
});

export default SkinedMesh;
