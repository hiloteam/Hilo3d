import type {
    Std140FieldDefinition,
    Std140Layout,
    Std140ScalarType,
    Std140Schema,
    Std140Type
} from '../ubo/Std140Layout';

export const WGSL_UNIFORM_BUFFER_STANDARD_LAYOUT_FEATURE =
    'uniform_buffer_standard_layout' as const;

export interface WgslUniformFieldLayout {
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

function alignTo(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function normalizeDefinition(
    definition: Std140Type | Std140FieldDefinition
): Std140FieldDefinition {
    return typeof definition === 'string' ? { type: definition } : definition;
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
    if (!matrix) throw new TypeError(`Unsupported WGSL uniform type: ${type}`);
    return {
        scalar: 'float',
        columns: Number(matrix[1]),
        rows: Number(matrix[2] ?? matrix[1])
    };
}

function vectorAlignment(rows: number): number {
    return rows === 1 ? 4 : rows === 2 ? 8 : 16;
}

/**
 * Natural WGSL uniform layout enabled by `uniform_buffer_standard_layout`.
 *
 * The source schema is shared with std140, but every offset and stride is
 * recomputed using WGSL alignment rules. Boolean host data is deliberately
 * rejected because WGSL `bool` and `vecN<bool>` are not host-shareable.
 */
export class WgslUniformLayout<Schema extends Std140Schema = Std140Schema> {
    readonly schema: Schema;
    readonly fields: Readonly<Record<keyof Schema & string, WgslUniformFieldLayout>>;
    readonly alignment: number;
    readonly byteLength: number;
    readonly std140Layout: Std140Layout<Schema>;

    constructor(std140Layout: Std140Layout<Schema>) {
        this.std140Layout = std140Layout;
        this.schema = std140Layout.schema;

        const fields: Record<string, WgslUniformFieldLayout> = {};
        let cursor = 0;
        let structAlignment = 1;
        for (const [name, rawDefinition] of Object.entries(this.schema)) {
            const definition = normalizeDefinition(rawDefinition);
            const shape = shapeOf(definition.type);
            if (shape.scalar === 'bool') {
                throw new TypeError(
                    `WGSL uniform field ${name} uses ${definition.type}; boolean values are not host-shareable`
                );
            }

            const arrayLength = definition.arrayLength ?? 1;
            const alignment = vectorAlignment(shape.rows);
            const matrixStride = shape.columns > 1 ? alignTo(shape.rows * 4, alignment) : 0;
            const elementByteLength =
                shape.columns > 1 ? matrixStride * shape.columns : shape.rows * 4;
            const isArray = definition.arrayLength !== undefined;
            const arrayStride = isArray ? alignTo(elementByteLength, alignment) : 0;
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
                matrixStride,
                componentCount: shape.columns * shape.rows
            });
            cursor += byteLength;
            structAlignment = Math.max(structAlignment, alignment);
        }

        this.fields = Object.freeze(fields);
        this.alignment = structAlignment;
        this.byteLength = alignTo(cursor, structAlignment);
    }

    /** Convert packed std140 bytes into this layout without changing scalar bit patterns. */
    transcode(std140Buffer: ArrayBuffer): ArrayBuffer {
        if (std140Buffer.byteLength < this.std140Layout.byteLength) {
            throw new RangeError(
                `std140 source is ${String(std140Buffer.byteLength)} bytes; layout requires ${String(this.std140Layout.byteLength)}`
            );
        }

        const source = new DataView(std140Buffer);
        const targetBuffer = new ArrayBuffer(this.byteLength);
        const target = new DataView(targetBuffer);
        const sourceFields = this.std140Layout.fields as Readonly<
            Record<string, (typeof this.std140Layout.fields)[keyof Schema & string]>
        >;

        for (const field of Object.values(this.fields)) {
            const sourceField = sourceFields[field.name];
            if (!sourceField) {
                throw new Error(`std140 layout is missing WGSL uniform field ${field.name}`);
            }
            const shape = shapeOf(field.type);
            for (let arrayIndex = 0; arrayIndex < field.arrayLength; arrayIndex++) {
                const sourceArrayOffset =
                    sourceField.offset +
                    (sourceField.arrayStride === 0 ? 0 : arrayIndex * sourceField.arrayStride);
                const targetArrayOffset =
                    field.offset + (field.arrayStride === 0 ? 0 : arrayIndex * field.arrayStride);
                for (let column = 0; column < shape.columns; column++) {
                    const sourceColumnOffset =
                        sourceArrayOffset +
                        (sourceField.matrixStride === 0 ? 0 : column * sourceField.matrixStride);
                    const targetColumnOffset =
                        targetArrayOffset +
                        (field.matrixStride === 0 ? 0 : column * field.matrixStride);
                    for (let row = 0; row < shape.rows; row++) {
                        const sourceOffset = sourceColumnOffset + row * 4;
                        const targetOffset = targetColumnOffset + row * 4;
                        target.setUint32(targetOffset, source.getUint32(sourceOffset, true), true);
                    }
                }
            }
        }
        return targetBuffer;
    }
}

export function createWgslUniformLayout<const Schema extends Std140Schema>(
    std140Layout: Std140Layout<Schema>
): WgslUniformLayout<Schema> {
    return new WgslUniformLayout(std140Layout);
}
