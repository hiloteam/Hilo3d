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
    readonly sliceCount: number;
    readonly requestedUpdateCount: number;
    readonly scheduledUpdateCount: number;
    readonly deferredUpdateCount: number;
    readonly cadenceDeferredCount: number;
    readonly mandatoryUpdateCount: number;
    /** Number of mandatory updates above the configured soft budget. */
    readonly budgetOverflowCount: number;
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
 * cascades use progressively slower default cadences of 1/2/4/8 frames.
 */
export class ShadowAtlasUpdateScheduler {
    readonly maxUpdatesPerFrame: number;
    readonly cascadeIntervals: readonly number[];
    readonly #scheduledSlices: boolean[] = [];
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
        const state = this.#state;
        this.#schedule = Object.freeze({
            scheduledSlices: this.#scheduledSlices,
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
        frameIndex: number
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

        const count = content.sliceCount;
        this.#scheduledSlices.length = count;
        this.#scheduledSlices.fill(false);
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

        let remaining = Math.max(0, this.maxUpdatesPerFrame - scheduled);
        while (remaining > 0) {
            let selected = -1;
            let selectedPriority = -Infinity;
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
                if (priority > selectedPriority) {
                    selected = index;
                    selectedPriority = priority;
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
}
