import { describe, expect, it } from 'vitest';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import ParticleCurve from '../../../src/particle/ParticleCurve';
import {
    deserializeParticleSystemDefinition,
    parseParticleSystemDefinitionJSON,
    PARTICLE_DEFINITION_SCHEMA,
    serializeParticleSystemDefinition,
    type ParticleDefinitionJSONRecord
} from '../../../src/particle/ParticleDefinitionSerialization';
import ParticleGradient from '../../../src/particle/ParticleGradient';
import { ParticleParameter } from '../../../src/particle/ParticleParameter';
import ParticleSystemDefinition from '../../../src/particle/ParticleSystemDefinition';
import Texture from '../../../src/texture/Texture';

function simpleDefinition(): ParticleSystemDefinition {
    return ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'simple',
                capacity: 8,
                execution: 'cpu',
                renderers: [{ type: 'sprite' }]
            }
        ]
    });
}

describe('ParticleSystemDefinition JSON serialization', () => {
    it('round-trips normalized definitions, shared parameter identity, and resource references', () => {
        const geometry = new BoxGeometry();
        const texture = new Texture();
        const sharedScalar = new ParticleParameter('shared.scalar', 'float', 2);
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'round-trip',
                    capacity: 32,
                    execution: 'cpu',
                    bounds: { mode: 'manual', min: [-4, -4, -4], max: [4, 4, 4] },
                    emission: { rateOverTime: sharedScalar },
                    initialize: { lifetime: 2, size: sharedScalar, meshIndex: 0 },
                    modules: [
                        {
                            type: 'size-over-lifetime',
                            curve: new ParticleCurve(
                                [
                                    { time: 0, value: 0 },
                                    { time: 1, value: 1 }
                                ],
                                { wrap: 'loop', interpolation: 'smooth' }
                            )
                        },
                        {
                            type: 'color-over-lifetime',
                            gradient: new ParticleGradient([
                                { time: 0, color: [1, 1, 1, 1] },
                                { time: 1, color: [1, 0, 0, 0] }
                            ])
                        }
                    ],
                    renderers: [
                        {
                            type: 'mesh',
                            meshes: [{ geometry, texture }],
                            coverage: 'opaque'
                        }
                    ]
                }
            ]
        });

        const serialized = serializeParticleSystemDefinition(definition, {
            getResourceId: (_resource, kind) =>
                kind === 'geometry' ? 'geometry/box' : 'texture/particle'
        });
        const decoded = parseParticleSystemDefinitionJSON(JSON.stringify(serialized), {
            resolveResource: (kind, id) => {
                expect(id).toBe(kind === 'geometry' ? 'geometry/box' : 'texture/particle');
                return kind === 'geometry' ? geometry : texture;
            }
        });

        expect(serialized).toMatchObject({
            schema: PARTICLE_DEFINITION_SCHEMA,
            version: 1,
            parameters: [{ id: 'p0', name: 'shared.scalar', type: 'float' }]
        });
        expect(Object.isFrozen(serialized)).toBe(true);
        expect(Object.isFrozen(serialized.emitters)).toBe(true);
        expect(decoded.hash).toBe(definition.hash);
        const emitter = decoded.emitters[0];
        expect(emitter?.emission.rateOverTime).toBe(emitter?.initialize.size);
        expect(emitter?.modules[0]?.type).toBe('size-over-lifetime');
        if (emitter?.modules[0]?.type !== 'size-over-lifetime') {
            throw new Error('Expected decoded curve module');
        }
        expect(emitter.modules[0].curve).toBeInstanceOf(ParticleCurve);
        if (emitter.renderers[0]?.type !== 'mesh') throw new Error('Expected decoded mesh');
        expect(emitter.renderers[0].meshes[0]?.geometry).toBe(geometry);
        expect(emitter.renderers[0].meshes[0]?.texture).toBe(texture);
    });

    it('requires explicit resource codecs and rejects unknown schema fields and tags', () => {
        const texture = new Texture();
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'resource',
                    capacity: 4,
                    renderers: [{ type: 'sprite', texture }]
                }
            ]
        });
        expect(() => serializeParticleSystemDefinition(definition)).toThrow(/getResourceId/u);

        const duplicateResourceIds = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'duplicate-resources',
                    capacity: 4,
                    renderers: [
                        { type: 'sprite', texture },
                        { type: 'sprite', texture: new Texture() }
                    ]
                }
            ]
        });
        expect(() =>
            serializeParticleSystemDefinition(duplicateResourceIds, {
                getResourceId: () => 'texture/duplicate'
            })
        ).toThrow(/refers to multiple objects/u);

        const serialized = serializeParticleSystemDefinition(definition, {
            getResourceId: () => 'texture/resource'
        });
        expect(() => deserializeParticleSystemDefinition(serialized)).toThrow(/resolveResource/u);
        expect(() =>
            deserializeParticleSystemDefinition(serialized, {
                resolveResource: () => new BoxGeometry()
            })
        ).toThrow(/wrong object type/u);

        const unknownField = JSON.parse(JSON.stringify(serialized)) as {
            emitters: Record<string, unknown>[];
        };
        const firstEmitter = unknownField.emitters[0];
        if (!firstEmitter) throw new Error('Expected serialized emitter');
        firstEmitter['unexpected'] = true;
        expect(() =>
            deserializeParticleSystemDefinition(unknownField, {
                resolveResource: () => texture
            })
        ).toThrow(/unexpected is not part of the schema/u);

        const unknownNestedField = JSON.parse(JSON.stringify(serialized)) as {
            emitters: { emission: Record<string, unknown> }[];
        };
        const nestedEmission = unknownNestedField.emitters[0]?.emission;
        if (!nestedEmission) throw new Error('Expected serialized emission');
        nestedEmission['unexpected'] = true;
        expect(() =>
            deserializeParticleSystemDefinition(unknownNestedField, {
                resolveResource: () => texture
            })
        ).toThrow(/emission.unexpected is not part of the schema/u);

        const unknownTag = JSON.parse(JSON.stringify(serialized)) as {
            emitters: { renderers: { texture: { $type: string } }[] }[];
        };
        const taggedTexture = unknownTag.emitters[0]?.renderers[0]?.texture;
        if (!taggedTexture) throw new Error('Expected serialized texture tag');
        taggedTexture.$type = 'native-texture';
        expect(() => deserializeParticleSystemDefinition(unknownTag)).toThrow(
            /unknown tagged value/u
        );
    });

    it('applies sequential upgrades and rejects missing or invalid version transitions', () => {
        const current = serializeParticleSystemDefinition(simpleDefinition());
        const legacy: ParticleDefinitionJSONRecord = Object.freeze({
            schema: PARTICLE_DEFINITION_SCHEMA,
            version: 0,
            emitters: current.emitters
        });
        const upgrade = {
            fromVersion: 0,
            upgrade: (document: Readonly<ParticleDefinitionJSONRecord>) => ({
                ...document,
                version: 1,
                parameters: []
            })
        };

        expect(deserializeParticleSystemDefinition(legacy, { upgrades: [upgrade] }).hash).toBe(
            simpleDefinition().hash
        );
        expect(() => deserializeParticleSystemDefinition(legacy)).toThrow(
            /no upgrade from version 0/u
        );
        expect(() =>
            deserializeParticleSystemDefinition(legacy, {
                upgrades: [
                    {
                        fromVersion: 0,
                        upgrade: document => ({ ...document, version: 2 })
                    }
                ]
            })
        ).toThrow(/must produce version 1/u);
        expect(() => deserializeParticleSystemDefinition({ ...current, version: 2 })).toThrow(
            /newer than supported/u
        );
    });

    it('rejects malformed JSON and unknown parameter references before compilation', () => {
        expect(() => parseParticleSystemDefinitionJSON('{')).toThrow(SyntaxError);
        const serialized = serializeParticleSystemDefinition(simpleDefinition());
        const malformed = JSON.parse(JSON.stringify(serialized)) as {
            emitters: { emission: { rateOverTime?: unknown } }[];
        };
        const emitter = malformed.emitters[0];
        if (!emitter) throw new Error('Expected serialized emitter');
        emitter.emission.rateOverTime = { $type: 'parameter', id: 'missing' };
        expect(() => deserializeParticleSystemDefinition(malformed)).toThrow(
            /unknown parameter missing/u
        );
    });

    it('validates materialized definitions against the requested backend', () => {
        const gpu = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'serialized-gpu',
                    capacity: 16,
                    execution: 'gpu',
                    bounds: { mode: 'manual', min: [-1, -1, -1], max: [1, 1, 1] },
                    renderers: [{ type: 'sprite' }]
                }
            ]
        });
        const serialized = serializeParticleSystemDefinition(gpu);

        expect(() =>
            deserializeParticleSystemDefinition(serialized, {
                compilationEnvironment: { backend: 'webgl2' }
            })
        ).toThrow(/requires WebGPU/u);
        expect(
            deserializeParticleSystemDefinition(serialized, {
                compilationEnvironment: { backend: 'webgpu' }
            }).hash
        ).toBe(gpu.hash);
    });
});
