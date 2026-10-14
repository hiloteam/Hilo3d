import { describe, it } from 'vitest';
import { verifyTemporalHistoryRetirement } from '../fixtures/temporal-history-retirement';

describe('TemporalAA multi-camera readback on webgpu', () => {
    it(
        'reacquires later-view history after public readbacks and a discarded replacement frame',
        () => verifyTemporalHistoryRetirement('webgpu'),
        30_000
    );
});
