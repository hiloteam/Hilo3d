import {
    createStageSystemService,
    STAGE_SYSTEM_API_VERSION,
    type Stage,
    type StageSystem
} from 'hilo3d';
import { AudioEngine } from './AudioEngine.js';
import { HiloAudioTransform } from './HiloAudioTransform.js';
import type { AudioEngineOptions } from './types.js';

/** Stage-owned audio service; disposed before its renderer and scene resources. */
export const AUDIO_STAGE_SERVICE = createStageSystemService<AudioEngine>(
    '@hilo/addon-audio/runtime'
);

/** Audio System setup, run once for each Stage instance. */
export interface AudioStageSystemOptions extends AudioEngineOptions {
    /** Follow the Stage's active camera, including later camera replacement. Defaults to true. */
    readonly followCamera?: boolean;
    readonly setup?: (audio: AudioEngine, stage: Stage) => void | Promise<void>;
}

/** Install audio after scene updates. Autoplay unlock remains an explicit user-gesture resume(). */
export function createAudioStageSystem(options: AudioStageSystemOptions = {}): StageSystem {
    const snapshot = { ...options, ...(options.cache ? { cache: { ...options.cache } } : {}) };
    return {
        descriptor: {
            id: '@hilo/addon-audio',
            version: '2.0.0-alpha.8',
            apiVersion: STAGE_SYSTEM_API_VERSION,
            provides: [AUDIO_STAGE_SERVICE]
        },
        async setup(context) {
            const audio = new AudioEngine(snapshot);
            let camera = context.stage.camera;
            let transform = camera ? new HiloAudioTransform(camera) : undefined;
            try {
                context.provide(AUDIO_STAGE_SERVICE, audio);
                if (snapshot.followCamera !== false && transform) audio.setListener({ transform });
                await snapshot.setup?.(audio, context.stage);
                return {
                    afterUpdate(): void {
                        if (snapshot.followCamera !== false && camera !== context.stage.camera) {
                            camera = context.stage.camera;
                            transform = camera ? new HiloAudioTransform(camera) : undefined;
                            audio.setListener({ transform: transform ?? null });
                        }
                        audio.update();
                    },
                    destroy(): void {
                        audio.destroy();
                    }
                };
            } catch (error) {
                audio.destroy();
                throw error;
            }
        }
    };
}
