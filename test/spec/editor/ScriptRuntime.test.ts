import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultScene } from '../../../editor/scene';
import { ScriptRuntime } from '../../../editor/script-runtime';
import { createScript, validateScript } from '../../../editor/script-types';

let runtime: ScriptRuntime | undefined;
afterEach(() => {
    runtime?.dispose();
    runtime = undefined;
});
function setup(source?: string): {
    scene: ReturnType<typeof createDefaultScene>;
    scripts: Record<string, ReturnType<typeof createScript>>;
} {
    const scene = createDefaultScene();
    const node = scene.nodes['hero-sphere'];
    if (!node) throw new Error('Missing node');
    node.scripts = ['rotate'];
    const script = createScript('rotate');
    if (source) script.source = source;
    return { scene, scripts: { rotate: script } };
}
describe('isolated script execution', () => {
    it('executes lifecycle code against bound objects without mutating authored data', async () => {
        const logs: string[] = [];
        runtime = new ScriptRuntime(message => {
            logs.push(message);
        });
        const { scene, scripts } = setup();
        const authored = JSON.stringify(scene);
        await runtime.start(scene, scripts);
        const result = await runtime.step(scene, 0.1, 0.1);
        expect(result['hero-sphere']?.rotation.y).toBe(3);
        expect(Object.keys(result)).toEqual(['hero-sphere']);
        expect(JSON.stringify(scene)).toBe(authored);
        expect(logs[0]).toContain('Started');
        await runtime.stop(scene);
    });
    it('accepts a conventional trailing semicolon on a lifecycle expression', async () => {
        runtime = new ScriptRuntime();
        const { scene, scripts } = setup('({ update(ctx) { ctx.rotate(0, 1, 0); } });');
        await runtime.start(scene, scripts);
        expect((await runtime.step(scene, 0.1, 0.1))['hero-sphere']?.rotation.y).toBe(1);
    });

    it('denies DOM/storage authority and reports script exceptions', async () => {
        runtime = new ScriptRuntime();
        const { scene, scripts } = setup(
            '({ update(ctx) { if(typeof document !== "undefined" || typeof localStorage !== "undefined") throw new Error("ambient authority"); throw new Error("author error"); } })'
        );
        await runtime.start(scene, scripts);
        await expect(runtime.step(scene, 0.1, 0.1)).rejects.toThrow('author error');
    });
    it('interrupts non-yielding scripts without hanging the editor thread', async () => {
        runtime = new ScriptRuntime();
        const { scene, scripts } = setup('({ update() { while(true) {} } })');
        await runtime.start(scene, scripts);
        const started = performance.now();
        await expect(runtime.step(scene, 0.1, 0.1)).rejects.toThrow('execution budget');
        expect(performance.now() - started).toBeLessThan(2000);
        await expect(runtime.step(scene, 0.1, 0.2)).rejects.toThrow('not running');
    });
    it('validates output and script source bounds before accepting project edits', async () => {
        expect(() =>
            validateScript({ ...createScript('test'), source: 'a'.repeat(65537) })
        ).toThrow('64 KiB');
        runtime = new ScriptRuntime();
        const { scene, scripts } = setup('({ update(ctx) { ctx.setPosition(Infinity, 0, 0); } })');
        await runtime.start(scene, scripts);
        await expect(runtime.step(scene, 0.1, 0.1)).rejects.toThrow('out-of-range');
    });
});

describe('bounded script component commands', () => {
    it('returns owned commands without rewriting dynamic body transforms', async () => {
        const { defaultPhysicsComponent, defaultParticleComponent, defaultAudioComponent } =
            await import('../../../editor/components');
        runtime = new ScriptRuntime();
        const { scene, scripts } = setup(
            '({ update(ctx) { ctx.applyImpulse(0, 2, 0); ctx.emitParticles(12); ctx.playAudio(); ctx.stopAudio(); } })'
        );
        const node = scene.nodes['hero-sphere'];
        if (!node) throw new Error('Missing fixture');
        node.components = {
            physics: defaultPhysicsComponent(),
            particles: defaultParticleComponent(),
            audio: defaultAudioComponent('sound')
        };
        await runtime.start(scene, scripts);
        expect(await runtime.step(scene, 1 / 60, 1 / 60)).toEqual({});
        expect(runtime.takeCommands()).toEqual([
            { nodeId: 'hero-sphere', type: 'applyImpulse', x: 0, y: 2, z: 0 },
            { nodeId: 'hero-sphere', type: 'emitParticles', count: 12 },
            { nodeId: 'hero-sphere', type: 'playAudio' },
            { nodeId: 'hero-sphere', type: 'stopAudio' }
        ]);
        expect(runtime.takeCommands()).toEqual([]);
    });

    it('rejects component absence, excessive command batches and dynamic transform mutation', async () => {
        const { defaultPhysicsComponent, defaultParticleComponent } =
            await import('../../../editor/components');
        for (const [source, expected] of [
            ['({ update(ctx) { ctx.playAudio(); } })', 'requires an audio'],
            ['({ update(ctx) { for(let i=0;i<129;i++) ctx.emitParticles(1); } })', '128 component'],
            ['({ update(ctx) { ctx.translate(0,1,0); } })', 'simulation-owned']
        ]) {
            runtime = new ScriptRuntime();
            const { scene, scripts } = setup(source);
            const node = scene.nodes['hero-sphere'];
            if (!node) throw new Error('Missing fixture');
            node.components = {
                physics: defaultPhysicsComponent(),
                particles: defaultParticleComponent()
            };
            await runtime.start(scene, scripts);
            await expect(runtime.step(scene, 1 / 60, 1 / 60)).rejects.toThrow(expected);
            runtime.dispose();
        }
    });

    it('validates untrusted command node IDs and finite payloads on the host', async () => {
        const { validateScriptCommands } = await import('../../../editor/script-types');
        const { defaultPhysicsComponent } = await import('../../../editor/components');
        const scene = createDefaultScene();
        const node = scene.nodes['hero-sphere'];
        if (!node) throw new Error('Missing fixture');
        node.components = { physics: defaultPhysicsComponent() };
        const ids = new Set(['hero-sphere']);
        expect(() =>
            validateScriptCommands([{ nodeId: 'ground', type: 'stopAudio' }], scene, ids)
        ).toThrow('unbound');
        expect(() =>
            validateScriptCommands(
                [{ nodeId: 'hero-sphere', type: 'applyImpulse', x: Infinity, y: 0, z: 0 }],
                scene,
                ids
            )
        ).toThrow('finite');
        expect(() =>
            validateScriptCommands(
                [{ nodeId: 'hero-sphere', type: 'applyImpulse', x: 0, y: 0, z: 0, handle: 2 }],
                scene,
                ids
            )
        ).toThrow('Unknown');
    });
});
