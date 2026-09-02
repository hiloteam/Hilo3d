import type { ParticleCompilationEnvironment } from './ParticleCompiler.js';
import {
    compileParticleAuthoringGraph,
    type ParticleAuthoringCompileOptions,
    type ParticleAuthoringDiagnostic,
    type ParticleAuthoringGraph,
    type ParticleAuthoringIR
} from './ParticleAuthoring.js';
import ParticleSystem from './ParticleSystem.js';
import type ParticleSystemDefinition from './ParticleSystemDefinition.js';

/** Current deterministic external particle preview command protocol. */
export const PARTICLE_PREVIEW_PROTOCOL_VERSION = 1 as const;

/** Commands accepted by `ParticleAuthoringPreviewController`. */
export type ParticleAuthoringPreviewCommand =
    'compile' | 'play' | 'pause' | 'restart' | 'seek' | 'step' | 'inspect' | 'dispose';

interface ParticleAuthoringPreviewRequestBase {
    readonly protocolVersion: typeof PARTICLE_PREVIEW_PROTOCOL_VERSION;
    readonly requestId: string;
    readonly command: ParticleAuthoringPreviewCommand;
}

/** Compile and install one external authoring graph for preview. */
export interface ParticleAuthoringPreviewCompileRequest extends ParticleAuthoringPreviewRequestBase {
    readonly command: 'compile';
    readonly graph: Readonly<ParticleAuthoringGraph>;
    readonly seed?: number;
}

/** Playback/control request without a numeric payload. */
export interface ParticleAuthoringPreviewControlRequest extends ParticleAuthoringPreviewRequestBase {
    readonly command: 'play' | 'pause' | 'restart' | 'inspect' | 'dispose';
}

/** Deterministically seek from authored start/prewarm state. */
export interface ParticleAuthoringPreviewSeekRequest extends ParticleAuthoringPreviewRequestBase {
    readonly command: 'seek';
    readonly timeSeconds: number;
}

/** Advance one explicit preview step regardless of play/pause state. */
export interface ParticleAuthoringPreviewStepRequest extends ParticleAuthoringPreviewRequestBase {
    readonly command: 'step';
    readonly deltaSeconds: number;
}

/** Closed request union transported between an external editor and preview host. */
export type ParticleAuthoringPreviewRequest =
    | ParticleAuthoringPreviewCompileRequest
    | ParticleAuthoringPreviewControlRequest
    | ParticleAuthoringPreviewSeekRequest
    | ParticleAuthoringPreviewStepRequest;

/** Compact backend-neutral preview state; no GPU particle readback is performed. */
export interface ParticleAuthoringPreviewState {
    readonly status: 'empty' | 'ready' | 'playing' | 'completed' | 'disposed';
    readonly timeSeconds: number;
    readonly definitionHash: string | null;
    readonly compiledPlanHash: string | null;
    readonly seed: number | null;
    readonly aliveCount: number;
    readonly stateHash: string | null;
}

/** Structured response returned for every accepted or rejected preview command. */
export interface ParticleAuthoringPreviewResponse {
    readonly protocolVersion: typeof PARTICLE_PREVIEW_PROTOCOL_VERSION;
    readonly requestId: string;
    readonly command: ParticleAuthoringPreviewCommand | 'invalid';
    readonly success: boolean;
    readonly diagnostics: readonly Readonly<ParticleAuthoringDiagnostic>[];
    readonly state: Readonly<ParticleAuthoringPreviewState>;
    /** Present after successful compilation so external inspectors can rebuild without runtime access. */
    readonly ir?: Readonly<ParticleAuthoringIR>;
}

/** Factory used when a preview host needs custom ParticleSystem construction/attachment. */
export type ParticleAuthoringPreviewSystemFactory = (
    definition: ParticleSystemDefinition,
    seed: number,
    compilationEnvironment?: Readonly<ParticleCompilationEnvironment>
) => ParticleSystem;

/** Preview host integration hooks and compiler resource/environment policy. */
export interface ParticleAuthoringPreviewControllerOptions {
    readonly compileOptions?: Readonly<ParticleAuthoringCompileOptions>;
    readonly createSystem?: ParticleAuthoringPreviewSystemFactory;
    /** Release renderer/scene ownership when a compiled preview is replaced or disposed. */
    readonly disposeSystem?: (system: ParticleSystem) => void;
}

type UnknownRecord = Record<string, unknown>;

const COMMANDS = new Set<ParticleAuthoringPreviewCommand>([
    'compile',
    'play',
    'pause',
    'restart',
    'seek',
    'step',
    'inspect',
    'dispose'
]);
const REQUEST_KEYS: Readonly<Record<ParticleAuthoringPreviewCommand, ReadonlySet<string>>> =
    Object.freeze({
        compile: new Set(['protocolVersion', 'requestId', 'command', 'graph', 'seed']),
        play: new Set(['protocolVersion', 'requestId', 'command']),
        pause: new Set(['protocolVersion', 'requestId', 'command']),
        restart: new Set(['protocolVersion', 'requestId', 'command']),
        seek: new Set(['protocolVersion', 'requestId', 'command', 'timeSeconds']),
        step: new Set(['protocolVersion', 'requestId', 'command', 'deltaSeconds']),
        inspect: new Set(['protocolVersion', 'requestId', 'command']),
        dispose: new Set(['protocolVersion', 'requestId', 'command'])
    });

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function previewDiagnostic(
    code: string,
    diagnosticMessage: string,
    path: string
): Readonly<ParticleAuthoringDiagnostic> {
    return Object.freeze({ severity: 'error', code, message: diagnosticMessage, path });
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Deterministic preview command adapter. The controller owns simulation time and never renders;
 * hosts render the current `system` through the ordinary Engine/RenderWorld contract.
 */
export class ParticleAuthoringPreviewController {
    readonly #options: Readonly<ParticleAuthoringPreviewControllerOptions>;
    #system: ParticleSystem | null = null;
    #timeSeconds = 0;
    #playing = false;
    #disposed = false;

    constructor(options: Readonly<ParticleAuthoringPreviewControllerOptions> = {}) {
        this.#options = Object.freeze({ ...options });
    }

    /** Current preview node for host-owned scene attachment/rendering. */
    get system(): ParticleSystem | null {
        return this.#system;
    }

    /** Validate and execute one protocol request without throwing authoring errors. */
    handle(request: unknown): Readonly<ParticleAuthoringPreviewResponse> {
        const parsed = this.parseRequest(request);
        if ('diagnostic' in parsed) {
            return this.response(parsed.requestId, parsed.command, false, [parsed.diagnostic]);
        }
        const command = parsed.request.command;
        if (this.#disposed) {
            return this.response(parsed.request.requestId, command, false, [
                previewDiagnostic(
                    'preview.disposed',
                    'Particle preview controller is disposed',
                    '/command'
                )
            ]);
        }
        try {
            switch (parsed.request.command) {
                case 'compile':
                    return this.compile(parsed.request);
                case 'play':
                    return this.withSystem(parsed.request.requestId, command, system => {
                        this.#playing = !system.completed;
                    });
                case 'pause':
                    return this.withSystem(parsed.request.requestId, command, () => {
                        this.#playing = false;
                    });
                case 'restart':
                    return this.withSystem(parsed.request.requestId, command, system => {
                        system.restart().pause();
                        this.#timeSeconds = 0;
                        this.#playing = false;
                    });
                case 'seek': {
                    const timeSeconds = parsed.request.timeSeconds;
                    return this.withSystem(parsed.request.requestId, command, system => {
                        system.restart().pause().simulate(timeSeconds);
                        this.#timeSeconds = Math.fround(timeSeconds);
                        this.#playing = false;
                    });
                }
                case 'step': {
                    const deltaSeconds = parsed.request.deltaSeconds;
                    return this.withSystem(parsed.request.requestId, command, system => {
                        system.simulate(deltaSeconds);
                        this.#timeSeconds = Math.fround(this.#timeSeconds + deltaSeconds);
                        if (system.completed) this.#playing = false;
                    });
                }
                case 'inspect':
                    return this.response(parsed.request.requestId, command, true, []);
                case 'dispose':
                    this.releaseSystem();
                    this.#disposed = true;
                    this.#playing = false;
                    this.#timeSeconds = 0;
                    return this.response(parsed.request.requestId, command, true, []);
            }
        } catch (error) {
            return this.response(parsed.request.requestId, command, false, [
                previewDiagnostic('preview.command.failed', message(error), '/command')
            ]);
        }
    }

    private compile(
        request: Readonly<ParticleAuthoringPreviewCompileRequest>
    ): Readonly<ParticleAuthoringPreviewResponse> {
        const result = compileParticleAuthoringGraph(request.graph, this.#options.compileOptions);
        if (!result.success) {
            return this.response(request.requestId, request.command, false, result.diagnostics);
        }
        const seed = request.seed ?? 0;
        const compilationEnvironment = this.#options.compileOptions?.compilationEnvironment;
        const system = this.#options.createSystem
            ? this.#options.createSystem(result.definition, seed, compilationEnvironment)
            : new ParticleSystem({
                  definition: result.definition,
                  seed,
                  autoPlay: false,
                  ...(compilationEnvironment === undefined ? {} : { compilationEnvironment })
              });
        if (!(system instanceof ParticleSystem)) {
            throw new TypeError('Particle preview system factory must return a ParticleSystem');
        }
        system.restart().pause();
        this.releaseSystem();
        this.#system = system;
        this.#timeSeconds = 0;
        this.#playing = false;
        return this.response(
            request.requestId,
            request.command,
            true,
            result.diagnostics,
            result.ir
        );
    }

    private withSystem(
        requestId: string,
        command: ParticleAuthoringPreviewCommand,
        operation: (system: ParticleSystem) => void
    ): Readonly<ParticleAuthoringPreviewResponse> {
        if (this.#system === null) {
            return this.response(requestId, command, false, [
                previewDiagnostic(
                    'preview.system.missing',
                    'Compile a particle graph before preview control',
                    '/command'
                )
            ]);
        }
        operation(this.#system);
        return this.response(requestId, command, true, []);
    }

    private releaseSystem(): void {
        if (this.#system !== null) this.#options.disposeSystem?.(this.#system);
        this.#system = null;
    }

    private state(): Readonly<ParticleAuthoringPreviewState> {
        const system = this.#system;
        const status: ParticleAuthoringPreviewState['status'] = this.#disposed
            ? 'disposed'
            : system === null
              ? 'empty'
              : system.completed
                ? 'completed'
                : this.#playing
                  ? 'playing'
                  : 'ready';
        return Object.freeze({
            status,
            timeSeconds: this.#timeSeconds,
            definitionHash: system?.definition.hash ?? null,
            compiledPlanHash: system?.compiledPlan.hash ?? null,
            seed: system?.seed ?? null,
            aliveCount: system?.aliveCount ?? 0,
            stateHash: system?.stateHash() ?? null
        });
    }

    private response(
        requestId: string,
        command: ParticleAuthoringPreviewCommand | 'invalid',
        success: boolean,
        diagnostics: readonly Readonly<ParticleAuthoringDiagnostic>[],
        ir?: Readonly<ParticleAuthoringIR>
    ): Readonly<ParticleAuthoringPreviewResponse> {
        return Object.freeze({
            protocolVersion: PARTICLE_PREVIEW_PROTOCOL_VERSION,
            requestId,
            command,
            success,
            diagnostics: Object.freeze([...diagnostics]),
            state: this.state(),
            ...(ir === undefined ? {} : { ir })
        });
    }

    private parseRequest(request: unknown):
        | { readonly request: Readonly<ParticleAuthoringPreviewRequest> }
        | {
              readonly requestId: string;
              readonly command: ParticleAuthoringPreviewCommand | 'invalid';
              readonly diagnostic: Readonly<ParticleAuthoringDiagnostic>;
          } {
        if (!isRecord(request)) {
            return {
                requestId: '<invalid>',
                command: 'invalid',
                diagnostic: previewDiagnostic(
                    'preview.request.type',
                    'Particle preview request must be an object',
                    ''
                )
            };
        }
        const requestId =
            typeof request['requestId'] === 'string' ? request['requestId'] : '<invalid>';
        const rawCommand = request['command'];
        const command: ParticleAuthoringPreviewCommand | 'invalid' =
            typeof rawCommand === 'string' &&
            COMMANDS.has(rawCommand as ParticleAuthoringPreviewCommand)
                ? (rawCommand as ParticleAuthoringPreviewCommand)
                : 'invalid';
        const fail = (
            code: string,
            text: string,
            path: string
        ): {
            readonly requestId: string;
            readonly command: ParticleAuthoringPreviewCommand | 'invalid';
            readonly diagnostic: Readonly<ParticleAuthoringDiagnostic>;
        } => ({ requestId, command, diagnostic: previewDiagnostic(code, text, path) });
        if (request['protocolVersion'] !== PARTICLE_PREVIEW_PROTOCOL_VERSION) {
            return fail(
                'preview.request.version',
                `Particle preview protocol version must be ${String(PARTICLE_PREVIEW_PROTOCOL_VERSION)}`,
                '/protocolVersion'
            );
        }
        if (!/^[A-Za-z0-9_.:-]+$/u.test(requestId)) {
            return fail(
                'preview.request.id',
                'Particle preview request id is invalid',
                '/requestId'
            );
        }
        if (command === 'invalid') {
            return fail(
                'preview.request.command',
                'Particle preview command is invalid',
                '/command'
            );
        }
        const allowed = REQUEST_KEYS[command];
        const extra = Object.keys(request).find(key => !allowed.has(key));
        if (extra !== undefined) {
            return fail(
                'preview.request.unknown-field',
                `Unknown particle preview request field ${extra}`,
                `/${extra}`
            );
        }
        if (command === 'compile') {
            if (!isRecord(request['graph'])) {
                return fail(
                    'preview.request.graph',
                    'Compile request requires a graph object',
                    '/graph'
                );
            }
            const seed = request['seed'];
            if (
                seed !== undefined &&
                (!Number.isSafeInteger(seed) ||
                    (seed as number) < 0 ||
                    (seed as number) > 0xffff_ffff)
            ) {
                return fail('preview.request.seed', 'Compile request seed must be uint32', '/seed');
            }
        }
        if (command === 'seek') {
            const time = request['timeSeconds'];
            if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
                return fail(
                    'preview.request.time',
                    'Seek time must be finite and non-negative',
                    '/timeSeconds'
                );
            }
        }
        if (command === 'step') {
            const delta = request['deltaSeconds'];
            if (typeof delta !== 'number' || !Number.isFinite(delta) || delta < 0) {
                return fail(
                    'preview.request.delta',
                    'Step delta must be finite and non-negative',
                    '/deltaSeconds'
                );
            }
        }
        return { request: request as unknown as Readonly<ParticleAuthoringPreviewRequest> };
    }
}
