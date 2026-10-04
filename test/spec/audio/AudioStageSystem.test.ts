import { describe, expect, it, vi } from 'vitest';
import {
    AUDIO_STAGE_SERVICE,
    AudioClip,
    AudioEngine,
    createAudioStageSystem
} from '@hilo/addon-audio';
import { Node, PerspectiveCamera, type Stage } from 'hilo3d';
import { StageSystemRegistry } from '../../../src/core/StageSystem';

function stageFixture(): { stage: Stage; setCamera: (camera: PerspectiveCamera) => void } {
    const node = new Node();
    let camera = new PerspectiveCamera({ z: 4 });
    Object.defineProperty(node, 'camera', { get: () => camera });
    return {
        stage: node as unknown as Stage,
        setCamera(value): void {
            camera = value;
        }
    };
}

describe('audio Stage System', () => {
    it('provides a service, follows current camera transforms and replaces the camera without renderer dependencies', async () => {
        const { stage, setCamera } = stageFixture();
        const registry = new StageSystemRegistry(stage);
        const context = new OfflineAudioContext(2, 4800, 48000);
        const positionZ = vi.spyOn(context.listener.positionZ, 'setValueAtTime');
        const positionX = vi.spyOn(context.listener.positionX, 'setValueAtTime');
        await registry.initialize([createAudioStageSystem({ context })]);
        const audio = registry.get(AUDIO_STAGE_SERVICE);
        registry.runAfterUpdate(16);
        expect(positionZ).toHaveBeenLastCalledWith(4, 0);
        const next = new PerspectiveCamera({ x: 7, z: 2 });
        setCamera(next);
        registry.runAfterUpdate(16);
        expect(positionX).toHaveBeenLastCalledWith(7, 0);
        next.x = 12;
        registry.runAfterUpdate(16);
        expect(positionX).toHaveBeenLastCalledWith(12, 0);
        const voice = audio.play(new AudioClip(context.createBuffer(1, 48000, 48000)));
        registry.destroy();
        expect(voice?.endReason).toBe('destroyed');
        expect(await voice?.finished).toBe('destroyed');
        expect(registry.getOptional(AUDIO_STAGE_SERVICE)).toBeUndefined();
        expect(context.state).toBe('suspended');
    });

    it('rolls back failed asynchronous setup and releases the context claim', async () => {
        const { stage } = stageFixture();
        const registry = new StageSystemRegistry(stage);
        const context = new OfflineAudioContext(2, 4800, 48000);
        let allocated: AudioEngine | undefined;
        await expect(
            registry.initialize([
                createAudioStageSystem({
                    context,
                    setup: async audio => {
                        allocated = audio;
                        await Promise.resolve();
                        throw new Error('setup failed');
                    }
                })
            ])
        ).rejects.toThrow('setup failed');
        expect(allocated?.getDiagnostics().buses).toBe(0);
        expect(registry.getOptional(AUDIO_STAGE_SERVICE)).toBeUndefined();
        const next = new AudioEngine({ context });
        next.destroy();
    });
});
