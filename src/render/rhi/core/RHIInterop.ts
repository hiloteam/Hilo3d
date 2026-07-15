import type { RHIDevice } from './RHIResources';
import type { RHISurface } from './RHISurface';
import type { RHIViewport } from './RHITypes';

/**
 * Backend-neutral callback port used by optional native interop extensions. Native handles and
 * backend-specific session state remain owned by the concrete RHI implementation.
 */
export interface RHIExecutionInteropHost {
    readonly executionDevice: RHIDevice;
    readonly presentationSurface: RHISurface;

    /** Rejects presentation mutations that would cross an active execution boundary. */
    assertPresentationMutationAllowed(operation: string): void;

    /** Executes the most recently completed presentation with its retained inputs. */
    executeRetainedPresentation(): void;

    /** Selects the viewport used when the shared execution path builds its next presentation. */
    setPresentationViewport(viewport: Readonly<RHIViewport> | null): void;
}
