import extensions from './extensions';
import Buffer from './Buffer';
import GeometryData, { type GeometryComponentSize } from '../geometry/GeometryData';
import bufferUtil from '../utils/bufferUtil';
import Cache from '../utils/Cache';
import { TRIANGLES } from '../constants/webgl';
import type Mesh from '../core/Mesh';
import type WebGLResourceManager from './WebGLResourceManager';
import type { ManagedResource } from './WebGLResourceManager';
import type { ProgramAttribute } from './Program';
import type { GLContext } from './types';
import type { InstancedArraysExtension } from './extensions/InstancedArraysExtension';
import type { VertexArrayObjectExtension } from './extensions/VertexArrayObjectExtension';

export interface VertexArrayObjectParameters {
    useVao?: boolean;
    useInstanced?: boolean;
    mode?: GLenum;
    vertexCount?: number | null;
}

export interface AttributeObject {
    attribute: ProgramAttribute;
    buffer: Buffer;
    geometryData: GeometryData;
    useInstanced: boolean;
}

export interface VaoRenderer {
    resourceManager: WebGLResourceManager;
}

let globalStates: (AttributeObject | undefined)[] = [];
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

    static reset(_gl?: GLContext): void {
        currentVao = null;
        globalStates = [];
        this.bindSystemVao();
        cache.each(vao => vao.destroy());
    }

    static bindSystemVao(): void {
        extensions.vao?.bindVertexArray(null);
        currentVao = null;
    }

    readonly className = 'VertexArrayObject';
    readonly isVertexArrayObject = true;
    readonly id: string;
    readonly gl: GLContext;
    useVao = false;
    useInstanced = false;
    mode: GLenum = TRIANGLES;
    isDirty = true;
    vertexCount: number | null = null;
    indexType: GLenum;

    private readonly instancedExtension: InstancedArraysExtension | null;
    private readonly vaoExtension: VertexArrayObjectExtension | null;
    private vao: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null = null;
    private readonly attributes: AttributeObject[] = [];
    private readonly attributesByName = new Map<string, AttributeObject>();
    private readonly activeStates: (AttributeObject | undefined)[] = [];
    private indexBuffer: Buffer | null = null;
    private _isDestroyed = false;

    constructor(gl: GLContext, id: string, params: VertexArrayObjectParameters = {}) {
        this.gl = gl;
        this.id = id;
        this.instancedExtension = extensions.instanced;
        this.vaoExtension = extensions.vao;
        this.indexType = gl.UNSIGNED_SHORT;
        Object.assign(this, params);
        if (!this.vaoExtension) this.useVao = false;
        if (!this.instancedExtension) this.useInstanced = false;
        if (this.useVao) this.vao = this.vaoExtension?.createVertexArray() ?? null;
    }

    bind(): void {
        if (currentVao === this) return;
        if (this.useVao && this.vaoExtension) this.vaoExtension.bindVertexArray(this.vao);
        else this.bindSystemVao();
        setCurrentVao(this);
    }

    private bindSystemVao(): void {
        if (currentVao?.useVao) currentVao.unbind();
        let lastBuffer: Buffer | null = null;
        for (const attributeObject of this.attributes) {
            const { buffer, attribute, geometryData } = attributeObject;
            if (lastBuffer !== buffer) {
                lastBuffer = buffer;
                buffer.bind();
            }
            attribute.enable();
            attribute.pointer(geometryData);
            attribute.divisor(attributeObject.useInstanced ? 1 : 0);
        }
        globalStates.forEach((globalAttribute, index) => {
            if (globalAttribute && !this.activeStates[index]) {
                globalAttribute.attribute.divisor(0);
                this.gl.disableVertexAttribArray(index);
            }
        });
        this.indexBuffer?.bind();
        globalStates = [...this.activeStates];
    }

    unbind(): void {
        if (this.useVao) this.vaoExtension?.bindVertexArray(null);
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
        if (!this.useInstanced || !this.instancedExtension) return;
        if (this.indexBuffer) {
            this.instancedExtension.drawElementsInstanced(
                this.mode,
                this.getVertexCount(),
                this.indexType,
                0,
                primcount
            );
        } else {
            this.instancedExtension.drawArraysInstanced(
                this.mode,
                0,
                this.getVertexCount(),
                primcount
            );
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
            attributeObject = { attribute, buffer, geometryData, useInstanced: false };
            this.attributes.push(attributeObject);
            this.attributesByName.set(attribute.name, attributeObject);
            attribute.addTo(this.activeStates, attributeObject);
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
        return this.addAttribute(geometryData, attribute, this.gl.DYNAMIC_DRAW, attributeObject => {
            attribute.divisor(1);
            attributeObject.useInstanced = true;
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
        if (this.useVao) this.vaoExtension?.deleteVertexArray(this.vao);
        this.vao = null;
        this.indexBuffer = null;
        this.attributes.length = 0;
        this.attributesByName.clear();
        this.activeStates.length = 0;
        cache.removeObject(this);
        this._isDestroyed = true;
        return this;
    }
}

export default VertexArrayObject;
