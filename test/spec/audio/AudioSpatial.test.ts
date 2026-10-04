import { afterEach, describe, expect, it } from 'vitest';
import { type AudioEngine, HiloAudioTransform, type AudioPose } from '@hilo/addon-audio';
import { Node } from 'hilo3d';
import { fixture, rms } from './helpers';

const engines: AudioEngine[] = [];
afterEach(() => {
    for (const audio of engines) audio.destroy();
    engines.length = 0;
});

describe('spatial game audio', () => {
    it('recovers fully silent occlusion and applies listener orientation to real stereo output', async () => {
        let blocked = true;
        const { context, audio, clip } = fixture(0.3, {
            occludedGain: 0,
            occlusionIntervalSeconds: 0.01,
            queryOcclusion: () => (blocked ? 1 : 0)
        });
        engines.push(audio);
        const voice = audio.play(clip, {
            spatial: { position: { x: 1, y: 0, z: 0 }, panningModel: 'equalpower', occlusion: true }
        });
        expect(voice?.state).toBe('virtual');
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        blocked = false;
        audio.setListener({ forward: { x: 0, y: 0, z: 1 } });
        audio.update();
        expect(voice?.state).toBe('playing');
        await context.resume();
        const output = await rendering;
        expect(rms(output, 0, 0, 0.09)).toBe(0);
        expect(rms(output, 0, 0.15, 0.25)).toBeGreaterThan(0.2);
        expect(rms(output, 1, 0.15, 0.25)).toBeLessThan(1e-5);
    });

    it('renders directional stereo and moves a source from right to left', async () => {
        const { context, audio, clip } = fixture(0.3);
        engines.push(audio);
        const voice = audio.play(clip, {
            spatial: { position: { x: 2, y: 0, z: 0 }, refDistance: 5, panningModel: 'equalpower' }
        });
        const at = context.suspend(0.15);
        const rendering = context.startRendering();
        await at;
        voice?.setPosition({ x: -2, y: 0, z: 0 });
        audio.update();
        await context.resume();
        const output = await rendering;
        expect(rms(output, 1, 0.02, 0.1)).toBeGreaterThan(0.2);
        expect(rms(output, 0, 0.02, 0.1)).toBeLessThan(1e-5);
        expect(rms(output, 0, 0.2, 0.28)).toBeGreaterThan(0.2);
        expect(rms(output, 1, 0.2, 0.28)).toBeLessThan(1e-5);
    });

    it('uses the documented inverse attenuation and directional cone without double attenuation', async () => {
        const { context, audio, clip } = fixture(0.1);
        engines.push(audio);
        audio.play(clip, {
            spatial: {
                position: { x: 4, y: 0, z: 0 },
                forward: { x: 1, y: 0, z: 0 },
                refDistance: 1,
                coneInnerAngle: 60,
                coneOuterAngle: 120,
                coneOuterGain: 0.5,
                panningModel: 'equalpower'
            }
        });
        const output = await context.startRendering();
        expect(rms(output, 1, 0.01, 0.09)).toBeCloseTo(0.25 * 0.25 * 0.5, 4);
    });

    it('handles custom curves and reactivates sources after returning inside maxDistance', async () => {
        const { context, audio, clip } = fixture(0.3);
        engines.push(audio);
        const voice = audio.play(clip, {
            spatial: {
                position: { x: 20, y: 0, z: 0 },
                refDistance: 1,
                maxDistance: 9,
                panningModel: 'equalpower',
                rolloffCurve: [
                    { distance: 0, gain: 1 },
                    { distance: 0.5, gain: 0.2 },
                    { distance: 1, gain: 0 }
                ]
            }
        });
        expect(voice?.state).toBe('virtual');
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        voice?.setPosition({ x: 5, y: 0, z: 0 });
        audio.update();
        expect(voice?.state).toBe('playing');
        await context.resume();
        const output = await rendering;
        expect(rms(output, 1, 0, 0.09)).toBe(0);
        expect(rms(output, 1, 0.12, 0.2)).toBeCloseTo(0.05, 4);
    });

    it('advances Doppler pitch from explicit source/listener velocities in meters', async () => {
        const { context, audio, clip } = fixture(0.2, { metersPerUnit: 2 });
        engines.push(audio);
        const voice = audio.play(clip, {
            spatial: {
                position: { x: 10, y: 0, z: 0 },
                velocity: { x: -50, y: 0, z: 0 },
                dopplerFactor: 1
            }
        });
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        expect(voice?.position).toBeCloseTo((context.currentTime * 343) / 243, 5);
        await context.resume();
        await rendering;
    });

    it('budgets occlusion fairly and smooths actual filtered output', async () => {
        let blocked = true;
        const seen = new Set<number>();
        const { context, audio, clip } = fixture(0.3, {
            maxOcclusionQueriesPerUpdate: 2,
            occlusionIntervalSeconds: 0.05,
            occludedGain: 0.25,
            queryOcclusion: (_listener, _source, voice) => {
                seen.add(voice.id);
                return blocked ? 1 : 0;
            }
        });
        engines.push(audio);
        for (let i = 0; i < 6; i++)
            audio.play(clip, {
                when: 0.1,
                spatial: { position: { x: 1, y: 0, z: 0 }, occlusion: true }
            });
        const at = context.suspend(0.1);
        const rendering = context.startRendering();
        await at;
        const before = audio.getDiagnostics().occlusionQueries;
        audio.update();
        expect(audio.getDiagnostics().occlusionQueries - before).toBe(2);
        audio.update();
        audio.update();
        expect(seen.size).toBe(6);
        blocked = false;
        const at2 = context.suspend(0.2);
        await context.resume();
        await at2;
        audio.update();
        audio.update();
        audio.update();
        await context.resume();
        const output = await rendering;
        expect(rms(output, 1, 0.23, 0.28)).toBeGreaterThan(rms(output, 1, 0.14, 0.18) * 2);
    });

    it('samples current hierarchical transforms without updating unrelated world matrices', () => {
        const parent = new Node({ x: 10, y: 2 });
        const child = new Node({ x: 3, z: -4 });
        parent.addChild(child);
        const transform = new HiloAudioTransform(child);
        const target: AudioPose = {
            x: 0,
            y: 0,
            z: 0,
            forwardX: 0,
            forwardY: 0,
            forwardZ: -1,
            upX: 0,
            upY: 1,
            upZ: 0
        };
        transform.readAudioPose(target);
        expect(target.x).toBe(13);
        expect(target.y).toBe(2);
        expect(target.z).toBe(-4);
        parent.x = 20;
        transform.readAudioPose(target);
        expect(target.x).toBe(23);
        expect(parent.worldMatrixVersion).toBe(0);
    });

    it('rejects invalid spatial contracts before touching the live graph', () => {
        const { audio, clip } = fixture();
        engines.push(audio);
        expect(() => audio.play(clip, { spatial: { refDistance: 5, maxDistance: 1 } })).toThrow();
        expect(() => audio.play(clip, { spatial: { forward: { x: 0, y: 0, z: 0 } } })).toThrow();
        expect(() =>
            audio.play(clip, {
                spatial: {
                    rolloffCurve: [
                        { distance: 0, gain: 0 },
                        { distance: 1, gain: 1 }
                    ]
                }
            })
        ).toThrow();
        expect(() => {
            audio.setListener({ forward: { x: 0, y: 1, z: 0 } });
        }).toThrow('parallel');
        expect(audio.getDiagnostics().allocatedVoiceSlots).toBe(0);
    });
});
