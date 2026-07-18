import { EventDispatcher, type DispatchEvent } from '../core/EventDispatcher';
import BasicLoader, { type LoaderRequest } from './BasicLoader';
import GLTFParser, { type GLTFParserParameters } from './GLTFParser';
import Loader from './Loader';
import type { GLTFModel } from './GLTFTypes';

export interface GLTFLoadRequest extends LoaderRequest, GLTFParserParameters {
    src: string;
}

export interface GLTFResourceLoader {
    loadRes(url: string, type?: string): Promise<BasicLoaderResource>;
}

export type BasicLoaderResource = Awaited<ReturnType<BasicLoader['loadRes']>>;

const FORWARDED_EVENTS = ['beforeload', 'loaded', 'failed', 'progress'] as const;

/** glTF loader composed with the shared network transport. */
class GLTFLoader extends EventDispatcher implements GLTFResourceLoader {
    readonly isGLTFLoader = true;
    readonly className = 'GLTFLoader';
    private readonly transport: BasicLoader;

    constructor(transport: BasicLoader = new BasicLoader()) {
        super();
        this.transport = transport;
        for (const type of FORWARDED_EVENTS) {
            transport.on(type, (event: DispatchEvent) => {
                this.fire(event);
            });
        }
    }

    loadRes(url: string, type?: string): Promise<BasicLoaderResource> {
        return this.transport.loadRes(url, type);
    }

    async load(params: GLTFLoadRequest | LoaderRequest): Promise<GLTFModel> {
        if (!params.src) throw new TypeError('GLTFLoader requires a source URL.');
        const request: GLTFLoadRequest = { ...params, src: params.src };
        try {
            const resource = await this.loadRes(request.src, BasicLoader.TYPE_BUFFER);
            if (!(resource instanceof ArrayBuffer)) {
                throw new TypeError('glTF source did not resolve to an ArrayBuffer.');
            }
            return await new GLTFParser(resource, request).parse(this);
        } catch (error: unknown) {
            throw new Error(`Failed to load glTF ${request.src}.`, { cause: error });
        }
    }
}

Loader.addLoader('gltf', GLTFLoader);
Loader.addLoader('glb', GLTFLoader);

export default GLTFLoader;
