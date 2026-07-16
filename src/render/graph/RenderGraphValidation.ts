export type RenderGraphErrorCode =
    | 'cycle'
    | 'duplicate-access'
    | 'invalid-descriptor'
    | 'invalid-handle'
    | 'invalid-state'
    | 'undeclared-access'
    | 'uninitialized-read';

export class RenderGraphError extends Error {
    readonly code: RenderGraphErrorCode;
    readonly path: string;

    constructor(code: RenderGraphErrorCode, message: string, path = '') {
        super(path === '' ? message : `${path}: ${message}`);
        this.name = 'RenderGraphError';
        this.code = code;
        this.path = path;
    }
}

export function renderGraphFailure(code: RenderGraphErrorCode, message: string, path = ''): never {
    throw new RenderGraphError(code, message, path);
}
