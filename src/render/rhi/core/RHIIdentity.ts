/**
 * Backend-independent identity allocation shared by every concrete RHI implementation.
 *
 * A device ID is globally unique within this JavaScript realm. Object IDs are intentionally local
 * to one device and form a unique identity together with `deviceId`.
 *
 * @internal
 */

const FIRST_RHI_ID = 1;

function assertPositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < FIRST_RHI_ID) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
}

class RHISequentialIdAllocator {
    #nextId: number | null;

    constructor(
        private readonly scope: string,
        firstId = FIRST_RHI_ID
    ) {
        assertPositiveSafeInteger(firstId, `${scope} first ID`);
        this.#nextId = firstId;
    }

    allocate(): number {
        const id = this.#nextId;
        if (id === null) {
            throw new RangeError(`${this.scope} ID space is exhausted`);
        }
        this.#nextId = id === Number.MAX_SAFE_INTEGER ? null : id + 1;
        return id;
    }
}

const deviceIds = new RHISequentialIdAllocator('RHI device');

/** Allocate one ID from the single namespace shared by all RHI backends. */
export function allocateRHIDeviceId(): number {
    return deviceIds.allocate();
}

/** Device-local allocator used for every object owned by one logical RHI device. */
export class RHIObjectIdAllocator {
    readonly deviceId: number;
    readonly #ids: RHISequentialIdAllocator;

    constructor(deviceId: number, firstObjectId = FIRST_RHI_ID) {
        assertPositiveSafeInteger(deviceId, 'RHI device ID');
        this.deviceId = deviceId;
        this.#ids = new RHISequentialIdAllocator(
            `RHI object for device ${String(deviceId)}`,
            firstObjectId
        );
    }

    allocate(): number {
        return this.#ids.allocate();
    }
}

/** Create the one persistent object-ID allocator owned by a concrete device. */
export function createRHIObjectIdAllocator(deviceId: number): RHIObjectIdAllocator {
    return new RHIObjectIdAllocator(deviceId);
}
