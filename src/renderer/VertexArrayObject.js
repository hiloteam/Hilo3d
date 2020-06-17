import Class from '../core/Class';
import extensions from './extensions';
import Buffer from './Buffer';
import GeometryData from '../geometry/GeometryData';
import bufferUtil from '../utils/bufferUtil';
import Cache from '../utils/Cache';
import log from '../utils/log';
import constants from '../constants';

const {
    TRIANGLES
} = constants;

let globalStates = [];
let currentVao = null;
const cache = new Cache();

/**
 * VAO
 * @class
 */
const VertexArrayObject = Class.create(/** @lends VertexArrayObject.prototype */ {
    Statics: {
        /**
         * 缓存
         * @readOnly
         * @memberOf VertexArrayObject
         * @return {Cache}
         */
        cache: {
            get() {
                return cache;
            }
        },
        /**
         * 获取 vao
         * @memberOf VertexArrayObject
         * @param  {WebGLRenderingContext} gl
         * @param  {String} id  缓存id
         * @param  {Object} params
         * @return {VertexArrayObject}
         */
        getVao(gl, id, params) {
            let vao = cache.get(id);
            if (!vao) {
                vao = new VertexArrayObject(gl, id, params);
                cache.add(id, vao);
            } else if (params.mode && params.mode !== vao.mode) {
                // for geometry.mode change
                vao.mode = params.mode;
            }

            return vao;
        },
        /**
         * 重置所有vao
         * @memberOf VertexArrayObject
         * @param  {WebGLRenderingContext} gl
         */
        reset(gl) { // eslint-disable-line no-unused-vars
            currentVao = null;
            globalStates = [];
            this.bindSystemVao();
            cache.each((vao) => {
                vao.destroy(gl);
            });
        },
        /**
         * 绑定系统vao
         * @memberOf VertexArrayObject
         */
        bindSystemVao() {
            if (extensions.vao) {
                extensions.vao.bindVertexArrayOES(null);
            }

            currentVao = null;
        }
    },

    /**
     * @default VertexArrayObject
     * @type {String}
     */
    className: 'VertexArrayObject',

    /**
     * @default true
     * @type {Boolean}
     */
    isVertexArrayObject: true,

    /**
     * 顶点数量
     * @type {Number}
     * @private
     */
    vertexCount: null,

    /**
     * 是否使用 vao
     * @type {Boolean}
     * @default false
     */
    useVao: false,

    /**
     * 是否使用 instanced
     * @type {Boolean}
     * @default false
     */
    useInstanced: false,

    /**
     * 绘图方式
     * @type {GLenum}
     * @default gl.TRIANGLES
     */
    mode: TRIANGLES,

    /**
     * 是否脏
     * @type {Boolean}
     * @default true
     */
    isDirty: true,

    /**
     * @constructs
     * @param  {WebGLRenderingContext} gl
     * @param  {String} id  缓存id
     * @param  {Object} params
     */
    constructor(gl, id, params) {
        this.gl = gl;
        this.id = id;
        this.vaoExtension = extensions.vao;
        this.instancedExtension = extensions.instanced;

        Object.assign(this, params);

        if (!this.vaoExtension) {
            this.useVao = false;
        }

        if (!this.instancedExtension) {
            this.useInstanced = false;
        }

        if (this.useVao) {
            this.vao = this.vaoExtension.createVertexArrayOES();
        }

        this.attributes = [];
        this.activeStates = [];
        this.indexBuffer = null;
    },
    /**
     * bind
     */
    bind() {
        if (currentVao !== this) {
            if (this.useVao) {
                this.vaoExtension.bindVertexArrayOES(this.vao);
            } else {
                this.bindSystemVao();
            }
            currentVao = this;
        }
    },
    /**
     * @private
     */
    bindSystemVao() {
        const gl = this.gl;
        if (currentVao && currentVao.useVao) {
            currentVao.unbind();
        }
        const activeStates = this.activeStates;

        let lastBuffer;
        this.attributes.forEach((attributeObject) => {
            const {
                buffer,
                attribute,
                geometryData
            } = attributeObject;

            if (lastBuffer !== buffer) {
                lastBuffer = buffer;
                buffer.bind();
            }

            attribute.enable();
            attribute.pointer(geometryData);
            if (attributeObject.useInstanced) {
                attribute.divisor(1);
            } else {
                attribute.divisor(0);
            }
        });

        globalStates.forEach((globalAttributeObject, i) => {
            const activeAttributeObject = activeStates[i];
            if (globalAttributeObject && !activeAttributeObject) {
                globalAttributeObject.attribute.divisor(0);
                gl.disableVertexAttribArray(i);
            }
        });

        if (this.indexBuffer) {
            this.indexBuffer.bind();
        }
        globalStates = activeStates;
    },
    /**
     * unbind
     */
    unbind() {
        if (this.useVao) {
            this.vaoExtension.bindVertexArrayOES(null);
        }
        currentVao = null;
    },
    /**
     * draw
     */
    draw() {
        this.bind();
        const {
            gl,
            mode
        } = this;

        if (this.indexBuffer) {
            gl.drawElements(mode, this.vertexCount, this.indexType, 0);
        } else {
            gl.drawArrays(mode, 0, this.getVertexCount());
        }
    },
    /**
     * 获取顶点数量
     * @return {Number} 顶点数量
     */
    getVertexCount() {
        if (this.vertexCount === null) {
            const attributeObj = this.attributes[0];
            if (attributeObj) {
                this.vertexCount = attributeObj.geometryData.count;
            } else {
                this.vertexCount = 0;
            }
        }
        return this.vertexCount;
    },
    /**
     * drawInstance
     * @param  {Number} [primcount=1]
     */
    drawInstance(primcount = 1) {
        this.bind();
        const {
            gl,
            mode
        } = this;
        if (this.useInstanced) {
            if (this.indexBuffer) {
                this.instancedExtension.drawElementsInstancedANGLE(mode, this.vertexCount, gl.UNSIGNED_SHORT, 0, primcount);
            } else {
                this.instancedExtension.drawArraysInstancedANGLE(mode, 0, this.getVertexCount(), primcount);
            }
        }
    },
    /**
     * addIndexBuffer
     * @param {GeometryData} data
     * @param {GLenum} usage gl.STATIC_DRAW|gl.DYNAMIC_DRAW
     * @return {Buffer} Buffer
     */
    addIndexBuffer(geometryData, usage) {
        this.bind();
        const gl = this.gl;
        let buffer = this.indexBuffer;
        this.indexType = geometryData.type;
        if (!buffer) {
            buffer = Buffer.createIndexBuffer(gl, geometryData, usage);
            buffer.bind();
            this.indexBuffer = buffer;
            this.vertexCount = geometryData.length;
        } else if (geometryData.isDirty) {
            buffer.uploadGeometryData(geometryData);
            this.vertexCount = geometryData.length;
        }

        return buffer;
    },
    /**
     * addAttribute
     * @param {GeometryData} geometryData
     * @param {Object} attribute
     * @param {GLenum} usage gl.STATIC_DRAW|gl.DYNAMIC_DRAW
     * @param {Function} onInit
     * @return {AttributeObject} attributeObject
     */
    addAttribute(geometryData, attribute, usage, onInit) {
        this.bind();
        const gl = this.gl;
        const name = attribute.name;

        let attributeObject = this[name];
        if (!attributeObject) {
            const buffer = Buffer.createVertexBuffer(gl, geometryData, usage);
            buffer.bind();
            attribute.enable();
            attribute.pointer(geometryData);
            attributeObject = {
                attribute,
                buffer,
                geometryData
            };
            this.attributes.push(attributeObject);
            this[name] = attributeObject;
            attribute.addTo(this.activeStates, attributeObject);
            if (onInit) {
                onInit(attributeObject);
            }
        }

        if (geometryData.isDirty) {
            const buffer = attributeObject.buffer;
            buffer.bind();
            attribute.enable();
            attribute.pointer(geometryData);
            buffer.uploadGeometryData(geometryData);
        }

        return attributeObject;
    },
    /**
     * addInstancedAttribute
     * @param {Object} attribute
     * @param {Array} meshes
     * @param {function} getData
     * @return {AttributeObject} attributeObject
     */
    addInstancedAttribute(attribute, meshes, getData) {
        this.bind();
        const gl = this.gl;
        const {
            name,
            glTypeInfo
        } = attribute;

        let instancedData = bufferUtil.getTypedArray(Float32Array, meshes.length * glTypeInfo.size);
        meshes.forEach((mesh, index) => {
            const attributeData = getData(mesh);
            if (attributeData !== undefined) {
                bufferUtil.fillArrayData(instancedData, getData(mesh), index * glTypeInfo.size);
            } else {
                log.warn('no attributeData:' + name + '-' + mesh.name);
            }
        });

        const attributeObject = this[name];
        let geometryData;
        if (attributeObject) {
            geometryData = attributeObject.geometryData;
            geometryData.data = instancedData;
        } else {
            geometryData = new GeometryData(instancedData, 1);
        }

        return this.addAttribute(geometryData, attribute, gl.DYNAMIC_DRAW, (attributeObject) => {
            attribute.divisor(1);
            attributeObject.useInstanced = true;
        });
    },

    /**
     * 获取资源
     * @param {Object[]} [resources=[]]
     * @return {Object[]}
     */
    getResources(resources = []) {
        this.attributes.forEach((attributeObject) => {
            resources.push(attributeObject.buffer);
        });

        if (this.indexBuffer) {
            resources.push(this.indexBuffer);
        }

        return resources;
    },
    /**
     * 没有被引用时销毁资源
     * @param  {WebGLRenderer} renderer
     * @return {VertexArrayObject} this
     */
    destroyIfNoRef(renderer) {
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyIfNoRef(this);

        return this;
    },
    /**
     * 销毁资源
     * @return {VertexArrayObject} this
     */
    destroy() {
        if (this._isDestroyed) {
            return this;
        }

        this.instancedExtension = null;

        if (this.useVao) {
            this.vaoExtension.deleteVertexArrayOES(this.vao);
            this.vao = null;
            this.vaoExtension = null;
        }
        this.gl = null;
        this.indexBuffer = null;
        this.attributes.forEach((attributeObject) => {
            const attribute = attributeObject.attribute || {};
            this[attribute.name] = null;
        });
        this.attributes = null;
        this.activeStates = null;
        cache.removeObject(this);

        this._isDestroyed = true;
        return this;
    }
});

export default VertexArrayObject;


/**
 * 顶点对象
 * @typedef {object} AttributeObject
 * @property {Object} attribute
 * @property {WebGLBuffer} buffer
 * @property {GeometryData} geometryData
 * @property {Boolean} useInstanced
 */
