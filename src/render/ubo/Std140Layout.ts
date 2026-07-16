export type Std140ScalarType = 'float' | 'int' | 'uint' | 'bool';
export type Std140VectorType =
    | 'vec2'
    | 'vec3'
    | 'vec4'
    | 'ivec2'
    | 'ivec3'
    | 'ivec4'
    | 'uvec2'
    | 'uvec3'
    | 'uvec4'
    | 'bvec2'
    | 'bvec3'
    | 'bvec4';
export type Std140MatrixType =
    'mat2' | 'mat3' | 'mat4' | 'mat2x3' | 'mat2x4' | 'mat3x2' | 'mat3x4' | 'mat4x2' | 'mat4x3';
export type Std140Type = Std140ScalarType | Std140VectorType | Std140MatrixType;

export interface Std140FieldDefinition {
    type: Std140Type;
    arrayLength?: number;
}

export type Std140Schema = Readonly<Record<string, Std140Type | Std140FieldDefinition>>;
export type Std140ArrayValue = ArrayLike<number | boolean>;
export type Std140Value = number | boolean | Std140ArrayValue;
export type Std140FieldValue<Definition> = Definition extends { readonly arrayLength: number }
    ? Std140ArrayValue
    : Definition extends { readonly type: infer Type }
      ? Std140FieldValue<Type>
      : Definition extends 'bool'
        ? boolean
        : Definition extends Std140ScalarType
          ? number
          : Std140ArrayValue;
export type Std140Values<Schema extends Std140Schema> = {
    [Name in keyof Schema]: Std140FieldValue<Schema[Name]>;
};

export interface Std140FieldLayout {
    readonly name: string;
    readonly type: Std140Type;
    readonly offset: number;
    readonly byteLength: number;
    readonly alignment: number;
    readonly arrayLength: number;
    readonly arrayStride: number;
    readonly matrixStride: number;
    readonly componentCount: number;
}

interface TypeShape {
    scalar: Std140ScalarType;
    columns: number;
    rows: number;
}

/** @internal Caller-owned scratch result for allocation-free renderer writes. */
export interface Std140WriteResult {
    byteOffset: number;
    byteLength: number;
}

function alignTo(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function isScalarValue(value: Std140Value): value is number | boolean {
    return typeof value === 'number' || typeof value === 'boolean';
}

function shapeOf(type: Std140Type): TypeShape {
    if (type === 'float' || type === 'int' || type === 'uint' || type === 'bool') {
        return { scalar: type, columns: 1, rows: 1 };
    }
    const vector = /^(i|u|b)?vec([2-4])$/.exec(type);
    if (vector) {
        const prefix = vector[1] ?? '';
        const scalar: Std140ScalarType =
            prefix === 'i' ? 'int' : prefix === 'u' ? 'uint' : prefix === 'b' ? 'bool' : 'float';
        return { scalar, columns: 1, rows: Number(vector[2]) };
    }
    const matrix = /^mat([2-4])(?:x([2-4]))?$/.exec(type);
    if (!matrix) throw new TypeError(`Unsupported std140 type: ${type}`);
    return {
        scalar: 'float',
        columns: Number(matrix[1]),
        rows: Number(matrix[2] ?? matrix[1])
    };
}

function normalizeDefinition(definition: unknown, fieldName: string): Std140FieldDefinition {
    if (typeof definition === 'string') {
        const type = definition as Std140Type;
        shapeOf(type);
        return { type };
    }
    if (
        typeof definition !== 'object' ||
        definition === null ||
        typeof Reflect.get(definition, 'type') !== 'string'
    ) {
        throw new TypeError(
            `std140 field ${fieldName} requires a scalar, vector or matrix type; nested structs are not part of the portable schema`
        );
    }
    return definition as Std140FieldDefinition;
}

/** Immutable std140 byte layout and value packer for a GLSL uniform block. */
export class Std140Layout<Schema extends Std140Schema = Std140Schema> {
    readonly schema: Schema;
    readonly fields: Readonly<Record<keyof Schema & string, Std140FieldLayout>>;
    readonly byteLength: number;
    readonly #fieldShapes: Readonly<Record<keyof Schema & string, Readonly<TypeShape>>>;
    readonly #targetViews = new WeakMap<ArrayBuffer, DataView>();

    constructor(schema: Schema) {
        this.schema = schema;
        const fields: Record<string, Std140FieldLayout> = {};
        const fieldShapes: Record<string, Readonly<TypeShape>> = {};
        let cursor = 0;
        for (const [name, rawDefinition] of Object.entries(schema)) {
            const definition = normalizeDefinition(rawDefinition, name);
            const arrayLength = definition.arrayLength ?? 1;
            if (!Number.isSafeInteger(arrayLength) || arrayLength < 1) {
                throw new RangeError(`std140 field ${name} has an invalid array length`);
            }
            const shape = shapeOf(definition.type);
            fieldShapes[name] = Object.freeze(shape);
            const isMatrix = shape.columns > 1;
            const vectorAlignment = shape.rows === 1 ? 4 : shape.rows === 2 ? 8 : 16;
            const elementAlignment = isMatrix ? 16 : vectorAlignment;
            const elementByteLength = isMatrix ? shape.columns * 16 : shape.rows * 4;
            const isArray = definition.arrayLength !== undefined;
            const alignment = isArray ? Math.max(16, elementAlignment) : elementAlignment;
            const arrayStride = isArray ? alignTo(elementByteLength, 16) : 0;
            const byteLength = isArray ? arrayStride * arrayLength : elementByteLength;
            cursor = alignTo(cursor, alignment);
            fields[name] = Object.freeze({
                name,
                type: definition.type,
                offset: cursor,
                byteLength,
                alignment,
                arrayLength,
                arrayStride,
                matrixStride: isMatrix ? 16 : 0,
                componentCount: shape.columns * shape.rows
            });
            cursor += byteLength;
        }
        this.fields = Object.freeze(fields);
        this.#fieldShapes = Object.freeze(fieldShapes);
        this.byteLength = alignTo(cursor, 16);
    }

    /** Pack one field and return the smallest changed byte interval, or a zero-length no-op. */
    write<Name extends keyof Schema & string>(
        target: ArrayBuffer,
        name: Name,
        value: Std140FieldValue<Schema[Name]>
    ): { byteOffset: number; byteLength: number } {
        return this.writeInto(target, name, value, { byteOffset: 0, byteLength: 0 });
    }

    /**
     * Allocation-free variant for renderer hot paths. The caller owns and may reuse `result`;
     * its fields are overwritten before this method returns.
     *
     * @internal
     */
    writeInto<Name extends keyof Schema & string>(
        target: ArrayBuffer,
        name: Name,
        value: Std140FieldValue<Schema[Name]>,
        result: { byteOffset: number; byteLength: number }
    ): { byteOffset: number; byteLength: number } {
        const field = this.fields[name];
        if (target.byteLength < this.byteLength) {
            throw new RangeError(
                `std140 target is ${String(target.byteLength)} bytes; layout requires ${String(this.byteLength)}`
            );
        }
        const shape = this.#fieldShapes[name];
        const fieldValue: Std140Value = value;
        const scalarValue = isScalarValue(fieldValue);
        const values = scalarValue ? null : fieldValue;
        const expected = field.componentCount * field.arrayLength;
        const valueLength = scalarValue ? 1 : (values?.length ?? 0);
        if (valueLength !== expected) {
            throw new RangeError(`std140 field ${name} requires ${String(expected)} values`);
        }
        let view = this.#targetViews.get(target);
        if (view === undefined) {
            view = new DataView(target);
            this.#targetViews.set(target, view);
        }
        let valueIndex = 0;
        let dirtyStart = target.byteLength;
        let dirtyEnd = 0;
        for (let arrayIndex = 0; arrayIndex < field.arrayLength; arrayIndex++) {
            const arrayOffset =
                field.offset + (field.arrayStride === 0 ? 0 : arrayIndex * field.arrayStride);
            for (let column = 0; column < shape.columns; column++) {
                const columnOffset =
                    arrayOffset + (field.matrixStride === 0 ? 0 : column * field.matrixStride);
                for (let row = 0; row < shape.rows; row++) {
                    const item = scalarValue ? fieldValue : values?.[valueIndex];
                    valueIndex++;
                    const offset = columnOffset + row * 4;
                    if (shape.scalar === 'bool') {
                        if (typeof item !== 'boolean' && typeof item !== 'number') {
                            throw new TypeError(`std140 field ${name} requires boolean values`);
                        }
                        const packed = Number(Boolean(item));
                        if (view.getInt32(offset, true) !== packed) {
                            view.setInt32(offset, packed, true);
                            if (offset < dirtyStart) dirtyStart = offset;
                            if (offset + 4 > dirtyEnd) dirtyEnd = offset + 4;
                        }
                    } else {
                        if (typeof item !== 'number' || !Number.isFinite(item)) {
                            throw new TypeError(`std140 field ${name} requires finite numbers`);
                        }
                        if (shape.scalar !== 'float' && !Number.isInteger(item)) {
                            throw new TypeError(`std140 field ${name} requires integer values`);
                        }
                        if (shape.scalar === 'uint' && item < 0) {
                            throw new RangeError(`std140 field ${name} requires unsigned values`);
                        }
                        if (shape.scalar === 'float') {
                            const packed = Math.fround(item);
                            if (view.getFloat32(offset, true) !== packed) {
                                view.setFloat32(offset, packed, true);
                                if (offset < dirtyStart) dirtyStart = offset;
                                if (offset + 4 > dirtyEnd) dirtyEnd = offset + 4;
                            }
                        } else if (shape.scalar === 'uint') {
                            if (view.getUint32(offset, true) !== item) {
                                view.setUint32(offset, item, true);
                                if (offset < dirtyStart) dirtyStart = offset;
                                if (offset + 4 > dirtyEnd) dirtyEnd = offset + 4;
                            }
                        } else if (view.getInt32(offset, true) !== item) {
                            view.setInt32(offset, item, true);
                            if (offset < dirtyStart) dirtyStart = offset;
                            if (offset + 4 > dirtyEnd) dirtyEnd = offset + 4;
                        }
                    }
                }
            }
        }
        result.byteOffset = dirtyEnd > dirtyStart ? dirtyStart : field.offset;
        result.byteLength = dirtyEnd > dirtyStart ? dirtyEnd - dirtyStart : 0;
        return result;
    }

    createBuffer(values: Partial<Std140Values<Schema>> = {}): ArrayBuffer {
        const buffer = new ArrayBuffer(this.byteLength);
        for (const [name, value] of Object.entries(values)) {
            if (value !== undefined) {
                this.write(buffer, name, value);
            }
        }
        return buffer;
    }
}

export function createStd140Layout<const Schema extends Std140Schema>(
    schema: Schema
): Std140Layout<Schema> {
    return new Std140Layout(schema);
}
