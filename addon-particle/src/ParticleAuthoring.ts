import { compileParticleSystemDefinition } from './ParticleCompiler.js';
import type { ParticleAttributeLayout, ParticleCompiledPlan } from './ParticleCompiledPlan.js';
import {
    deserializeParticleSystemDefinition,
    PARTICLE_DEFINITION_SCHEMA,
    serializeParticleSystemDefinition,
    type ParticleDefinitionDeserializationOptions,
    type ParticleDefinitionJSONParameter,
    type ParticleDefinitionJSONRecord,
    type ParticleDefinitionJSONValue,
    type ParticleDefinitionSerializationOptions,
    type ParticleSystemDefinitionJSON
} from './ParticleDefinitionSerialization.js';
import type ParticleSystemDefinition from './ParticleSystemDefinition.js';
import { PARTICLE_DEFINITION_VERSION } from './ParticleTypes.js';

/** Stable external fixed-module graph document family. */
export const PARTICLE_AUTHORING_SCHEMA = 'hilo3d.particle-authoring' as const;

/** Current external fixed-module graph and normalized IR version. */
export const PARTICLE_AUTHORING_VERSION = 1 as const;

/** Closed node kinds understood by the external authoring compiler. */
export type ParticleAuthoringNodeKind = 'system' | 'emitter' | 'module' | 'renderer';

/** Closed ownership ports; edges do not represent arbitrary executable data flow. */
export type ParticleAuthoringPort = 'emitters' | 'modules' | 'renderers';

/** One JSON node in the external fixed-module authoring graph. */
export interface ParticleAuthoringNode {
    readonly id: string;
    readonly kind: ParticleAuthoringNodeKind;
    readonly data: ParticleDefinitionJSONRecord;
    /** Opaque JSON retained for an external editor and ignored by runtime compilation. */
    readonly metadata?: ParticleDefinitionJSONRecord;
}

/** One ordered ownership edge in the external authoring graph. */
export interface ParticleAuthoringEdge {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly port: ParticleAuthoringPort;
    readonly order: number;
}

/** Versioned pure-JSON graph consumed by the external authoring compiler. */
export interface ParticleAuthoringGraph {
    readonly schema: typeof PARTICLE_AUTHORING_SCHEMA;
    readonly version: typeof PARTICLE_AUTHORING_VERSION;
    readonly definitionSchema: typeof PARTICLE_DEFINITION_SCHEMA;
    readonly definitionVersion: typeof PARTICLE_DEFINITION_VERSION;
    readonly parameters: readonly ParticleDefinitionJSONParameter[];
    readonly nodes: readonly Readonly<ParticleAuthoringNode>[];
    readonly edges: readonly Readonly<ParticleAuthoringEdge>[];
    /** Opaque graph-level JSON retained for external editor layout/project data. */
    readonly metadata?: ParticleDefinitionJSONRecord;
}

/** Structured compiler feedback addressable to one graph path/node. */
export interface ParticleAuthoringDiagnostic {
    readonly severity: 'error' | 'warning' | 'info';
    readonly code: string;
    readonly message: string;
    /** Stable graph path; node-addressed paths use the submitted node id. */
    readonly path: string;
    readonly nodeId?: string;
}

/** Compiler-derived emitter data used by inspectors and preview hosts. */
export interface ParticleAuthoringEmitterIR {
    readonly nodeId: string;
    readonly name: string;
    readonly emitterId: number;
    readonly planKind: 'cpu-stateful' | 'gpu-stateful' | 'stateless';
    readonly layoutHash: string;
    readonly attributes: readonly Readonly<ParticleAttributeLayout>[];
    readonly moduleNodeIds: readonly string[];
    readonly rendererNodeIds: readonly string[];
    readonly statelessEligible: boolean;
    readonly statelessDiagnostics: readonly string[];
}

/** Normalized fixed-module IR; runtime still consumes the embedded ordinary definition. */
export interface ParticleAuthoringIR {
    readonly schema: typeof PARTICLE_AUTHORING_SCHEMA;
    readonly version: typeof PARTICLE_AUTHORING_VERSION;
    readonly systemNodeId: string;
    readonly definitionJSON: Readonly<ParticleSystemDefinitionJSON>;
    readonly definitionHash: string;
    readonly compiledPlanHash: string;
    readonly emitters: readonly Readonly<ParticleAuthoringEmitterIR>[];
}

/** Environment/resource policy for compiling an external authoring graph. */
export type ParticleAuthoringCompileOptions = ParticleDefinitionDeserializationOptions;

/** Successful external authoring compilation. */
export interface ParticleAuthoringCompileSuccess {
    readonly success: true;
    readonly diagnostics: readonly Readonly<ParticleAuthoringDiagnostic>[];
    readonly graph: Readonly<ParticleAuthoringGraph>;
    readonly ir: Readonly<ParticleAuthoringIR>;
    readonly definition: ParticleSystemDefinition;
    readonly compiledPlan: Readonly<ParticleCompiledPlan>;
}

/** Failed external authoring compilation; no partial runtime definition escapes. */
export interface ParticleAuthoringCompileFailure {
    readonly success: false;
    readonly diagnostics: readonly Readonly<ParticleAuthoringDiagnostic>[];
}

/** Fail-closed result returned to external authoring and preview hosts. */
export type ParticleAuthoringCompileResult =
    ParticleAuthoringCompileSuccess | ParticleAuthoringCompileFailure;

type UnknownRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]*$/u;
const ROOT_KEYS = new Set([
    'schema',
    'version',
    'definitionSchema',
    'definitionVersion',
    'parameters',
    'nodes',
    'edges',
    'metadata'
]);
const NODE_KEYS = new Set(['id', 'kind', 'data', 'metadata']);
const EDGE_KEYS = new Set(['id', 'from', 'to', 'port', 'order']);
const NODE_KINDS = new Set<ParticleAuthoringNodeKind>(['system', 'emitter', 'module', 'renderer']);
const PORTS = new Set<ParticleAuthoringPort>(['emitters', 'modules', 'renderers']);

function isJSONArray(value: unknown): value is readonly ParticleDefinitionJSONValue[] {
    return isUnknownArray(value) && value.every(item => isJSONValue(item));
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function deepFreezeJSON<T extends ParticleDefinitionJSONValue>(value: T): T {
    if (isJSONArray(value)) {
        for (const item of value) deepFreezeJSON(item);
        return Object.freeze(value);
    }
    if (isRecord(value)) {
        for (const child of Object.values(value)) {
            if (isJSONValue(child)) deepFreezeJSON(child);
        }
        return Object.freeze(value) as T;
    }
    return value;
}

function cloneJSON(value: ParticleDefinitionJSONValue): ParticleDefinitionJSONValue {
    if (isJSONArray(value)) {
        return Object.freeze(value.map(item => cloneJSON(item)));
    }
    if (isRecord(value)) {
        const result: Record<string, ParticleDefinitionJSONValue> = {};
        for (const key of Object.keys(value).sort()) {
            const child = value[key];
            if (child !== undefined) result[key] = cloneJSON(child);
        }
        return Object.freeze(result);
    }
    return value;
}

function isRecord(value: unknown): value is UnknownRecord {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
}

function isJSONValue(
    value: unknown,
    seen = new Set<object>()
): value is ParticleDefinitionJSONValue {
    if (
        value === null ||
        typeof value === 'boolean' ||
        typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value))
    ) {
        return true;
    }
    if (typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    const valid = isUnknownArray(value)
        ? value.every(item => isJSONValue(item, seen))
        : isRecord(value) && Object.values(value).every(item => isJSONValue(item, seen));
    seen.delete(value);
    return valid;
}

function diagnostic(
    severity: ParticleAuthoringDiagnostic['severity'],
    code: string,
    message: string,
    path: string,
    nodeId?: string
): Readonly<ParticleAuthoringDiagnostic> {
    return Object.freeze({
        severity,
        code,
        message,
        path,
        ...(nodeId === undefined ? {} : { nodeId })
    });
}

function unknownKeys(record: UnknownRecord, allowed: ReadonlySet<string>): readonly string[] {
    return Object.keys(record).filter(key => !allowed.has(key));
}

function canonicalRecord(
    record: Readonly<ParticleDefinitionJSONRecord>
): ParticleDefinitionJSONRecord {
    return cloneJSON(record) as ParticleDefinitionJSONRecord;
}

function recordWithout(
    record: Readonly<ParticleDefinitionJSONRecord>,
    excluded: ReadonlySet<string>
): ParticleDefinitionJSONRecord {
    const result: Record<string, ParticleDefinitionJSONValue> = {};
    for (const [key, value] of Object.entries(record)) {
        if (!excluded.has(key)) result[key] = value;
    }
    return canonicalRecord(result);
}

/**
 * JSON Schema for graph transport and editor-side structural validation. Definition node payloads
 * remain governed by `PARTICLE_DEFINITION_SCHEMA` and are revalidated by the engine compiler.
 */
export const PARTICLE_AUTHORING_JSON_SCHEMA: Readonly<ParticleDefinitionJSONRecord> =
    deepFreezeJSON({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'https://hilo3d.dev/schema/particle-authoring-v1.json',
        type: 'object',
        additionalProperties: false,
        required: [
            'schema',
            'version',
            'definitionSchema',
            'definitionVersion',
            'parameters',
            'nodes',
            'edges'
        ],
        properties: {
            schema: { const: PARTICLE_AUTHORING_SCHEMA },
            version: { const: PARTICLE_AUTHORING_VERSION },
            definitionSchema: { const: PARTICLE_DEFINITION_SCHEMA },
            definitionVersion: { const: PARTICLE_DEFINITION_VERSION },
            parameters: { type: 'array', items: { type: 'object' } },
            nodes: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'kind', 'data'],
                    properties: {
                        id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]*$' },
                        kind: { enum: ['system', 'emitter', 'module', 'renderer'] },
                        data: { type: 'object' },
                        metadata: { type: 'object' }
                    }
                }
            },
            edges: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'from', 'to', 'port', 'order'],
                    properties: {
                        id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]*$' },
                        from: { type: 'string' },
                        to: { type: 'string' },
                        port: { enum: ['emitters', 'modules', 'renderers'] },
                        order: { type: 'integer', minimum: 0 }
                    }
                }
            },
            metadata: { type: 'object' }
        }
    });

/** Convert one immutable definition into a deterministic editable fixed-module graph. */
export function createParticleAuthoringGraph(
    definition: ParticleSystemDefinition,
    options: Readonly<ParticleDefinitionSerializationOptions> = {}
): Readonly<ParticleAuthoringGraph> {
    const serialized = serializeParticleSystemDefinition(definition, options);
    const nodes: ParticleAuthoringNode[] = [
        Object.freeze({ id: 'system', kind: 'system', data: Object.freeze({}) })
    ];
    const edges: ParticleAuthoringEdge[] = [];
    for (let emitterIndex = 0; emitterIndex < serialized.emitters.length; emitterIndex += 1) {
        const emitter = serialized.emitters[emitterIndex];
        if (emitter === undefined) throw new Error('Serialized particle emitter is unavailable');
        const emitterId = `emitter:${String(emitterIndex)}`;
        const modules = emitter['modules'];
        const renderers = emitter['renderers'];
        if (!isJSONArray(modules) || !isJSONArray(renderers)) {
            throw new TypeError('Serialized particle emitter topology is unavailable');
        }
        nodes.push(
            Object.freeze({
                id: emitterId,
                kind: 'emitter',
                data: recordWithout(emitter, new Set(['modules', 'renderers']))
            })
        );
        edges.push(
            Object.freeze({
                id: `edge:${emitterId}`,
                from: emitterId,
                to: 'system',
                port: 'emitters',
                order: emitterIndex
            })
        );
        for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex += 1) {
            const module = modules[moduleIndex];
            if (!isRecord(module) || !isJSONValue(module)) {
                throw new TypeError('Serialized particle module is invalid');
            }
            const moduleId = `${emitterId}:module:${String(moduleIndex)}`;
            nodes.push(
                Object.freeze({ id: moduleId, kind: 'module', data: canonicalRecord(module) })
            );
            edges.push(
                Object.freeze({
                    id: `edge:${moduleId}`,
                    from: moduleId,
                    to: emitterId,
                    port: 'modules',
                    order: moduleIndex
                })
            );
        }
        for (let rendererIndex = 0; rendererIndex < renderers.length; rendererIndex += 1) {
            const renderer = renderers[rendererIndex];
            if (!isRecord(renderer) || !isJSONValue(renderer)) {
                throw new TypeError('Serialized particle renderer is invalid');
            }
            const rendererId = `${emitterId}:renderer:${String(rendererIndex)}`;
            nodes.push(
                Object.freeze({
                    id: rendererId,
                    kind: 'renderer',
                    data: canonicalRecord(renderer)
                })
            );
            edges.push(
                Object.freeze({
                    id: `edge:${rendererId}`,
                    from: rendererId,
                    to: emitterId,
                    port: 'renderers',
                    order: rendererIndex
                })
            );
        }
    }
    return Object.freeze({
        schema: PARTICLE_AUTHORING_SCHEMA,
        version: PARTICLE_AUTHORING_VERSION,
        definitionSchema: PARTICLE_DEFINITION_SCHEMA,
        definitionVersion: PARTICLE_DEFINITION_VERSION,
        parameters: serialized.parameters,
        nodes: Object.freeze(nodes),
        edges: Object.freeze(edges)
    });
}

interface ValidatedGraph {
    readonly graph: Readonly<ParticleAuthoringGraph>;
    readonly nodes: ReadonlyMap<string, Readonly<ParticleAuthoringNode>>;
    readonly system: Readonly<ParticleAuthoringNode>;
}

function validateGraph(
    source: unknown,
    diagnostics: Readonly<ParticleAuthoringDiagnostic>[]
): ValidatedGraph | null {
    if (!isRecord(source)) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.document.type',
                'Authoring graph must be a plain object',
                ''
            )
        );
        return null;
    }
    for (const key of unknownKeys(source, ROOT_KEYS)) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.document.unknown-field',
                `Unknown authoring graph field ${key}`,
                `/${key}`
            )
        );
    }
    if (source['schema'] !== PARTICLE_AUTHORING_SCHEMA) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.document.schema',
                `Authoring graph schema must be ${PARTICLE_AUTHORING_SCHEMA}`,
                '/schema'
            )
        );
    }
    if (source['version'] !== PARTICLE_AUTHORING_VERSION) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.document.version',
                `Authoring graph version must be ${String(PARTICLE_AUTHORING_VERSION)}`,
                '/version'
            )
        );
    }
    if (source['definitionSchema'] !== PARTICLE_DEFINITION_SCHEMA) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.definition.schema',
                `Definition schema must be ${PARTICLE_DEFINITION_SCHEMA}`,
                '/definitionSchema'
            )
        );
    }
    if (source['definitionVersion'] !== PARTICLE_DEFINITION_VERSION) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.definition.version',
                `Definition version must be ${String(PARTICLE_DEFINITION_VERSION)}`,
                '/definitionVersion'
            )
        );
    }
    const rawParameters = source['parameters'];
    const rawNodes = source['nodes'];
    const rawEdges = source['edges'];
    if (!isJSONArray(rawParameters)) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.parameters.type',
                'Authoring parameters must be a JSON array',
                '/parameters'
            )
        );
    }
    if (!isUnknownArray(rawNodes)) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.nodes.type',
                'Authoring nodes must be an array',
                '/nodes'
            )
        );
    }
    if (!isUnknownArray(rawEdges)) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.edges.type',
                'Authoring edges must be an array',
                '/edges'
            )
        );
    }
    const metadata = source['metadata'];
    if (metadata !== undefined && (!isRecord(metadata) || !isJSONValue(metadata))) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.metadata.type',
                'Authoring metadata must be a plain JSON object',
                '/metadata'
            )
        );
    }
    if (!isJSONArray(rawParameters) || !isUnknownArray(rawNodes) || !isUnknownArray(rawEdges))
        return null;

    const nodes = new Map<string, Readonly<ParticleAuthoringNode>>();
    const nodeList: Readonly<ParticleAuthoringNode>[] = [];
    for (let index = 0; index < rawNodes.length; index += 1) {
        const rawNode = rawNodes[index];
        const path = `/nodes/${String(index)}`;
        if (!isRecord(rawNode)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.type',
                    'Authoring node must be a plain object',
                    path
                )
            );
            continue;
        }
        for (const key of unknownKeys(rawNode, NODE_KEYS)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.unknown-field',
                    `Unknown authoring node field ${key}`,
                    `${path}/${key}`
                )
            );
        }
        const id = rawNode['id'];
        const kind = rawNode['kind'];
        const data = rawNode['data'];
        if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.id',
                    'Authoring node id is invalid',
                    `${path}/id`
                )
            );
            continue;
        }
        if (nodes.has(id)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.duplicate',
                    `Duplicate authoring node id ${id}`,
                    `${path}/id`,
                    id
                )
            );
            continue;
        }
        if (typeof kind !== 'string' || !NODE_KINDS.has(kind as ParticleAuthoringNodeKind)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.kind',
                    `Authoring node ${id} has an invalid kind`,
                    `${path}/kind`,
                    id
                )
            );
            continue;
        }
        if (!isRecord(data) || !isJSONValue(data)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.data',
                    `Authoring node ${id} data must be a plain JSON object`,
                    `${path}/data`,
                    id
                )
            );
            continue;
        }
        const nodeMetadata = rawNode['metadata'];
        if (nodeMetadata !== undefined && (!isRecord(nodeMetadata) || !isJSONValue(nodeMetadata))) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.metadata',
                    `Authoring node ${id} metadata must be a plain JSON object`,
                    `${path}/metadata`,
                    id
                )
            );
            continue;
        }
        const node: Readonly<ParticleAuthoringNode> = Object.freeze({
            id,
            kind: kind as ParticleAuthoringNodeKind,
            data: canonicalRecord(data),
            ...(nodeMetadata === undefined ? {} : { metadata: canonicalRecord(nodeMetadata) })
        });
        nodes.set(id, node);
        nodeList.push(node);
    }

    const edges: Readonly<ParticleAuthoringEdge>[] = [];
    const edgeIds = new Set<string>();
    const ownedSources = new Set<string>();
    for (let index = 0; index < rawEdges.length; index += 1) {
        const rawEdge = rawEdges[index];
        const path = `/edges/${String(index)}`;
        if (!isRecord(rawEdge)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.type',
                    'Authoring edge must be a plain object',
                    path
                )
            );
            continue;
        }
        for (const key of unknownKeys(rawEdge, EDGE_KEYS)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.unknown-field',
                    `Unknown authoring edge field ${key}`,
                    `${path}/${key}`
                )
            );
        }
        const id = rawEdge['id'];
        const from = rawEdge['from'];
        const to = rawEdge['to'];
        const port = rawEdge['port'];
        const order = rawEdge['order'];
        if (typeof id !== 'string' || !ID_PATTERN.test(id) || edgeIds.has(id)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.id',
                    'Authoring edge id is invalid or duplicated',
                    `${path}/id`
                )
            );
            continue;
        }
        edgeIds.add(id);
        if (
            typeof from !== 'string' ||
            typeof to !== 'string' ||
            !nodes.has(from) ||
            !nodes.has(to)
        ) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.endpoint',
                    `Authoring edge ${id} has a missing endpoint`,
                    path
                )
            );
            continue;
        }
        if (typeof port !== 'string' || !PORTS.has(port as ParticleAuthoringPort)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.port',
                    `Authoring edge ${id} has an invalid port`,
                    `${path}/port`,
                    from
                )
            );
            continue;
        }
        if (!Number.isSafeInteger(order) || (order as number) < 0) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.order',
                    `Authoring edge ${id} order is invalid`,
                    `${path}/order`,
                    from
                )
            );
            continue;
        }
        if (ownedSources.has(from)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.multiple-owners',
                    `Authoring node ${from} has multiple owners`,
                    path,
                    from
                )
            );
            continue;
        }
        const sourceNode = nodes.get(from);
        const targetNode = nodes.get(to);
        const validTopology =
            (port === 'emitters' &&
                sourceNode?.kind === 'emitter' &&
                targetNode?.kind === 'system') ||
            (port === 'modules' &&
                sourceNode?.kind === 'module' &&
                targetNode?.kind === 'emitter') ||
            (port === 'renderers' &&
                sourceNode?.kind === 'renderer' &&
                targetNode?.kind === 'emitter');
        if (!validTopology) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.topology',
                    `Authoring edge ${id} violates fixed ownership topology`,
                    path,
                    from
                )
            );
            continue;
        }
        ownedSources.add(from);
        edges.push(
            Object.freeze({
                id,
                from,
                to,
                port,
                order: order as number
            })
        );
    }

    const systems = nodeList.filter(node => node.kind === 'system');
    if (systems.length !== 1) {
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.system.count',
                'Authoring graph requires exactly one system node',
                '/nodes'
            )
        );
    }
    for (const node of nodeList) {
        if (node.kind === 'system') {
            if (Object.keys(node.data).length !== 0)
                diagnostics.push(
                    diagnostic(
                        'error',
                        'authoring.system.data',
                        'System node data must be empty',
                        `/nodes/${node.id}/data`,
                        node.id
                    )
                );
        } else if (!ownedSources.has(node.id)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.unowned',
                    `Authoring node ${node.id} has no owner`,
                    `/nodes/${node.id}`,
                    node.id
                )
            );
        }
        if (node.kind === 'emitter' && ('modules' in node.data || 'renderers' in node.data)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.emitter.inline-topology',
                    'Emitter topology must be represented by edges',
                    `/nodes/${node.id}/data`,
                    node.id
                )
            );
        }
        if (
            (node.kind === 'module' || node.kind === 'renderer') &&
            typeof node.data['type'] !== 'string'
        ) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.node.payload-type',
                    `${node.kind} node ${node.id} requires data.type`,
                    `/nodes/${node.id}/data/type`,
                    node.id
                )
            );
        }
    }
    const groups = new Map<string, number[]>();
    for (const edge of edges) {
        const key = `${edge.to}:${edge.port}`;
        const orders = groups.get(key) ?? [];
        orders.push(edge.order);
        groups.set(key, orders);
    }
    for (const [key, orders] of groups) {
        orders.sort((left, right) => left - right);
        if (orders.some((value, index) => value !== index)) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'authoring.edge.order-gap',
                    `Ownership orders for ${key} must be contiguous from zero`,
                    '/edges'
                )
            );
        }
    }
    if (diagnostics.some(item => item.severity === 'error') || systems[0] === undefined)
        return null;
    const graph: Readonly<ParticleAuthoringGraph> = Object.freeze({
        schema: PARTICLE_AUTHORING_SCHEMA,
        version: PARTICLE_AUTHORING_VERSION,
        definitionSchema: PARTICLE_DEFINITION_SCHEMA,
        definitionVersion: PARTICLE_DEFINITION_VERSION,
        parameters: cloneJSON(rawParameters) as readonly ParticleDefinitionJSONParameter[],
        nodes: Object.freeze(nodeList),
        edges: Object.freeze(edges),
        ...(metadata === undefined
            ? {}
            : { metadata: canonicalRecord(metadata as ParticleDefinitionJSONRecord) })
    });
    return { graph, nodes, system: systems[0] };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Validate topology, rebuild the ordinary definition, compile it, and expose normalized IR. */
export function compileParticleAuthoringGraph(
    source: unknown,
    options: Readonly<ParticleAuthoringCompileOptions> = {}
): ParticleAuthoringCompileResult {
    const diagnostics: Readonly<ParticleAuthoringDiagnostic>[] = [];
    const validated = validateGraph(source, diagnostics);
    if (validated === null) {
        return Object.freeze({ success: false, diagnostics: Object.freeze(diagnostics) });
    }
    const orderedChildren = (
        target: string,
        port: ParticleAuthoringPort
    ): readonly Readonly<ParticleAuthoringNode>[] =>
        validated.graph.edges
            .filter(edge => edge.to === target && edge.port === port)
            .sort((left, right) => left.order - right.order)
            .map(edge => validated.nodes.get(edge.from))
            .filter((node): node is Readonly<ParticleAuthoringNode> => node !== undefined);
    const emitterNodes = orderedChildren(validated.system.id, 'emitters');
    const emitters = emitterNodes.map(emitterNode => {
        const modules = orderedChildren(emitterNode.id, 'modules').map(node => node.data);
        const renderers = orderedChildren(emitterNode.id, 'renderers').map(node => node.data);
        return canonicalRecord({ ...emitterNode.data, modules, renderers });
    });
    const definitionJSON: Readonly<ParticleSystemDefinitionJSON> = Object.freeze({
        schema: PARTICLE_DEFINITION_SCHEMA,
        version: PARTICLE_DEFINITION_VERSION,
        parameters: validated.graph.parameters,
        emitters: Object.freeze(emitters)
    });
    let definition: ParticleSystemDefinition;
    let compiledPlan: Readonly<ParticleCompiledPlan>;
    try {
        definition = deserializeParticleSystemDefinition(definitionJSON, {
            ...(options.resolveResource === undefined
                ? {}
                : { resolveResource: options.resolveResource }),
            ...(options.upgrades === undefined ? {} : { upgrades: options.upgrades }),
            ...(options.compilationEnvironment === undefined
                ? {}
                : { compilationEnvironment: options.compilationEnvironment })
        });
        compiledPlan = compileParticleSystemDefinition(definition, options.compilationEnvironment);
    } catch (error) {
        const message = errorMessage(error);
        const emitterMatch = /emitters?\[(\d+)\]/u.exec(message);
        const emitterIndex = emitterMatch?.[1] === undefined ? -1 : Number(emitterMatch[1]);
        const namedEmitter = emitterNodes.find(node => {
            const name = node.data['name'];
            return typeof name === 'string' && message.includes(name);
        });
        const emitterNode = emitterNodes[emitterIndex] ?? namedEmitter;
        let errorNode = emitterNode;
        if (emitterNode !== undefined) {
            const moduleMatch = /modules?\[(\d+)\]/u.exec(message);
            const rendererMatch = /renderers?\[(\d+)\]/u.exec(message);
            if (moduleMatch?.[1] !== undefined) {
                errorNode = orderedChildren(emitterNode.id, 'modules')[Number(moduleMatch[1])];
            } else if (rendererMatch?.[1] !== undefined) {
                errorNode = orderedChildren(emitterNode.id, 'renderers')[Number(rendererMatch[1])];
            }
        }
        diagnostics.push(
            diagnostic(
                'error',
                'authoring.definition.compile',
                message,
                errorNode === undefined ? '/nodes' : `/nodes/${errorNode.id}/data`,
                errorNode?.id
            )
        );
        return Object.freeze({ success: false, diagnostics: Object.freeze(diagnostics) });
    }
    const emitterIR = compiledPlan.emitters.map((plan, index) => {
        const emitterNode = emitterNodes[index];
        if (emitterNode === undefined)
            throw new Error('Compiled authoring emitter node is unavailable');
        const moduleNodeIds = orderedChildren(emitterNode.id, 'modules').map(node => node.id);
        const rendererNodeIds = orderedChildren(emitterNode.id, 'renderers').map(node => node.id);
        if (plan.statelessDiagnostics.length > 0 && plan.definition.execution === 'auto') {
            diagnostics.push(
                diagnostic(
                    'info',
                    'authoring.stateless.ineligible',
                    `Emitter ${plan.definition.name} uses a stateful plan: ${plan.statelessDiagnostics.join(', ')}`,
                    `/nodes/${emitterNode.id}`,
                    emitterNode.id
                )
            );
        }
        return Object.freeze({
            nodeId: emitterNode.id,
            name: plan.definition.name,
            emitterId: plan.emitterId,
            planKind: plan.kind,
            layoutHash: plan.layoutHash,
            attributes: plan.attributes,
            moduleNodeIds: Object.freeze(moduleNodeIds),
            rendererNodeIds: Object.freeze(rendererNodeIds),
            statelessEligible: plan.statelessEligible,
            statelessDiagnostics: plan.statelessDiagnostics
        });
    });
    const ir: Readonly<ParticleAuthoringIR> = Object.freeze({
        schema: PARTICLE_AUTHORING_SCHEMA,
        version: PARTICLE_AUTHORING_VERSION,
        systemNodeId: validated.system.id,
        definitionJSON,
        definitionHash: definition.hash,
        compiledPlanHash: compiledPlan.hash,
        emitters: Object.freeze(emitterIR)
    });
    return Object.freeze({
        success: true,
        diagnostics: Object.freeze(diagnostics),
        graph: validated.graph,
        ir,
        definition,
        compiledPlan
    });
}
