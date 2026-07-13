import Buffer from './Buffer';
import GeometryData, { type GeometryComponentSize } from '../geometry/GeometryData';
import bufferUtil from '../utils/bufferUtil';
import Cache from '../utils/Cache';
import { TRIANGLES } from '../constants/webgl';
import requireGLResource from './requireGLResource';
import type Mesh from '../core/Mesh';
import type WebGLResourceManager from './WebGLResourceManager';
import type { ManagedResource } from './WebGLResourceManager';
import type { ProgramAttribute } from './Program';
import type { GLContext } from './types';

export interface VertexArrayObjectParameters {
    useInstanced?: boolean;
    mode?: GLenum;
    vertexCount?: number | null;
}

export interface AttributeObject {
    attribute: ProgramAttribute;
    buffer: Buffer;
    geometryData: GeometryData;
}

export interface VaoRenderer {
    resourceManager: WebGLResourceManager;
}

let currentVao: VertexArrayObject | null = null;
const cache = new Cache<VertexArrayObject>();

function geometryComponentSize(size: number): GeometryComponentSize {
    switch (size) {
        case 1:
            return 1;
        case 2:
            return 2;
        case 3:
            return 3;
        case 4:
            return 4;
        case 16:
            return 16;
        default:
            throw new RangeError(`Unsupported instanced attribute size: ${String(size)}`);
    }
}

function setCurrentVao(vao: VertexArrayObject | null): void {
    currentVao = vao;
}

class VertexArrayObject implements ManagedResource {
    static get cache(): Cache<VertexArrayObject> {
        return cache;
    }

    static getVao(
        gl: GLContext,
        id: string,
        params: VertexArrayObjectParameters = {}
    ): VertexArrayObject {
        let vao = cache.get(id);
        if (!vao) {
            vao = new VertexArrayObject(gl, id, params);
            cache.add(id, vao);
        } else if (params.mode !== undefined && params.mode !== vao.mode) {
            vao.mode = params.mode;
        }
        return vao;
    }

    static reset(gl: GLContext): void {
        currentVao = null;
        gl.bindVertexArray(null);
        cache.each(vao => vao.destroy());
    }

    readonly className = 'VertexArrayObject';
    readonly isVertexArrayObject = true;
    readonly id: string;
    readonly gl: GLContext;
    useInstanced = false;
    mode: GLenum = TRIANGLES;
    isDirty = true;
    vertexCount: number | null = null;
    indexType: GLenum;

    private vao: WebGLVertexArrayObject | null;
    private readonly attributes: AttributeObject[] = [];
    private readonly attributesByName = new Map<string, AttributeObject>();
    private indexBuffer: Buffer | null = null;
    private _isDestroyed = false;

    constructor(gl: GLContext, id: string, params: VertexArrayObjectParameters = {}) {
        this.gl = gl;
        this.id = id;
        this.indexType = gl.UNSIGNED_SHORT;
        Object.assign(this, params);
        this.vao = requireGLResource(this.gl.createVertexArray(), 'a vertex array object');
    }

    bind(): void {
        if (currentVao === this) return;
        this.gl.bindVertexArray(this.vao);
        setCurrentVao(this);
    }

    unbind(): void {
        this.gl.bindVertexArray(null);
        currentVao = null;
    }

    draw(): void {
        this.bind();
        if (this.indexBuffer)
            this.gl.drawElements(this.mode, this.getVertexCount(), this.indexType, 0);
        else this.gl.drawArrays(this.mode, 0, this.getVertexCount());
    }

    getVertexCount(): number {
        this.vertexCount ??= this.attributes[0]?.geometryData.count ?? 0;
        return this.vertexCount;
    }

    drawInstance(primcount = 1): void {
        this.bind();
        if (!this.useInstanced) return;
        if (this.indexBuffer) {
            this.gl.drawElementsInstanced(
                this.mode,
                this.getVertexCount(),
                this.indexType,
                0,
                primcount
            );
        } else {
            this.gl.drawArraysInstanced(this.mode, 0, this.getVertexCount(), primcount);
        }
    }

    addIndexBuffer(geometryData: GeometryData, usage: GLenum): Buffer {
        this.bind();
        this.indexType = geometryData.type;
        if (!this.indexBuffer) {
            this.indexBuffer = Buffer.createIndexBuffer(this.gl, geometryData, usage);
            this.indexBuffer.bind();
            this.vertexCount = geometryData.length;
        } else if (geometryData.isDirty) {
            this.indexBuffer.uploadGeometryData(geometryData);
            this.vertexCount = geometryData.length;
        }
        return this.indexBuffer;
    }

    addAttribute(
        geometryData: GeometryData,
        attribute: ProgramAttribute,
        usage: GLenum,
        onInit?: (attributeObject: AttributeObject) => void
    ): AttributeObject {
        this.bind();
        let attributeObject = this.attributesByName.get(attribute.name);
        if (!attributeObject) {
            const buffer = Buffer.createVertexBuffer(this.gl, geometryData, usage);
            buffer.bind();
            attribute.enable();
            attribute.pointer(geometryData);
            attributeObject = { attribute, buffer, geometryData };
            this.attributes.push(attributeObject);
            this.attributesByName.set(attribute.name, attributeObject);
            onInit?.(attributeObject);
        }
        if (geometryData.isDirty) {
            attributeObject.buffer.bind();
            attribute.enable();
            attribute.pointer(geometryData);
            attributeObject.buffer.uploadGeometryData(geometryData);
        }
        return attributeObject;
    }

    addInstancedAttribute(
        attribute: ProgramAttribute,
        meshes: readonly Mesh[],
        getData: (mesh: Mesh) => ArrayLike<number> | undefined
    ): AttributeObject {
        this.bind();
        const instancedData = bufferUtil.getTypedArray(
            Float32Array,
            meshes.length * attribute.glTypeInfo.size
        );
        meshes.forEach((mesh, index) => {
            const data = getData(mesh);
            if (data)
                bufferUtil.fillArrayData(instancedData, data, index * attribute.glTypeInfo.size);
            else
                throw new Error(
                    `Mesh ${mesh.name || mesh.id} has no data for instanced attribute ${attribute.name}`
                );
        });

        const existing = this.attributesByName.get(attribute.name);
        let geometryData: GeometryData;
        if (existing) {
            geometryData = existing.geometryData;
            geometryData.data = instancedData;
        } else {
            geometryData = new GeometryData(
                instancedData,
                geometryComponentSize(attribute.glTypeInfo.size)
            );
        }
        return this.addAttribute(geometryData, attribute, this.gl.DYNAMIC_DRAW, () => {
            attribute.divisor(1);
        });
    }

    getResources(resources: ManagedResource[] = []): ManagedResource[] {
        for (const attributeObject of this.attributes) resources.push(attributeObject.buffer);
        if (this.indexBuffer) resources.push(this.indexBuffer);
        return resources;
    }

    destroyIfNoRef(renderer: VaoRenderer): this {
        renderer.resourceManager.destroyIfNoRef(this);
        return this;
    }

    destroy(): this {
        if (this._isDestroyed) return this;
        this.gl.deleteVertexArray(this.vao);
        this.vao = null;
        this.indexBuffer = null;
        this.attributes.length = 0;
        this.attributesByName.clear();
        cache.removeObject(this);
        this._isDestroyed = true;
        return this;
    }
}

export default VertexArrayObject;
