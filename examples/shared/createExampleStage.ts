import Stage, { type StageBackend, type StageParameters } from '../../src/core/Stage';
import type { RendererBackend } from '../../src/render/Renderer';
import { ExampleTicker } from './ExampleTicker';
import { installPageLifecycle, type ExamplePageLifecycle } from './pageLifecycle';

/** Final page disposal cancelled device setup; unrelated backend errors remain failures. */
export class ExampleInitializationCancelledError extends Error {
    constructor() {
        super('Example initialization was cancelled by page disposal');
        this.name = 'ExampleInitializationCancelledError';
    }
}

export interface ExampleStage<Backend extends RendererBackend = RendererBackend> {
    readonly stage: Stage<Backend>;
    readonly ticker: ExampleTicker;
    readonly lifecycle: ExamplePageLifecycle;
}

/** Create a bare Stage with page ownership established before asynchronous device setup. */
export function createExampleStage<Backend extends RendererBackend>(
    parameters: StageParameters<Backend>
): Promise<ExampleStage<Backend>>;
export function createExampleStage(
    parameters: StageParameters<StageBackend>
): Promise<ExampleStage>;
export async function createExampleStage(
    parameters: StageParameters<StageBackend>
): Promise<ExampleStage> {
    const ticker = new ExampleTicker(60);
    let stage: Stage | undefined = undefined;
    const lifecycle = installPageLifecycle({
        pause(): void {
            ticker.suspend();
        },
        resume(): void {
            ticker.restore();
        },
        dispose(): void {
            stage?.destroy();
        }
    });
    lifecycle.onDispose(() => {
        ticker.dispose();
    });
    try {
        stage = await Stage.create(parameters);
        if (lifecycle.disposed) {
            stage.destroy();
            throw new ExampleInitializationCancelledError();
        }
        ticker.addTick(stage);
        return { stage, ticker, lifecycle };
    } catch (error) {
        try {
            lifecycle.dispose();
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                'Example Stage initialization and cleanup failed',
                {
                    cause: cleanupError
                }
            );
        }
        throw error;
    }
}
