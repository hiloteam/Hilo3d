import { verifyTemporalHistoryRetirement } from '../../fixtures/temporal-history-retirement';
import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import type { RenderPipelineContext } from '../../../src/render/pipeline/RenderPipeline';
import type {
    RenderGraphTextureHandle,
    RenderPipelineHistoryTextureResources
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import {
    TemporalResolveController,
    snapshotTemporalAAOptions
} from '../../../src/render/postprocessing/TemporalAA';

interface HistoryRecord {
    readonly texture: RenderGraphTextureHandle;
    readonly createdFrame: number;
    generation: number;
    valid: boolean;
    acquiredFrame: number;
    pendingRelease: boolean;
}

/** CPU graph double enforcing the real acquire/release transaction boundary. */
function historyFixture(): {
    controller: TemporalResolveController;
    histories: Map<object, HistoryRecord>;
    context(camera: PerspectiveCamera, frameIndex: number): RenderPipelineContext;
    finish(frameIndex: number, submitted: boolean): void;
} {
    const controller = new TemporalResolveController(snapshotTemporalAAOptions({}));
    const histories = new Map<object, HistoryRecord>();
    let nextTexture = 1;
    return {
        controller,
        histories,
        context(camera, frameIndex): RenderPipelineContext {
            camera.updateViewProjectionMatrix();
            return {
                camera,
                frameIndex,
                viewport: [0, 0, 32, 32],
                output: { width: 32, height: 32 },
                graph: {
                    acquireHistoryTexture(key: object): RenderPipelineHistoryTextureResources {
                        let history = histories.get(key);
                        if (history?.pendingRelease === true)
                            throw new Error('Cannot acquire a history texture pending release');
                        if (history === undefined) {
                            history = {
                                texture: nextTexture++ as RenderGraphTextureHandle,
                                createdFrame: frameIndex,
                                generation: 1,
                                valid: false,
                                acquiredFrame: -1,
                                pendingRelease: false
                            };
                            histories.set(key, history);
                        }
                        history.acquiredFrame = frameIndex;
                        const texture = history.texture;
                        return {
                            current: texture,
                            valid: history.valid,
                            generation: history.generation,
                            historyCount: 1,
                            history: () => texture
                        };
                    },
                    invalidateHistoryTexture(key: object): boolean {
                        const history = histories.get(key);
                        if (history === undefined) return false;
                        if (history.acquiredFrame === frameIndex)
                            throw new Error('Cannot invalidate acquired history');
                        history.valid = false;
                        history.generation++;
                        return true;
                    },
                    releaseHistoryTexture(key: object): boolean {
                        const history = histories.get(key);
                        if (history === undefined) return false;
                        if (history.acquiredFrame === frameIndex)
                            throw new Error('Cannot release acquired history');
                        history.pendingRelease = true;
                        return true;
                    }
                }
            } as unknown as RenderPipelineContext;
        },
        finish(frameIndex, submitted): void {
            if (submitted) controller.frameSubmitted(frameIndex);
            else controller.frameDiscarded(frameIndex);
            for (const [key, history] of histories) {
                if (
                    (submitted && history.pendingRelease) ||
                    (!submitted && history.createdFrame === frameIndex)
                ) {
                    histories.delete(key);
                    continue;
                }
                if (submitted && history.acquiredFrame === frameIndex) history.valid = true;
                history.pendingRelease = false;
                history.acquiredFrame = -1;
            }
        }
    };
}

describe('TemporalAA CPU history retirement', () => {
    it('recreates a later camera without cancelling retirement of other inactive histories', () => {
        const fixture = historyFixture();
        const first = new PerspectiveCamera();
        const later = new PerspectiveCamera();
        const inactive = new PerspectiveCamera();
        try {
            fixture.controller.begin(fixture.context(first, 1));
            const oldLater = fixture.controller.begin(fixture.context(later, 1));
            const oldInactive = fixture.controller.begin(fixture.context(inactive, 1));
            fixture.finish(1, true);
            fixture.controller.begin(fixture.context(first, 4));
            expect(fixture.histories.get(oldLater.state.colorHistoryKey)?.pendingRelease).toBe(
                true
            );
            const replacement = fixture.controller.begin(fixture.context(later, 4));
            expect(replacement.historyValid).toBe(false);
            expect(replacement.state.colorHistoryKey).not.toBe(oldLater.state.colorHistoryKey);
            expect(replacement.state.depthHistoryKey).not.toBe(oldLater.state.depthHistoryKey);
            fixture.finish(4, true);
            expect(fixture.histories.has(oldLater.state.colorHistoryKey)).toBe(false);
            expect(fixture.histories.has(oldInactive.state.colorHistoryKey)).toBe(false);
            expect(fixture.histories.size).toBe(4);
            const continued = fixture.controller.begin(fixture.context(later, 5));
            expect(continued.state).toBe(replacement.state);
            expect(continued.historyValid).toBe(true);
            fixture.finish(5, true);
        } finally {
            fixture.controller.destroy();
        }
    });

    it('restores the prior camera state, keys and jitter phase when replacement is discarded', () => {
        const fixture = historyFixture();
        const first = new PerspectiveCamera();
        const later = new PerspectiveCamera();
        try {
            fixture.controller.begin(fixture.context(first, 1));
            const original = fixture.controller.begin(fixture.context(later, 1));
            fixture.finish(1, true);
            const nextPhase = original.state.committedJitterIndex;
            fixture.controller.begin(fixture.context(first, 4));
            const candidate = fixture.controller.begin(fixture.context(later, 4));
            fixture.finish(4, false);
            expect(fixture.histories.has(candidate.state.colorHistoryKey)).toBe(false);
            expect(fixture.histories.get(original.state.colorHistoryKey)?.valid).toBe(true);
            expect(later.projectionJitterX).toBe(0);
            expect(later.projectionJitterY).toBe(0);
            // Returning first avoids a second sweep and directly proves rollback restored old state.
            const retried = fixture.controller.begin(fixture.context(later, 5));
            expect(retried.state).toBe(original.state);
            expect(retried.historyValid).toBe(true);
            expect(retried.state.pendingJitterIndex).toBe(nextPhase);
            fixture.finish(5, true);
        } finally {
            fixture.controller.destroy();
        }
    });

    it('recycles failed replacement bindings instead of growing them on every retry', () => {
        const fixture = historyFixture();
        const first = new PerspectiveCamera();
        const later = new PerspectiveCamera();
        try {
            fixture.controller.begin(fixture.context(first, 1));
            const original = fixture.controller.begin(fixture.context(later, 1));
            fixture.finish(1, true);
            const replacementBindings = new Set<object>();
            for (const frameIndex of [4, 7, 10, 13]) {
                fixture.controller.begin(fixture.context(first, frameIndex));
                const candidate = fixture.controller.begin(fixture.context(later, frameIndex));
                expect(candidate.state).not.toBe(original.state);
                replacementBindings.add(candidate.state.bindings);
                fixture.finish(frameIndex, false);
                expect(fixture.histories.size).toBe(4);
            }
            expect(replacementBindings.size).toBe(1);
        } finally {
            fixture.controller.destroy();
        }
    });
});

describe('TemporalAA multi-camera readback on webgl2', () => {
    it(
        'reacquires later-view history after public readbacks and a discarded replacement frame',
        () => verifyTemporalHistoryRetirement('webgl2'),
        30_000
    );
});
