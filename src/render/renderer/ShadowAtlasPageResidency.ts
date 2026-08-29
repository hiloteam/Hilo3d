import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import type { RHISubmission } from '../rhi/core';
import type { ShadowAtlasContentDecision } from './ShadowAtlasContentCache';
import type { ShadowAtlasScenePlan } from './ShadowAtlasSceneAdapter';

export interface ShadowAtlasPageRegion {
    readonly slicePhysicalIndex: number;
    readonly pageX: number;
    readonly pageY: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface ShadowAtlasPageResidencyDecision {
    /** Reused page update list. It remains valid only until the next `stage` call. */
    readonly updateRegions: readonly Readonly<ShadowAtlasPageRegion>[];
    /** Dirty slices whose complete desired revision will be resident after this submission. */
    readonly completedSlices: readonly boolean[];
    readonly requestedPageCount: number;
    readonly scheduledPageCount: number;
    readonly deferredPageCount: number;
    readonly residentPageCount: number;
    readonly mandatoryPageCount: number;
    readonly budgetOverflowCount: number;
}

interface MutablePageRegion {
    slicePhysicalIndex: number;
    pageX: number;
    pageY: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface PageRecord {
    committedUpdateId: number;
    pendingUpdateId: number;
    pendingEpoch: number;
}

interface SliceRecord {
    x: number;
    y: number;
    width: number;
    height: number;
    columns: number;
    rows: number;
    readonly pages: PageRecord[];
    committedCursor: number;
    pendingCursor: number;
    pendingCursorEpoch: number;
}

interface MutableDecisionState {
    requestedPageCount: number;
    scheduledPageCount: number;
    deferredPageCount: number;
    residentPageCount: number;
    mandatoryPageCount: number;
    budgetOverflowCount: number;
}

function positiveSafeInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
    return value;
}

function createSliceRecord(): SliceRecord {
    return {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        columns: 0,
        rows: 0,
        pages: [],
        committedCursor: 0,
        pendingCursor: 0,
        pendingCursorEpoch: 0
    };
}

/**
 * Submission-aware fixed-atlas virtual-page residency for shadow updates. Receiver-driven slice
 * sizing determines the requested virtual grid; dirty pages are redrawn with page scissoring and
 * committed only after a valid RHI submission. Missing pages retain the previous slice contents.
 */
export class ShadowAtlasPageResidency implements RHIUploadBatchParticipant {
    readonly pageSize: number;
    readonly maxPageUpdatesPerFrame: number;
    readonly #slices: SliceRecord[] = [];
    readonly #regions: MutablePageRegion[] = [];
    readonly #completedSlices: boolean[] = [];
    readonly #remainingPages: number[] = [];
    readonly #state: MutableDecisionState = {
        requestedPageCount: 0,
        scheduledPageCount: 0,
        deferredPageCount: 0,
        residentPageCount: 0,
        mandatoryPageCount: 0,
        budgetOverflowCount: 0
    };
    readonly #decision: Readonly<ShadowAtlasPageResidencyDecision>;
    #regionCount = 0;
    #activeSliceCount = 0;
    #committedSliceCursor = 0;
    #pendingSliceCursor = 0;
    #pendingSliceCursorEpoch = 0;
    #transactionEpoch = 0;
    #transactionActive = false;
    #destroyed = false;

    constructor(
        options: { readonly pageSize?: number; readonly maxPageUpdatesPerFrame?: number } = {}
    ) {
        this.pageSize = positiveSafeInteger(options.pageSize ?? 128, 'Shadow pageSize');
        this.maxPageUpdatesPerFrame = positiveSafeInteger(
            options.maxPageUpdatesPerFrame ?? 32,
            'Shadow maxPageUpdatesPerFrame'
        );
        const state = this.#state;
        this.#decision = Object.freeze({
            updateRegions: this.#regions,
            completedSlices: this.#completedSlices,
            get requestedPageCount() {
                return state.requestedPageCount;
            },
            get scheduledPageCount() {
                return state.scheduledPageCount;
            },
            get deferredPageCount() {
                return state.deferredPageCount;
            },
            get residentPageCount() {
                return state.residentPageCount;
            },
            get mandatoryPageCount() {
                return state.mandatoryPageCount;
            },
            get budgetOverflowCount() {
                return state.budgetOverflowCount;
            }
        });
    }

    stage(
        plan: Readonly<ShadowAtlasScenePlan>,
        content: Readonly<ShadowAtlasContentDecision>,
        scheduledSlices: readonly boolean[],
        uploads: RHIUploadBatch
    ): Readonly<ShadowAtlasPageResidencyDecision> {
        this.assertAlive();
        const sliceCount = plan.slices.length;
        if (
            content.sliceCount !== sliceCount ||
            content.updateIds.length !== sliceCount ||
            scheduledSlices.length !== sliceCount
        ) {
            throw new TypeError('Shadow page residency requires matching dense slice inputs');
        }
        this.beginTransaction(uploads);
        this.#activeSliceCount = sliceCount;
        this.#regionCount = 0;
        this.#completedSlices.length = sliceCount;
        this.#completedSlices.fill(false);
        let requested = 0;
        let scheduled = 0;
        let mandatory = 0;
        let budgetRemaining = this.maxPageUpdatesPerFrame;
        this.#remainingPages.length = sliceCount;
        this.#remainingPages.fill(0);

        for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex += 1) {
            if (content.dirtySlices[sliceIndex] !== true || scheduledSlices[sliceIndex] !== true) {
                continue;
            }
            const slice = plan.slices[sliceIndex];
            const targetUpdateId = content.updateIds[sliceIndex] ?? 0;
            if (slice === undefined || targetUpdateId === 0) {
                throw new Error('Dirty shadow pages require a slice and non-zero update revision');
            }
            const record = this.sliceAt(sliceIndex);
            this.configureSlice(record, slice.viewport);
            const reason = content.reasons[sliceIndex];
            const forceComplete =
                reason === 'allocation' || reason === 'layout' || reason === 'light';
            const pageCount = record.columns * record.rows;
            let missing = 0;
            for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
                const page = record.pages[pageIndex];
                if (page === undefined) throw new Error('Shadow page storage is incomplete');
                if (!this.pageMatchesTarget(page, targetUpdateId)) missing++;
            }
            requested += missing;
            this.#remainingPages[sliceIndex] = missing;
            this.#completedSlices[sliceIndex] = missing === 0;
            if (!forceComplete) continue;
            while ((this.#remainingPages[sliceIndex] ?? 0) > 0) {
                if (!this.scheduleNextPage(sliceIndex, targetUpdateId, record)) {
                    throw new Error('Mandatory shadow page scheduling made no progress');
                }
                this.#remainingPages[sliceIndex] = (this.#remainingPages[sliceIndex] ?? 0) - 1;
                mandatory++;
                scheduled++;
                if (budgetRemaining > 0) budgetRemaining--;
            }
            this.#completedSlices[sliceIndex] = true;
        }

        let sliceCursor =
            this.#pendingSliceCursorEpoch === this.#transactionEpoch
                ? this.#pendingSliceCursor
                : this.#committedSliceCursor;
        while (budgetRemaining > 0 && sliceCount > 0) {
            let selectedSlice = -1;
            for (let offset = 0; offset < sliceCount; offset += 1) {
                const candidate = (sliceCursor + offset) % sliceCount;
                if (
                    (this.#remainingPages[candidate] ?? 0) > 0 &&
                    content.dirtySlices[candidate] === true &&
                    scheduledSlices[candidate] === true
                ) {
                    selectedSlice = candidate;
                    break;
                }
            }
            if (selectedSlice < 0) break;
            const slice = plan.slices[selectedSlice];
            const record = this.#slices[selectedSlice];
            const targetUpdateId = content.updateIds[selectedSlice] ?? 0;
            if (
                slice === undefined ||
                record === undefined ||
                targetUpdateId === 0 ||
                !this.scheduleNextPage(selectedSlice, targetUpdateId, record)
            ) {
                throw new Error('Budgeted shadow page scheduling made no progress');
            }
            this.#remainingPages[selectedSlice] = (this.#remainingPages[selectedSlice] ?? 0) - 1;
            this.#completedSlices[selectedSlice] = this.#remainingPages[selectedSlice] === 0;
            scheduled++;
            budgetRemaining--;
            sliceCursor = (selectedSlice + 1) % sliceCount;
            this.#pendingSliceCursor = sliceCursor;
            this.#pendingSliceCursorEpoch = this.#transactionEpoch;
        }
        this.#regions.length = this.#regionCount;
        this.#state.requestedPageCount = requested;
        this.#state.scheduledPageCount = scheduled;
        this.#state.deferredPageCount = requested - scheduled;
        this.#state.mandatoryPageCount = mandatory;
        this.#state.budgetOverflowCount = Math.max(0, scheduled - this.maxPageUpdatesPerFrame);
        this.#state.residentPageCount = this.residentPageCount();
        return this.#decision;
    }

    stageEmpty(uploads: RHIUploadBatch): void {
        this.assertAlive();
        this.beginTransaction(uploads);
        this.#activeSliceCount = 0;
        this.#regionCount = 0;
        this.#regions.length = 0;
        this.#completedSlices.length = 0;
        this.#remainingPages.length = 0;
        this.#state.requestedPageCount = 0;
        this.#state.scheduledPageCount = 0;
        this.#state.deferredPageCount = 0;
        this.#state.mandatoryPageCount = 0;
        this.#state.budgetOverflowCount = 0;
    }

    invalidateAll(): void {
        this.assertAlive();
        this.rollback();
        for (const slice of this.#slices) {
            for (const page of slice.pages) page.committedUpdateId = 0;
        }
        this.#state.residentPageCount = 0;
    }

    prepareCommit(_submission: RHISubmission): void {
        this.assertAlive();
        if (!this.#transactionActive) {
            throw new Error('Shadow page residency has no staged transaction to commit');
        }
    }

    commit(_submission: RHISubmission): void {
        if (!this.#transactionActive) return;
        for (let sliceIndex = 0; sliceIndex < this.#activeSliceCount; sliceIndex += 1) {
            const slice = this.#slices[sliceIndex];
            if (slice === undefined) continue;
            for (const page of slice.pages) {
                if (page.pendingEpoch !== this.#transactionEpoch) continue;
                page.committedUpdateId = page.pendingUpdateId;
            }
            if (slice.pendingCursorEpoch === this.#transactionEpoch) {
                slice.committedCursor = slice.pendingCursor;
            }
        }
        for (
            let sliceIndex = this.#activeSliceCount;
            sliceIndex < this.#slices.length;
            sliceIndex += 1
        ) {
            const slice = this.#slices[sliceIndex];
            if (slice === undefined) continue;
            for (const page of slice.pages) page.committedUpdateId = 0;
            slice.committedCursor = 0;
        }
        if (this.#pendingSliceCursorEpoch === this.#transactionEpoch) {
            this.#committedSliceCursor = this.#pendingSliceCursor;
        }
        this.#state.residentPageCount = this.residentPageCount();
        this.#transactionActive = false;
    }

    rollback(): void {
        this.#transactionActive = false;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.rollback();
        this.#slices.length = 0;
        this.#regions.length = 0;
        this.#completedSlices.length = 0;
        this.#remainingPages.length = 0;
        this.#destroyed = true;
    }

    private beginTransaction(uploads: RHIUploadBatch): void {
        if (!this.#transactionActive) {
            if (!Number.isSafeInteger(this.#transactionEpoch + 1)) {
                throw new RangeError('Shadow page residency transaction space is exhausted');
            }
            this.#transactionEpoch++;
            this.#transactionActive = true;
        }
        uploads.enlist(this);
    }

    private sliceAt(index: number): SliceRecord {
        let record = this.#slices[index];
        if (record === undefined) {
            record = createSliceRecord();
            this.#slices[index] = record;
        }
        return record;
    }

    private configureSlice(
        record: SliceRecord,
        viewport: Readonly<{ x: number; y: number; width: number; height: number }>
    ): void {
        const columns = Math.ceil(viewport.width / this.pageSize);
        const rows = Math.ceil(viewport.height / this.pageSize);
        record.x = viewport.x;
        record.y = viewport.y;
        record.width = viewport.width;
        record.height = viewport.height;
        record.columns = columns;
        record.rows = rows;
        const pageCount = columns * rows;
        while (record.pages.length < pageCount) {
            record.pages.push({ committedUpdateId: 0, pendingUpdateId: 0, pendingEpoch: 0 });
        }
        if (pageCount > 0) record.committedCursor %= pageCount;
    }

    private pageMatchesTarget(page: Readonly<PageRecord>, targetUpdateId: number): boolean {
        return (
            page.committedUpdateId === targetUpdateId ||
            (page.pendingEpoch === this.#transactionEpoch &&
                page.pendingUpdateId === targetUpdateId)
        );
    }

    private scheduleNextPage(
        slicePhysicalIndex: number,
        targetUpdateId: number,
        slice: SliceRecord
    ): boolean {
        const pageCount = slice.columns * slice.rows;
        if (pageCount === 0) return false;
        const start =
            slice.pendingCursorEpoch === this.#transactionEpoch
                ? slice.pendingCursor % pageCount
                : slice.committedCursor % pageCount;
        for (let offset = 0; offset < pageCount; offset += 1) {
            const pageIndex = (start + offset) % pageCount;
            const page = slice.pages[pageIndex];
            if (page === undefined) throw new Error('Shadow page storage is incomplete');
            if (this.pageMatchesTarget(page, targetUpdateId)) continue;
            page.pendingUpdateId = targetUpdateId;
            page.pendingEpoch = this.#transactionEpoch;
            slice.pendingCursor = (pageIndex + 1) % pageCount;
            slice.pendingCursorEpoch = this.#transactionEpoch;
            this.writeRegion(
                slicePhysicalIndex,
                pageIndex % slice.columns,
                Math.floor(pageIndex / slice.columns),
                slice
            );
            return true;
        }
        return false;
    }

    private writeRegion(
        slicePhysicalIndex: number,
        pageX: number,
        pageY: number,
        slice: Readonly<SliceRecord>
    ): void {
        let region = this.#regions[this.#regionCount];
        if (region === undefined) {
            region = { slicePhysicalIndex: 0, pageX: 0, pageY: 0, x: 0, y: 0, width: 0, height: 0 };
            this.#regions[this.#regionCount] = region;
        }
        region.slicePhysicalIndex = slicePhysicalIndex;
        region.pageX = pageX;
        region.pageY = pageY;
        region.x = slice.x + pageX * this.pageSize;
        region.y = slice.y + pageY * this.pageSize;
        region.width = Math.min(this.pageSize, slice.width - pageX * this.pageSize);
        region.height = Math.min(this.pageSize, slice.height - pageY * this.pageSize);
        this.#regionCount++;
    }

    private residentPageCount(): number {
        let count = 0;
        for (let sliceIndex = 0; sliceIndex < this.#activeSliceCount; sliceIndex += 1) {
            const slice = this.#slices[sliceIndex];
            if (slice === undefined) continue;
            const activePages = slice.columns * slice.rows;
            for (let pageIndex = 0; pageIndex < activePages; pageIndex += 1) {
                if (slice.pages[pageIndex]?.committedUpdateId !== 0) count++;
            }
        }
        return count;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('ShadowAtlasPageResidency is destroyed');
    }
}
