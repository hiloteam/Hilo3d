/** Scalar WGSL storage-address-space types supported by {@link StorageLayout}. */
export type StorageScalarType = 'f32' | 'i32' | 'u32' | 'atomic<i32>' | 'atomic<u32>';

/** Two-, three-, and four-component WGSL storage vector types. */
export type StorageVectorType =
    | 'vec2<f32>'
    | 'vec3<f32>'
    | 'vec4<f32>'
    | 'vec2<i32>'
    | 'vec3<i32>'
    | 'vec4<i32>'
    | 'vec2<u32>'
    | 'vec3<u32>'
    | 'vec4<u32>';

/** Column-major floating-point WGSL storage matrix types. */
export type StorageMatrixType =
    | 'mat2x2<f32>'
    | 'mat2x3<f32>'
    | 'mat2x4<f32>'
    | 'mat3x2<f32>'
    | 'mat3x3<f32>'
    | 'mat3x4<f32>'
    | 'mat4x2<f32>'
    | 'mat4x3<f32>'
    | 'mat4x4<f32>';

/** Primitive value that can appear directly in a storage schema. */
export type StoragePrimitiveType = StorageScalarType | StorageVectorType | StorageMatrixType;

/** Fixed-length array definition using WGSL storage alignment and stride rules. */
export interface StorageArrayDefinition<Element extends StorageType = StorageType> {
    /** Array discriminator. */
    readonly type: 'array';
    /** Element definition. */
    readonly element: Element;
    /** Positive CPU-known element count. */
    readonly length: number;
}

/** Nested structure definition using WGSL storage alignment rules. */
export interface StorageStructDefinition<Fields extends StorageSchema = StorageSchema> {
    /** Structure discriminator. */
    readonly type: 'struct';
    /** Ordered field schema. JavaScript property insertion order defines member order. */
    readonly fields: Fields;
}

/** Primitive, fixed array, or nested structure accepted by a storage schema. */
export type StorageType = StoragePrimitiveType | StorageArrayDefinition | StorageStructDefinition;

/** Ordered named fields compiled into one host-shareable storage structure. */
export type StorageSchema = Readonly<Record<string, StorageType>>;

/** JavaScript value shape for one primitive storage type. */
export type StoragePrimitiveValue<Type extends StoragePrimitiveType> =
    Type extends StorageScalarType ? number : ArrayLike<number>;

/** JavaScript value shape inferred recursively from a storage definition. */
export type StorageValue<Definition> = Definition extends StoragePrimitiveType
    ? StoragePrimitiveValue<Definition>
    : Definition extends StorageArrayDefinition<infer Element>
      ? Element extends StorageScalarType
          ? ArrayLike<number>
          : readonly StorageValue<Element>[]
      : Definition extends StorageStructDefinition<infer Fields>
        ? StorageValues<Fields>
        : never;

/** JavaScript object shape inferred from all fields in a {@link StorageSchema}. */
export type StorageValues<Schema extends StorageSchema> = {
    readonly [Name in keyof Schema]: StorageValue<Schema[Name]>;
};

/** Caller-reusable result describing bytes changed by one typed write. */
export interface StorageWriteResult {
    /** First changed byte, or the field offset when no bytes changed. */
    byteOffset: number;
    /** Number of changed bytes; zero means the packed value was already equal. */
    byteLength: number;
}

/** Compiled offset, size, and alignment for one top-level schema field. */
export interface StorageFieldLayout {
    /** Schema field name. */
    readonly name: string;
    /** Field byte offset from the start of the structure. */
    readonly offset: number;
    /** WGSL field size in bytes, excluding following member padding. */
    readonly byteLength: number;
    /** Required WGSL byte alignment. */
    readonly alignment: number;
    /** Immutable snapshot of the source definition. */
    readonly type: StorageType;
}

type ScalarKind = 'f32' | 'i32' | 'u32';

interface ScalarNode {
    readonly kind: 'scalar';
    readonly scalar: ScalarKind;
    readonly atomic: boolean;
    readonly alignment: 4;
    readonly byteLength: 4;
}

interface VectorNode {
    readonly kind: 'vector';
    readonly scalar: ScalarKind;
    readonly componentCount: 2 | 3 | 4;
    readonly alignment: 8 | 16;
    readonly byteLength: 8 | 12 | 16;
}

interface MatrixNode {
    readonly kind: 'matrix';
    readonly columns: 2 | 3 | 4;
    readonly rows: 2 | 3 | 4;
    readonly matrixStride: 8 | 16;
    readonly alignment: 8 | 16;
    readonly byteLength: number;
}

interface ArrayNode {
    readonly kind: 'array';
    readonly element: StorageNode;
    readonly length: number;
    readonly arrayStride: number;
    readonly alignment: number;
    readonly byteLength: number;
}

interface StructMemberNode {
    readonly name: string;
    readonly offset: number;
    readonly node: StorageNode;
}

interface StructNode {
    readonly kind: 'struct';
    readonly members: readonly StructMemberNode[];
    readonly alignment: number;
    readonly byteLength: number;
}

type StorageNode = ScalarNode | VectorNode | MatrixNode | ArrayNode | StructNode;

interface MutableDirtyRange {
    start: number;
    end: number;
}

function snapshotStorageType(definition: unknown, path: string): StorageType {
    if (typeof definition === 'string') {
        // Compile now so malformed primitive spellings fail before the public snapshot is stored.
        primitiveNode(definition, path);
        return definition as StoragePrimitiveType;
    }
    if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
        throw new TypeError(`${path} requires a WGSL host-shareable storage type`);
    }
    const record = definition as Readonly<Record<string, unknown>>;
    if (record['type'] === 'array') {
        const length = record['length'];
        if (!Number.isSafeInteger(length) || (length as number) < 1) {
            throw new RangeError(`${path} has an invalid array length`);
        }
        return Object.freeze({
            type: 'array',
            element: snapshotStorageType(record['element'], `${path}[]`),
            length: length as number
        });
    }
    if (record['type'] === 'struct') {
        return Object.freeze({
            type: 'struct',
            fields: snapshotStorageSchema(record['fields'], path)
        });
    }
    throw new TypeError(`${path} requires an array or struct storage definition`);
}

function snapshotStorageSchema(value: unknown, path: string): StorageSchema {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`${path} must be a storage schema object`);
    }
    const source = value as Readonly<Record<string, unknown>>;
    const names = Object.keys(source);
    if (names.length === 0) throw new TypeError(`${path} must contain at least one field`);
    const snapshot: Record<string, StorageType> = {};
    for (const name of names) {
        if (name.length === 0) throw new TypeError(`${path} contains an empty field name`);
        snapshot[name] = snapshotStorageType(source[name], `${path}.${name}`);
    }
    return Object.freeze(snapshot);
}

function alignTo(value: number, alignment: number): number {
    const result = Math.ceil(value / alignment) * alignment;
    if (!Number.isSafeInteger(result)) {
        throw new RangeError('Storage layout size exceeds the safe integer range');
    }
    return result;
}

function requireSafeProduct(left: number, right: number, path: string): number {
    const result = left * right;
    if (!Number.isSafeInteger(result)) {
        throw new RangeError(`${path} size exceeds the safe integer range`);
    }
    return result;
}

function primitiveNode(type: string, path: string): StorageNode {
    const scalar = /^(f32|i32|u32)$/.exec(type);
    const atomic = /^atomic<(i32|u32)>$/.exec(type);
    if (scalar !== null || atomic !== null) {
        const scalarKind = (scalar?.[1] ?? atomic?.[1]) as ScalarKind;
        return Object.freeze({
            kind: 'scalar',
            scalar: scalarKind,
            atomic: atomic !== null,
            alignment: 4,
            byteLength: 4
        });
    }

    const vector = /^vec([2-4])<(f32|i32|u32)>$/.exec(type);
    if (vector !== null) {
        const componentCount = Number(vector[1]) as 2 | 3 | 4;
        const scalarKind = vector[2] as ScalarKind;
        return Object.freeze({
            kind: 'vector',
            scalar: scalarKind,
            componentCount,
            alignment: componentCount === 2 ? 8 : 16,
            byteLength: (componentCount * 4) as 8 | 12 | 16
        });
    }

    const matrix = /^mat([2-4])x([2-4])<f32>$/.exec(type);
    if (matrix !== null) {
        const columns = Number(matrix[1]) as 2 | 3 | 4;
        const rows = Number(matrix[2]) as 2 | 3 | 4;
        const alignment = rows === 2 ? 8 : 16;
        const matrixStride = alignment;
        return Object.freeze({
            kind: 'matrix',
            columns,
            rows,
            matrixStride,
            alignment,
            byteLength: requireSafeProduct(matrixStride, columns, path)
        });
    }

    throw new TypeError(`${path} has an unsupported WGSL storage type ${type}`);
}

function compileStruct(schema: StorageSchema, path: string): StructNode {
    const entries = Object.entries(schema);
    if (entries.length === 0) throw new TypeError(`${path} must contain at least one field`);
    const members: StructMemberNode[] = [];
    let cursor = 0;
    let alignment = 1;
    for (const [name, definition] of entries) {
        if (name.length === 0) throw new TypeError(`${path} contains an empty field name`);
        const node = compileNode(definition, `${path}.${name}`);
        cursor = alignTo(cursor, node.alignment);
        members.push(Object.freeze({ name, offset: cursor, node }));
        cursor += node.byteLength;
        if (!Number.isSafeInteger(cursor)) {
            throw new RangeError(`${path} size exceeds the safe integer range`);
        }
        alignment = Math.max(alignment, node.alignment);
    }
    return Object.freeze({
        kind: 'struct',
        members: Object.freeze(members),
        alignment,
        byteLength: alignTo(cursor, alignment)
    });
}

function compileNode(definition: StorageType, path: string): StorageNode {
    if (typeof definition === 'string') return primitiveNode(definition, path);
    if (definition.type === 'struct') return compileStruct(definition.fields, path);
    if (!Number.isSafeInteger(definition.length) || definition.length < 1) {
        throw new RangeError(`${path} has an invalid array length`);
    }
    const element = compileNode(definition.element, `${path}[]`);
    const arrayStride = alignTo(element.byteLength, element.alignment);
    return Object.freeze({
        kind: 'array',
        element,
        length: definition.length,
        arrayStride,
        alignment: element.alignment,
        byteLength: requireSafeProduct(arrayStride, definition.length, path)
    });
}

function lookupOwn<Value>(
    record: Readonly<Record<string, Value>>,
    name: string
): Value | undefined {
    return Object.prototype.hasOwnProperty.call(record, name) ? record[name] : undefined;
}

function requireArrayLike(value: unknown, length: number, path: string): ArrayLike<unknown> {
    if (
        (typeof value !== 'object' && typeof value !== 'function') ||
        value === null ||
        typeof Reflect.get(value, 'length') !== 'number'
    ) {
        throw new TypeError(`${path} requires ${String(length)} values`);
    }
    const values = value as ArrayLike<unknown>;
    if (values.length !== length) {
        throw new RangeError(`${path} requires ${String(length)} values`);
    }
    return values;
}

function requireStructValue(value: unknown, path: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null) {
        throw new TypeError(`${path} requires a struct value`);
    }
    return value as Readonly<Record<string, unknown>>;
}

function writeScalar(
    view: DataView,
    offset: number,
    scalar: ScalarKind,
    value: unknown,
    dirty: MutableDirtyRange,
    path: string
): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${path} requires a finite number`);
    }
    let changed = false;
    if (scalar === 'f32') {
        const packed = Math.fround(value);
        if (!Object.is(view.getFloat32(offset, true), packed)) {
            view.setFloat32(offset, packed, true);
            changed = true;
        }
    } else if (scalar === 'u32') {
        if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
            throw new RangeError(`${path} requires an unsigned 32-bit integer`);
        }
        if (view.getUint32(offset, true) !== value) {
            view.setUint32(offset, value, true);
            changed = true;
        }
    } else {
        if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
            throw new RangeError(`${path} requires a signed 32-bit integer`);
        }
        if (view.getInt32(offset, true) !== value) {
            view.setInt32(offset, value, true);
            changed = true;
        }
    }
    if (!changed) return;
    if (offset < dirty.start) dirty.start = offset;
    if (offset + 4 > dirty.end) dirty.end = offset + 4;
}

function writeNode(
    view: DataView,
    baseOffset: number,
    node: StorageNode,
    value: unknown,
    dirty: MutableDirtyRange,
    path: string
): void {
    if (node.kind === 'scalar') {
        writeScalar(view, baseOffset, node.scalar, value, dirty, path);
        return;
    }
    if (node.kind === 'vector') {
        const values = requireArrayLike(value, node.componentCount, path);
        for (let index = 0; index < node.componentCount; index += 1) {
            writeScalar(
                view,
                baseOffset + index * 4,
                node.scalar,
                values[index],
                dirty,
                `${path}[${String(index)}]`
            );
        }
        return;
    }
    if (node.kind === 'matrix') {
        const componentCount = node.columns * node.rows;
        const values = requireArrayLike(value, componentCount, path);
        let valueIndex = 0;
        for (let column = 0; column < node.columns; column += 1) {
            for (let row = 0; row < node.rows; row += 1) {
                writeScalar(
                    view,
                    baseOffset + column * node.matrixStride + row * 4,
                    'f32',
                    values[valueIndex],
                    dirty,
                    `${path}[${String(valueIndex)}]`
                );
                valueIndex += 1;
            }
        }
        return;
    }
    if (node.kind === 'array') {
        const values = requireArrayLike(value, node.length, path);
        for (let index = 0; index < node.length; index += 1) {
            writeNode(
                view,
                baseOffset + index * node.arrayStride,
                node.element,
                values[index],
                dirty,
                `${path}[${String(index)}]`
            );
        }
        return;
    }
    const values = requireStructValue(value, path);
    for (const member of node.members) {
        const memberValue = values[member.name];
        if (memberValue === undefined) {
            throw new TypeError(`${path}.${member.name} is required`);
        }
        writeNode(
            view,
            baseOffset + member.offset,
            member.node,
            memberValue,
            dirty,
            `${path}.${member.name}`
        );
    }
}

/** Immutable WGSL host-shareable layout for storage-address-space data. */
export class StorageLayout<Schema extends StorageSchema = StorageSchema> {
    /** Deep immutable snapshot of the source schema. */
    readonly schema: Schema;
    /** Compiled top-level field metadata keyed by schema name. */
    readonly fields: Readonly<Record<keyof Schema & string, StorageFieldLayout>>;
    /** Total padded structure size in bytes. */
    readonly byteLength: number;
    /** Required alignment of the complete structure. */
    readonly alignment: number;
    readonly #nodes: Readonly<Record<keyof Schema & string, StorageNode>>;
    readonly #targetViews = new WeakMap<ArrayBuffer, DataView>();
    readonly #dirty: MutableDirtyRange = { start: 0, end: 0 };

    /** Compile and snapshot one ordered storage schema. */
    constructor(schema: Schema) {
        const snapshot = snapshotStorageSchema(schema, 'storage') as Schema;
        this.schema = snapshot;
        const root = compileStruct(snapshot, 'storage');
        const fields: Record<string, StorageFieldLayout> = {};
        const nodes: Record<string, StorageNode> = {};
        for (const member of root.members) {
            const definition = snapshot[member.name];
            if (definition === undefined) {
                throw new Error(`Storage layout field ${member.name} lost its schema definition`);
            }
            fields[member.name] = Object.freeze({
                name: member.name,
                offset: member.offset,
                byteLength: member.node.byteLength,
                alignment: member.node.alignment,
                type: definition
            });
            nodes[member.name] = member.node;
        }
        this.fields = Object.freeze(fields);
        this.#nodes = Object.freeze(nodes);
        this.byteLength = root.byteLength;
        this.alignment = root.alignment;
    }

    /** Pack one top-level field and return the changed byte span. */
    write<Name extends keyof Schema & string>(
        target: ArrayBuffer,
        name: Name,
        value: StorageValue<Schema[Name]>
    ): StorageWriteResult {
        return this.writeInto(target, name, value, { byteOffset: 0, byteLength: 0 });
    }

    /** Pack one field into caller-owned result storage to avoid a result allocation. */
    writeInto<Name extends keyof Schema & string>(
        target: ArrayBuffer,
        name: Name,
        value: StorageValue<Schema[Name]>,
        result: StorageWriteResult
    ): StorageWriteResult {
        if (!(target instanceof ArrayBuffer)) {
            throw new TypeError('Storage layout target must be an ArrayBuffer');
        }
        if (target.byteLength < this.byteLength) {
            throw new RangeError(
                `Storage target is ${String(target.byteLength)} bytes; layout requires ${String(this.byteLength)}`
            );
        }
        const field = lookupOwn(this.fields, name);
        const node = lookupOwn(this.#nodes, name);
        if (field === undefined || node === undefined) {
            throw new TypeError(`Unknown storage field ${name}`);
        }
        let view = this.#targetViews.get(target);
        if (view === undefined) {
            view = new DataView(target);
            this.#targetViews.set(target, view);
        }
        this.#dirty.start = target.byteLength;
        this.#dirty.end = 0;
        writeNode(view, field.offset, node, value, this.#dirty, `storage.${name}`);
        result.byteOffset = this.#dirty.end > this.#dirty.start ? this.#dirty.start : field.offset;
        result.byteLength =
            this.#dirty.end > this.#dirty.start ? this.#dirty.end - this.#dirty.start : 0;
        return result;
    }

    /** Allocate a zero-filled structure and optionally pack a subset of fields. */
    createBuffer(values: Partial<StorageValues<Schema>> = {}): ArrayBuffer {
        const buffer = new ArrayBuffer(this.byteLength);
        for (const name of Object.keys(values) as (keyof Schema & string)[]) {
            const value = values[name];
            if (value !== undefined) this.write(buffer, name, value);
        }
        return buffer;
    }
}

/** Compile an immutable, type-inferred WGSL storage-address-space layout. */
export function createStorageLayout<const Schema extends StorageSchema>(
    schema: Schema
): StorageLayout<Schema> {
    return new StorageLayout(schema);
}
