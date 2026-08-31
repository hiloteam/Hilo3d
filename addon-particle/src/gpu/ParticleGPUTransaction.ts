export interface ParticleGPUCommittedState {
    readonly clockSeconds: number;
    readonly spawnSequence: number;
    readonly revision: number;
    readonly sourceIndex: 0 | 1;
}

export interface ParticleGPUStagedState extends ParticleGPUCommittedState {
    readonly deltaSeconds: number;
    readonly spawnCount: number;
}

export interface ParticleGPURecoverySnapshot extends ParticleGPUCommittedState {
    readonly seed: number;
    readonly definitionHash: string;
}

/**
 * Submission transaction for double-buffered GPU particle state.
 *
 * Graph setup/prepare calls {@link stage}; only the renderer's successful submission path calls
 * {@link commit}. Validation, encoding, or submission failure calls {@link rollback}, leaving the
 * committed clock, sequence, revision, and source buffer unchanged.
 * @internal
 */
export class ParticleGPUTransaction {
    readonly seed: number;
    readonly definitionHash: string;
    #committed: ParticleGPUCommittedState;
    #staged: ParticleGPUStagedState | null = null;

    constructor(seed: number, definitionHash: string) {
        if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
            throw new RangeError('Particle GPU recovery seed must be an unsigned 32-bit integer');
        }
        if (definitionHash.length === 0) {
            throw new TypeError('Particle GPU recovery definition hash must not be empty');
        }
        this.seed = seed >>> 0;
        this.definitionHash = definitionHash;
        this.#committed = Object.freeze({
            clockSeconds: 0,
            spawnSequence: 0,
            revision: 0,
            sourceIndex: 0
        });
    }

    get committed(): Readonly<ParticleGPUCommittedState> {
        return this.#committed;
    }

    get staged(): Readonly<ParticleGPUStagedState> | null {
        return this.#staged;
    }

    stage(deltaSeconds: number, spawnCount: number): Readonly<ParticleGPUStagedState> {
        if (this.#staged !== null) {
            throw new Error('Particle GPU state already has an uncommitted frame');
        }
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
            throw new RangeError('Particle GPU staged delta must be finite and non-negative');
        }
        if (!Number.isSafeInteger(spawnCount) || spawnCount < 0) {
            throw new RangeError('Particle GPU staged spawn count must be non-negative');
        }
        this.#staged = Object.freeze({
            clockSeconds: Math.fround(this.#committed.clockSeconds + deltaSeconds),
            spawnSequence: (this.#committed.spawnSequence + spawnCount) >>> 0,
            revision: this.#committed.revision + 1,
            sourceIndex: this.#committed.sourceIndex === 0 ? 1 : 0,
            deltaSeconds: Math.fround(deltaSeconds),
            spawnCount
        });
        return this.#staged;
    }

    commit(): Readonly<ParticleGPUCommittedState> {
        const staged = this.#staged;
        if (staged === null) throw new Error('Particle GPU state has no staged frame to commit');
        this.#committed = Object.freeze({
            clockSeconds: staged.clockSeconds,
            spawnSequence: staged.spawnSequence,
            revision: staged.revision,
            sourceIndex: staged.sourceIndex
        });
        this.#staged = null;
        return this.#committed;
    }

    rollback(): Readonly<ParticleGPUCommittedState> {
        this.#staged = null;
        return this.#committed;
    }

    /** Reset the committed deterministic clock before an explicit restart or device rebuild. */
    restart(): Readonly<ParticleGPUCommittedState> {
        this.#staged = null;
        this.#committed = Object.freeze({
            clockSeconds: 0,
            spawnSequence: 0,
            revision: 0,
            sourceIndex: 0
        });
        return this.#committed;
    }

    recoverySnapshot(): Readonly<ParticleGPURecoverySnapshot> {
        return Object.freeze({
            ...this.#committed,
            seed: this.seed,
            definitionHash: this.definitionHash
        });
    }

    restore(snapshot: Readonly<ParticleGPURecoverySnapshot>): void {
        if (snapshot.seed !== this.seed || snapshot.definitionHash !== this.definitionHash) {
            throw new TypeError('Particle GPU recovery snapshot belongs to another runtime');
        }
        if (this.#staged !== null) {
            throw new Error('Particle GPU recovery cannot replace an uncommitted frame');
        }
        this.#committed = Object.freeze({
            clockSeconds: snapshot.clockSeconds,
            spawnSequence: snapshot.spawnSequence,
            revision: snapshot.revision,
            sourceIndex: snapshot.sourceIndex
        });
    }
}
