import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import type { ShadowAtlasContentDecision } from './ShadowAtlasContentCache';
import type { ShadowAtlasScenePlan, ShadowAtlasSceneSlice } from './ShadowAtlasSceneAdapter';

export interface ShadowAtlasUpdateSchedulerOptions {
    /** Soft per-frame slice update budget. Mandatory allocation/layout/light updates may exceed it. */
    readonly maxUpdatesPerFrame?: number;
    /** Directional-cascade update intervals, in frames, ordered from near to far. */
    readonly cascadeIntervals?: readonly number[];
}

export interface ShadowAtlasUpdateSchedule {
    /** Reused physical-index mask. It remains valid only until the next `schedule` call. */
    readonly scheduledSlices: readonly boolean[];
    /** Allocation/layout/light updates plus at most one overdue caster slice per view. */
    readonly mandatorySlices: readonly boolean[];
    readonly sliceCount: number;
    readonly requestedUpdateCount: number;
    readonly scheduledUpdateCount: number;
    readonly deferredUpdateCount: number;
    readonly cadenceDeferredCount: number;
    readonly mandatoryUpdateCount: number;
    /** Number of mandatory updates above the configured soft budget. */
    readonly budgetOverflowCount: number;
}

interface SliceUpdateHistory {
    committedFrame: number;
    pendingFrame: number;
    pendingEpoch: number;
}

interface MutableScheduleState {
    sliceCount: number;
    requestedUpdateCount: number;
    scheduledUpdateCount: number;
    deferredUpdateCount: number;
    cadenceDeferredCount: number;
    mandatoryUpdateCount: number;
    budgetOverflowCount: number;
}

const DEFAULT_CASCADE_INTERVALS: readonly number[] = Object.freeze([1, 2, 4, 8]);

function positiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
    return value;
}

function updatePriority(slice: Readonly<ShadowAtlasSceneSlice>): number {
    const area = slice.viewport.width * slice.viewport.height;
    if (slice.kind === 'directional') {
        return 3_000_000_000 - (slice.cascade ?? 0) * 1_000_000 + area;
    }
    if (slice.kind === 'spot') return 2_000_000_000 + area;
    return 1_000_000_000 + area;
}

/**
 * Deterministic receiver-priority shadow update scheduler. It keeps allocation, layout, and light
 * changes mandatory, while caster-only invalidations may be spread across frames. Directional
 * cascades use progressively slower default cadences of 1/2/4/8 frames. Eligible caster updates
 * are oldest-successful-submission first, with receiver priority breaking ties.
 */
export class ShadowAtlasUpdateScheduler implements RHIUploadBatchParticipant {
    readonly #histories = new WeakMap<object, SliceUpdateHistory[]>();
    readonly #sliceHistories: SliceUpdateHistory[] = [];
    readonly #pendingHistories = new Set<SliceUpdateHistory>();
    #epoch = 0;
    #active = false;
    #frameIndex = 0;
    readonly maxUpdatesPerFrame: number;
    readonly cascadeIntervals: readonly number[];
    readonly #scheduledSlices: boolean[] = [];
    readonly #mandatorySlices: boolean[] = [];
    readonly #maximumDeferral: number;
    readonly #state: MutableScheduleState = {
        sliceCount: 0,
        requestedUpdateCount: 0,
        scheduledUpdateCount: 0,
        deferredUpdateCount: 0,
        cadenceDeferredCount: 0,
        mandatoryUpdateCount: 0,
        budgetOverflowCount: 0
    };
    readonly #schedule: Readonly<ShadowAtlasUpdateSchedule>;

    constructor(options: Readonly<ShadowAtlasUpdateSchedulerOptions> = {}) {
        this.maxUpdatesPerFrame = positiveSafeInteger(
            options.maxUpdatesPerFrame ?? 8,
            'Shadow maxUpdatesPerFrame'
        );
        const intervals = options.cascadeIntervals ?? DEFAULT_CASCADE_INTERVALS;
        this.cascadeIntervals = Object.freeze(
            Array.from(intervals, (value, index) =>
                positiveSafeInteger(value, `Shadow cascadeIntervals[${String(index)}]`)
            )
        );
        if (this.cascadeIntervals.length === 0) {
            throw new RangeError('Shadow cascadeIntervals must not be empty');
        }
        this.#maximumDeferral = Math.max(8, ...this.cascadeIntervals);
        const state = this.#state;
        this.#schedule = Object.freeze({
            scheduledSlices: this.#scheduledSlices,
            mandatorySlices: this.#mandatorySlices,
            get sliceCount() {
                return state.sliceCount;
            },
            get requestedUpdateCount() {
                return state.requestedUpdateCount;
            },
            get scheduledUpdateCount() {
                return state.scheduledUpdateCount;
            },
            get deferredUpdateCount() {
                return state.deferredUpdateCount;
            },
            get cadenceDeferredCount() {
                return state.cadenceDeferredCount;
            },
            get mandatoryUpdateCount() {
                return state.mandatoryUpdateCount;
            },
            get budgetOverflowCount() {
                return state.budgetOverflowCount;
            }
        });
    }

    schedule(
        plan: Readonly<ShadowAtlasScenePlan>,
        content: Readonly<ShadowAtlasContentDecision>,
        frameIndex: number,
        uploads: RHIUploadBatch
    ): Readonly<ShadowAtlasUpdateSchedule> {
        if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
            throw new RangeError(
                'Shadow scheduling frameIndex must be a non-negative safe integer'
            );
        }
        if (
            content.sliceCount !== plan.slices.length ||
            content.dirtySlices.length !== content.sliceCount ||
            content.reasons.length !== content.sliceCount
        ) {
            throw new TypeError(
                'Shadow update scheduling requires matching dense plan and content'
            );
        }

        if (!this.#active) {
            if (!Number.isSafeInteger(this.#epoch + 1))
                throw new RangeError('Shadow scheduling epoch is exhausted');
            this.#epoch++;
            this.#active = true;
        }
        uploads.enlist(this);
        this.#frameIndex = frameIndex;
        this.#sliceHistories.length = 0;
        for (const slice of plan.slices) {
            let histories = this.#histories.get(slice.light);
            if (histories === undefined) {
                histories = [];
                this.#histories.set(slice.light, histories);
            }
            const subIndex = slice.cascade ?? slice.face ?? 0;
            let history = histories[subIndex];
            if (history === undefined) {
                history = { committedFrame: -1, pendingFrame: -1, pendingEpoch: 0 };
                histories[subIndex] = history;
            }
            this.#sliceHistories.push(history);
        }
        const count = content.sliceCount;
        this.#scheduledSlices.length = count;
        this.#scheduledSlices.fill(false);
        this.#mandatorySlices.length = count;
        this.#mandatorySlices.fill(false);
        let requested = 0;
        let scheduled = 0;
        let mandatory = 0;
        let cadenceDeferred = 0;

        for (let index = 0; index < count; index += 1) {
            if (content.dirtySlices[index] !== true) continue;
            requested++;
            const reason = content.reasons[index];
            if (reason === 'allocation' || reason === 'layout' || reason === 'light') {
                this.#scheduledSlices[index] = true;
                this.#mandatorySlices[index] = true;
                mandatory++;
                scheduled++;
                continue;
            }
            const slice = plan.slices[index];
            if (slice?.kind !== 'directional') continue;
            const cascade = slice.cascade ?? 0;
            const interval =
                this.cascadeIntervals[Math.min(cascade, this.cascadeIntervals.length - 1)] ?? 1;
            if (frameIndex % interval !== 0) cadenceDeferred++;
        }

        // Mandatory camera/light work can consume both budgets indefinitely. Reserve one
        // overdue caster slice across both scheduling layers, even above their soft limits.
        let overdue = -1;
        let oldest = Infinity;
        let overduePriority = -Infinity;
        for (let index = 0; index < count; index++) {
            if (!content.dirtySlices[index] || this.#scheduledSlices[index]) continue;
            const slice = plan.slices[index];
            if (slice === undefined) continue;
            const interval =
                slice.kind === 'directional'
                    ? (this.cascadeIntervals[
                          Math.min(slice.cascade ?? 0, this.cascadeIntervals.length - 1)
                      ] ?? 1)
                    : 1;
            if (frameIndex % interval !== 0) continue;
            const lastUpdate = this.lastUpdateAt(index);
            const priority = updatePriority(slice);
            if (
                frameIndex - lastUpdate >= this.#maximumDeferral &&
                (lastUpdate < oldest || (lastUpdate === oldest && priority > overduePriority))
            ) {
                overdue = index;
                oldest = lastUpdate;
                overduePriority = priority;
            }
        }
        if (overdue >= 0) {
            this.#scheduledSlices[overdue] = true;
            this.#mandatorySlices[overdue] = true;
            mandatory++;
            scheduled++;
        }

        let remaining = Math.max(0, this.maxUpdatesPerFrame - scheduled);
        while (remaining > 0) {
            let selected = -1;
            let selectedPriority = -Infinity;
            let selectedFrame = Infinity;
            for (let index = 0; index < count; index += 1) {
                if (content.dirtySlices[index] !== true || this.#scheduledSlices[index] === true) {
                    continue;
                }
                const slice = plan.slices[index];
                if (slice === undefined) continue;
                if (slice.kind === 'directional') {
                    const cascade = slice.cascade ?? 0;
                    const interval =
                        this.cascadeIntervals[
                            Math.min(cascade, this.cascadeIntervals.length - 1)
                        ] ?? 1;
                    if (frameIndex % interval !== 0) continue;
                }
                const priority = updatePriority(slice);
                const lastUpdate = this.lastUpdateAt(index);
                if (
                    lastUpdate < selectedFrame ||
                    (lastUpdate === selectedFrame && priority > selectedPriority)
                ) {
                    selected = index;
                    selectedPriority = priority;
                    selectedFrame = lastUpdate;
                }
            }
            if (selected < 0) break;
            this.#scheduledSlices[selected] = true;
            scheduled++;
            remaining--;
        }

        this.#state.sliceCount = count;
        this.#state.requestedUpdateCount = requested;
        this.#state.scheduledUpdateCount = scheduled;
        this.#state.deferredUpdateCount = requested - scheduled;
        this.#state.cadenceDeferredCount = cadenceDeferred;
        this.#state.mandatoryUpdateCount = mandatory;
        this.#state.budgetOverflowCount = Math.max(0, mandatory - this.maxUpdatesPerFrame);
        return this.#schedule;
    }

    private lastUpdateAt(index: number): number {
        const history = this.#sliceHistories[index];
        if (history === undefined) throw new Error('Shadow scheduling history is missing');
        return history.pendingEpoch === this.#epoch ? history.pendingFrame : history.committedFrame;
    }

    /** Credit only complete page updates; failed submissions must not consume scheduling turns. */
    complete(completedSlices: readonly boolean[]): void {
        if (!this.#active || completedSlices.length !== this.#sliceHistories.length) {
            throw new Error('Shadow scheduling completion requires matching staged slices');
        }
        for (let index = 0; index < completedSlices.length; index++) {
            if (!completedSlices[index] || !this.#scheduledSlices[index]) continue;
            const history = this.#sliceHistories[index];
            if (history === undefined) throw new Error('Shadow scheduling history is missing');
            history.pendingFrame = this.#frameIndex;
            history.pendingEpoch = this.#epoch;
            this.#pendingHistories.add(history);
        }
    }

    prepareCommit(): void {
        if (!this.#active) throw new Error('Shadow scheduler has no active transaction');
    }

    commit(): void {
        for (const history of this.#pendingHistories) history.committedFrame = history.pendingFrame;
        this.rollback();
    }

    rollback(): void {
        this.#pendingHistories.clear();
        this.#sliceHistories.length = 0;
        this.#active = false;
    }
}
