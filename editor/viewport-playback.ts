import { ComponentRuntime, type ComponentAudioSession } from './component-runtime';
import type { PlayComponents } from './play-controller';
import type { ProjectDocument } from './project';
import type { SceneDocument } from './scene';
import type { EditorViewport } from './viewport';

export interface ViewportPlayback extends PlayComponents {
    readonly runtime: ComponentRuntime;
}

/** One adapter for Studio Play and exported Players, including imported model animation. */
export async function createViewportPlayback(
    viewport: EditorViewport,
    scene: SceneDocument,
    project: ProjectDocument,
    signal: AbortSignal,
    audio: ComponentAudioSession | null
): Promise<ViewportPlayback> {
    const runtime = await ComponentRuntime.create({
        scene,
        project,
        signal,
        audio,
        startPaused: true,
        renderer: viewport.runtimeStage.renderer,
        resolveNode: id => viewport.getRuntimeNode(id),
        listener: () => viewport.runtimeCamera
    });
    try {
        signal.throwIfAborted();
        viewport.startModelAnimations();
    } catch (error) {
        await runtime.stop();
        throw error;
    }
    return {
        runtime,
        step(dt, time, current) {
            viewport.stepModelAnimations(dt);
            return runtime.step(dt, time, current);
        },
        executeCommands(commands) {
            runtime.executeCommands(commands);
        },
        pause() {
            runtime.pause();
        },
        resume() {
            runtime.resume();
        },
        async stop() {
            viewport.stopModelAnimations();
            await runtime.stop();
        }
    };
}
