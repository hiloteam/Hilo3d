import type Mesh from '../core/Mesh';

const MAX_PICKING_ID = 0xffffff;

export interface MeshPickingIdentity {
    readonly id: number;
    readonly color: Float32Array;
}

let nextPickingId = 1;
const identities = new WeakMap<Mesh, MeshPickingIdentity>();

/** Returns one stable 24-bit GPU-picking identity for the lifetime of a mesh. */
export function getMeshPickingIdentity(mesh: Mesh): MeshPickingIdentity {
    const existing = identities.get(mesh);
    if (existing) return existing;
    if (nextPickingId > MAX_PICKING_ID) {
        throw new RangeError('GPU picking exhausted the 24-bit object identity space.');
    }

    const id = nextPickingId++;
    const identity = Object.freeze({
        id,
        color: new Float32Array([
            ((id >>> 16) & 0xff) / 0xff,
            ((id >>> 8) & 0xff) / 0xff,
            (id & 0xff) / 0xff,
            1
        ])
    });
    identities.set(mesh, identity);
    return identity;
}

/** Decodes the RGB portion of one rgba8unorm picking texel. Zero is the clear/background ID. */
export function decodeMeshPickingId(data: Uint8Array, offset = 0): number {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 2 >= data.length) {
        throw new RangeError('Picking texel offset must address at least three bytes.');
    }
    const red = data.at(offset);
    const green = data.at(offset + 1);
    const blue = data.at(offset + 2);
    if (red === undefined || green === undefined || blue === undefined) {
        throw new RangeError('Picking texel offset must address at least three bytes.');
    }
    return (red << 16) | (green << 8) | blue;
}
