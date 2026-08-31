import { describe, expect, it } from 'vitest';
import {
    compileParticleAuthoringGraph,
    createParticleAuthoringGraph,
    PARTICLE_AUTHORING_JSON_SCHEMA,
    PARTICLE_AUTHORING_SCHEMA,
    PARTICLE_AUTHORING_VERSION,
    type ParticleAuthoringGraph
} from '../../../addon-particle/src/ParticleAuthoring';
import {
    PARTICLE_PREVIEW_PROTOCOL_VERSION,
    ParticleAuthoringPreviewController
} from '../../../addon-particle/src/ParticleAuthoringPreview';
import { ParticleParameter } from '../../../addon-particle/src/ParticleParameter';
import ParticleSystemDefinition from '../../../addon-particle/src/ParticleSystemDefinition';

function definition(): ParticleSystemDefinition {
    const shared = new ParticleParameter('authoring.shared', 'float', 4);
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'authoring-main',
                capacity: 32,
                execution: 'cpu',
                duration: 3,
                looping: true,
                fixedStep: 1 / 60,
                bounds: { mode: 'manual', min: [-4, -4, -4], max: [4, 4, 4] },
                emission: { rateOverTime: shared },
                initialize: { lifetime: 1, size: shared },
                modules: [{ type: 'drag', coefficient: 0.2 }],
                renderers: [{ type: 'sprite' }]
            }
        ]
    });
}

interface MutableGraphNode {
    id: string;
    kind: string;
    data: Record<string, unknown>;
}

interface MutableGraphEdge {
    id: string;
    from: string;
    to: string;
    port: string;
    order: number;
}

interface MutableGraph {
    schema: string;
    version: number;
    definitionSchema: string;
    definitionVersion: number;
    parameters: unknown[];
    nodes: MutableGraphNode[];
    edges: MutableGraphEdge[];
    metadata?: Record<string, unknown>;
    extra?: unknown;
}

function mutableGraph(graph: Readonly<ParticleAuthoringGraph>): MutableGraph {
    return JSON.parse(JSON.stringify(graph)) as MutableGraph;
}

describe('particle P6 external authoring and preview', () => {
    it('round-trips a deterministic fixed-module graph into normalized runtime IR', () => {
        const source = definition();
        const graph = createParticleAuthoringGraph(source);

        expect(graph).toMatchObject({
            schema: PARTICLE_AUTHORING_SCHEMA,
            version: PARTICLE_AUTHORING_VERSION,
            definitionSchema: 'hilo3d.particle-system',
            definitionVersion: 1
        });
        expect(graph.nodes.map(node => node.kind)).toEqual([
            'system',
            'emitter',
            'module',
            'renderer'
        ]);
        expect(graph.edges.map(edge => edge.port)).toEqual(['emitters', 'modules', 'renderers']);
        expect(Object.isFrozen(graph)).toBe(true);
        expect(Object.isFrozen(PARTICLE_AUTHORING_JSON_SCHEMA)).toBe(true);
        expect(Object.isFrozen(PARTICLE_AUTHORING_JSON_SCHEMA['properties'])).toBe(true);

        const editable = mutableGraph(graph);
        editable.nodes.reverse();
        editable.edges.reverse();
        editable.metadata = { viewport: { x: 10, y: 20 }, editor: 'external' };
        const result = compileParticleAuthoringGraph(editable);

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('Expected authoring compilation success');
        expect(result.definition.hash).toBe(source.hash);
        expect(result.compiledPlan.hash).toBe(result.ir.compiledPlanHash);
        expect(result.ir.definitionHash).toBe(source.hash);
        expect(result.ir.systemNodeId).toBe('system');
        expect(result.ir.emitters[0]).toMatchObject({
            nodeId: 'emitter:0',
            name: 'authoring-main',
            planKind: 'cpu-stateful',
            moduleNodeIds: ['emitter:0:module:0'],
            rendererNodeIds: ['emitter:0:renderer:0']
        });
        expect(result.graph.metadata).toEqual(editable.metadata);
        const emitter = result.definition.emitters[0];
        expect(emitter).toBeDefined();
        if (emitter === undefined) throw new Error('Expected compiled emitter');
        expect(emitter.emission.rateOverTime).toBe(emitter.initialize.size);
    });

    it('returns addressable diagnostics for graph topology and definition payload failures', () => {
        const topology = mutableGraph(createParticleAuthoringGraph(definition()));
        const moduleEdge = topology.edges.find(edge => edge.port === 'modules');
        expect(moduleEdge).toBeDefined();
        if (moduleEdge === undefined) throw new Error('Expected module edge');
        moduleEdge.order = 2;
        topology.nodes.push({ ...topology.nodes[1], id: 'emitter:duplicate' } as MutableGraphNode);
        topology.extra = true;
        const topologyResult = compileParticleAuthoringGraph(topology);
        expect(topologyResult.success).toBe(false);
        expect(topologyResult.diagnostics.map(item => item.code)).toEqual(
            expect.arrayContaining([
                'authoring.document.unknown-field',
                'authoring.node.unowned',
                'authoring.edge.order-gap'
            ])
        );

        const payload = mutableGraph(createParticleAuthoringGraph(definition()));
        const moduleNode = payload.nodes.find(node => node.kind === 'module');
        expect(moduleNode).toBeDefined();
        if (moduleNode === undefined) throw new Error('Expected module node');
        moduleNode.data = { type: 'drag', coefficient: -1 };
        const payloadResult = compileParticleAuthoringGraph(payload);
        expect(payloadResult.success).toBe(false);
        expect(payloadResult.diagnostics[0]).toMatchObject({
            code: 'authoring.definition.compile',
            nodeId: moduleNode.id,
            path: `/nodes/${moduleNode.id}/data`
        });
    });

    it('uses the requested backend when materializing explicit GPU authoring graphs', () => {
        const gpu = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'authoring-gpu',
                    capacity: 64,
                    execution: 'gpu',
                    bounds: { mode: 'manual', min: [-1, -1, -1], max: [1, 1, 1] },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const graph = createParticleAuthoringGraph(gpu);
        const webgl2 = compileParticleAuthoringGraph(graph, {
            compilationEnvironment: { backend: 'webgl2' }
        });
        expect(webgl2.success).toBe(false);
        const webgpu = compileParticleAuthoringGraph(graph, {
            compilationEnvironment: { backend: 'webgpu' }
        });
        expect(webgpu.success).toBe(true);
        if (!webgpu.success) throw new Error('Expected WebGPU authoring compilation success');
        expect(webgpu.ir.emitters[0]?.planKind).toBe('gpu-stateful');
    });

    it('drives deterministic compile, seek, step, inspect, and lifecycle preview commands', () => {
        const disposed: string[] = [];
        const controller = new ParticleAuthoringPreviewController({
            disposeSystem: system => disposed.push(system.definition.hash)
        });
        const graph = createParticleAuthoringGraph(definition());
        const compile = controller.handle({
            protocolVersion: PARTICLE_PREVIEW_PROTOCOL_VERSION,
            requestId: 'compile-1',
            command: 'compile',
            graph,
            seed: 42
        });
        expect(compile).toMatchObject({
            success: true,
            command: 'compile',
            state: { status: 'ready', seed: 42, timeSeconds: 0 }
        });
        expect(compile.ir?.definitionHash).toBe(definition().hash);
        expect(controller.system).not.toBeNull();

        const firstStep = controller.handle({
            protocolVersion: 1,
            requestId: 'step-1',
            command: 'step',
            deltaSeconds: 0.5
        });
        expect(firstStep.success).toBe(true);
        expect(firstStep.state.timeSeconds).toBe(0.5);
        const firstHash = firstStep.state.stateHash;

        const seek = controller.handle({
            protocolVersion: 1,
            requestId: 'seek-0',
            command: 'seek',
            timeSeconds: 0
        });
        expect(seek.state.timeSeconds).toBe(0);
        const replay = controller.handle({
            protocolVersion: 1,
            requestId: 'step-2',
            command: 'step',
            deltaSeconds: 0.5
        });
        expect(replay.state.stateHash).toBe(firstHash);

        expect(
            controller.handle({
                protocolVersion: 1,
                requestId: 'play',
                command: 'play'
            }).state.status
        ).toBe('playing');
        expect(
            controller.handle({
                protocolVersion: 1,
                requestId: 'pause',
                command: 'pause'
            }).state.status
        ).toBe('ready');
        const invalid = controller.handle({
            protocolVersion: 2,
            requestId: 'bad-version',
            command: 'inspect'
        });
        expect(invalid).toMatchObject({
            success: false,
            diagnostics: [{ code: 'preview.request.version', path: '/protocolVersion' }]
        });

        const dispose = controller.handle({
            protocolVersion: 1,
            requestId: 'dispose',
            command: 'dispose'
        });
        expect(dispose.state.status).toBe('disposed');
        expect(disposed).toEqual([definition().hash]);
        expect(controller.system).toBeNull();
        expect(
            controller.handle({
                protocolVersion: 1,
                requestId: 'after-dispose',
                command: 'inspect'
            }).diagnostics[0]?.code
        ).toBe('preview.disposed');
    });

    it('keeps the previous preview alive when a replacement graph fails compilation', () => {
        const controller = new ParticleAuthoringPreviewController();
        const graph = createParticleAuthoringGraph(definition());
        const first = controller.handle({
            protocolVersion: 1,
            requestId: 'compile-good',
            command: 'compile',
            graph
        });
        expect(first.success).toBe(true);
        const previous = controller.system;
        const invalid = mutableGraph(graph);
        invalid.edges.length = 0;
        const failed = controller.handle({
            protocolVersion: 1,
            requestId: 'compile-bad',
            command: 'compile',
            graph: invalid
        });
        expect(failed.success).toBe(false);
        expect(failed.diagnostics.some(item => item.severity === 'error')).toBe(true);
        expect(controller.system).toBe(previous);
    });
});
