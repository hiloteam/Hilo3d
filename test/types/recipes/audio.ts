import { Node, Stage, PerspectiveCamera } from 'hilo3d';
import {
    AUDIO_STAGE_SERVICE,
    HiloAudioTransform,
    createAudioStageSystem,
    type AudioVoice
} from '@hilo/addon-audio';

/** Unreleased audio recipe. The caller owns ticking/navigation; call enable from a user gesture. */
export async function createAudioScene(container: HTMLElement): Promise<{
    stage: Stage;
    emitter: Node;
    enable(): Promise<void>;
    playEffect(url: string, signal?: AbortSignal): Promise<AudioVoice | null>;
}> {
    const stage = await Stage.create({
        container,
        camera: new PerspectiveCamera({ z: 6 }),
        systems: [createAudioStageSystem({ maxRealVoices: 32, maxVoices: 256 })]
    });
    const audio = stage.systems.get(AUDIO_STAGE_SERVICE);
    const emitter = new Node({ x: 3 });
    stage.addChild(emitter);
    const transform = new HiloAudioTransform(emitter);
    const effects = audio.mixer.createBus('effects', { volume: 0.8 });
    audio.defineConcurrency('impacts', { maxCount: 8, resolution: 'oldest' });
    return {
        stage,
        emitter,
        enable: () => audio.resume(),
        async playEffect(url, signal): Promise<AudioVoice | null> {
            const lease = await audio.clips.load(url, signal === undefined ? {} : { signal });
            try {
                return audio.play(lease.clip, {
                    bus: effects,
                    concurrency: 'impacts',
                    fadeIn: 0.005,
                    spatial: { transform, refDistance: 1, maxDistance: 40 }
                });
            } finally {
                lease.release();
            }
        }
    };
}
