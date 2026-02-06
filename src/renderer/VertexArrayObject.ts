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

let globalStates: AttributeObject[] = [];
let currentVao: VertexArrayObject | null = null;
const cache = new Cache<VertexArrayObject>();

/**
 * 顶点对象
 * @typedef {object} AttributeObject
 * @property {Object} attribute
 * @property {WebGLBuffer} buffer
 * @property {GeometryData} geometryData
 * @property {Boolean} useInstanced
 */
interface AttributeObject {
    attribute: any;
    buffer: Buffer;
    geometryData: GeometryData;
    useInstanced?: boolean;
}

interface VAOParams {
    mode?: number;
    useVao?: boolean;
    useInstanced?: boolean;
    isDirty?: boolean;
}

/**
 * VAO
 * @class
 */
class VertexArrayObject {
    /**
     * 缓存
     * @type {Cache}
     * @readOnly
     * @return {Cache}
     */
    static get cache(): Cache<VertexArrayObject> {
        return cache;
    }

    /**
     * 获取 vao
     * @param  {WebGLRenderingContext} gl
     * @param  {String} id  缓存id
     * @param  {Object} params
     * @return {VertexArrayObject}
     */
    static getVao(gl: WebGLRenderingContext, id: string, params: VAOParams): VertexArrayObject {
        let vao = cache.get(id);
        if (!vao) {
            vao = new VertexArrayObject(gl, id, params);
            cache.add(id, vao);
        } else if (params.mode && params.mode !== vao.mode) {
            // for geometry.mode change
            vao.mode = params.mode;
        }

        return vao;
    }

    /**
     * 重置所有vao
     * @param  {WebGLRenderingContext} gl
     */
    static reset(gl: WebGLRenderingContext): void {
        currentVao = null;
        globalStates = [];
        this.bindSystemVao();
        cache.each((vao: VertexArrayObject) => {
            vao.destroy(gl);
        });
    }

    /**
     * 绑定系统vao
     */
    static bindSystemVao(): void {
        if (extensions.vao) {
            extensions.vao.bindVertexArray(null);
        }

        currentVao = null;
    }

    /**
     * @default VertexArrayObject
     * @type {String}
     */
    className: string = 'VertexArrayObject';

    /**
     * @default true
     * @type {Boolean}
     */
    isVertexArrayObject: boolean = true;

    /**
     * 顶点数量
     * @type {Number}
     * @private
     */
    private vertexCount: number | null = null;

    /**
     * 是否使用 vao
     * @type {Boolean}
     * @default false
     */
    useVao: boolean = false;

    /**
     * 是否使用 instanced
     * @type {Boolean}
     * @default false
     */
    useInstanced: boolean = false;

    /**
     * 绘图方式
     * @type {GLenum}
     * @default gl.TRIANGLES
     */
    mode: number = TRIANGLES;

    /**
     * 是否脏
     * @type {Boolean}
     * @default true
     */
    isDirty: boolean = true;

    gl: WebGLRenderingContext | null;

    id: string;

    instancedExtension: any;

    vaoExtension: any;

    vao: any;

    attributes: AttributeObject[];

    activeStates: AttributeObject[];

    indexBuffer: Buffer | null;

    indexType: number;

    private _isDestroyed: boolean = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    [key: string]: any;

    /**
     * @constructs
     * @param  {WebGLRenderingContext} gl
     * @param  {String} id  缓存id
     * @param  {Object} params
     */
    constructor(gl: WebGLRenderingContext, id: string, params: VAOParams) {
        this.gl = gl;
        this.id = id;

        this.instancedExtension = extensions.instanced;
        this.vaoExtension = extensions.vao;

        Object.assign(this, params);

        if (!this.vaoExtension) {
            this.useVao = false;
        }

        if (!this.instancedExtension) {
            this.useInstanced = false;
        }

        if (this.useVao) {
            this.vao = this.vaoExtension.createVertexArray();
        }

        this.attributes = [];
        this.activeStates = [];
        this.indexBuffer = null;
    }

    /**
     * bind
     */
    bind(): void {
        if (currentVao !== this) {
            if (this.useVao) {
                this.vaoExtension.bindVertexArray(this.vao);
            } else {
                this.bindSystemVao();
            }
            currentVao = this;
        }
    }

    /**
     * @private
     */
    private bindSystemVao(): void {
        const gl = this.gl;
        if (currentVao && currentVao.useVao) {
            currentVao.unbind();
        }
        const activeStates = this.activeStates;

        let lastBuffer: Buffer | undefined;
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
                gl!.disableVertexAttribArray(i);
            }
        });

        if (this.indexBuffer) {
            this.indexBuffer.bind();
        }
        globalStates = activeStates;
    }

    /**
     * unbind
     */
    unbind(): void {
        if (this.useVao) {
            this.vaoExtension.bindVertexArray(null);
        }
        currentVao = null;
    }

    /**
     * draw
     */
    draw(): void {
        this.bind();
        const {
            gl,
            mode
        } = this;

        if (this.indexBuffer) {
            gl!.drawElements(mode, this.vertexCount!, this.indexType, 0);
        } else {
            gl!.drawArrays(mode, 0, this.getVertexCount());
        }
    }

    /**
     * 获取顶点数量
     * @return {Number} 顶点数量
     */
    getVertexCount(): number {
        if (this.vertexCount === null) {
            const attributeObj = this.attributes[0];
            if (attributeObj) {
                this.vertexCount = attributeObj.geometryData.count;
            } else {
                this.vertexCount = 0;
            }
        }
        return this.vertexCount;
    }

    /**
     * drawInstance
     * @param  {Number} [primcount=1]
     */
    drawInstance(primcount: number = 1): void {
        this.bind();
        const {
            gl,
            mode
        } = this;
        if (this.useInstanced) {
            if (this.indexBuffer) {
                this.instancedExtension.drawElementsInstanced(mode, this.vertexCount, gl!.UNSIGNED_SHORT, 0, primcount);
            } else {
                this.instancedExtension.drawArraysInstanced(mode, 0, this.getVertexCount(), primcount);
            }
        }
    }

    /**
     * addIndexBuffer
     * @param {GeometryData} data
     * @param {GLenum} usage gl.STATIC_DRAW|gl.DYNAMIC_DRAW
     * @return {Buffer} Buffer
     */
    addIndexBuffer(geometryData: GeometryData, usage?: number): Buffer {
        this.bind();
        const gl = this.gl!;
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
    }

    /**
     * addAttribute
     * @param {GeometryData} geometryData
     * @param {Object} attribute
     * @param {GLenum} usage gl.STATIC_DRAW|gl.DYNAMIC_DRAW
     * @param {Function} onInit
     * @return {AttributeObject} attributeObject
     */
    addAttribute(geometryData: GeometryData, attribute: any, usage?: number, onInit?: (attributeObject: AttributeObject) => void): AttributeObject {
        this.bind();
        const gl = this.gl!;
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
    }

    /**
     * addInstancedAttribute
     * @param {Object} attribute
     * @param {Array} meshes
     * @param {function} getData
     * @return {AttributeObject} attributeObject
     */
    addInstancedAttribute(attribute: any, meshes: any[], getData: (mesh: any) => any): AttributeObject {
        this.bind();
        const gl = this.gl!;
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
        let geometryData: GeometryData;
        if (attributeObject) {
            geometryData = attributeObject.geometryData;
            geometryData.data = instancedData;
        } else {
            geometryData = new GeometryData(instancedData, 1);
        }

        return this.addAttribute(geometryData, attribute, gl.DYNAMIC_DRAW, (attributeObject: AttributeObject) => {
            attribute.divisor(1);
            attributeObject.useInstanced = true;
        });
    }

    /**
     * 获取资源
     * @param {Object[]} [resources=[]]
     * @return {Object[]}
     */
    getResources(resources: any[] = []): any[] {
        if (this.attributes) {
            this.attributes.forEach((attributeObject) => {
                resources.push(attributeObject.buffer);
            });
        }

        if (this.indexBuffer) {
            resources.push(this.indexBuffer);
        }

        return resources;
    }

    /**
     * 没有被引用时销毁资源
     * @param  {WebGLRenderer} renderer
     * @return {VertexArrayObject} this
     */
    destroyIfNoRef(renderer: any): VertexArrayObject {
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyIfNoRef(this);

        return this;
    }

    /**
     * 销毁资源
     * @return {VertexArrayObject} this
     */
    destroy(_gl?: WebGLRenderingContext): VertexArrayObject {
        if (this._isDestroyed) {
            return this;
        }

        this.instancedExtension = null;

        if (this.useVao) {
            this.vaoExtension.deleteVertexArray(this.vao);
            this.vao = null;
            this.vaoExtension = null;
        }
        this.gl = null;
        this.indexBuffer = null;
        this.attributes.forEach((attributeObject) => {
            const attribute = attributeObject.attribute || {};
            this[attribute.name] = null;
        });
        this.attributes = null!;
        this.activeStates = null!;
        cache.removeObject(this);

        this._isDestroyed = true;
        return this;
    }
}

export default VertexArrayObject;
