import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Renderer from '../../../src/render/Renderer';
import type { RenderTargetColor, RenderTargetStoreOp } from '../../../src/render/RenderTarget';
import type {
    RenderPipeline,
    RenderPipelineContext
} from '../../../src/render/pipeline/RenderPipeline';
import type {
    RenderGraphTextureHandle,
    ScriptableRenderPass
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import { TextureCopyPass } from '../../../src/render/pipeline/passes/TextureCopyPass';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

interface ClearParameters {
    readonly texture: RenderGraphTextureHandle;
    readonly storeOp: RenderTargetStoreOp;
    readonly color: RenderTargetColor;
}

const clear: ScriptableRenderPass<ClearParameters> = {
    name: 'history store policy',
    setup(builder, parameters): void {
        builder.useColorAttachment({
            texture: parameters.texture,
            loadOp: 'clear',
            storeOp: parameters.storeOp,
            clearValue: parameters.color
        });
    },
    execute(): void {
        // The attachment declaration performs the clear.
    }
};
const RED: RenderTargetColor = { r: 1, g: 0, b: 0, a: 1 };
const GREEN: RenderTargetColor = { r: 0, g: 1, b: 0, a: 1 };
const BLUE: RenderTargetColor = { r: 0, g: 0, b: 1, a: 1 };

class HistoryPipeline implements RenderPipeline {
    readonly name = 'history final contents';
    readonly usesRenderGraphTimeline = true;
    readonly key = {};
    readonly copy = new TextureCopyPass();
    readonly valid: boolean[] = [];
    operations: readonly RenderTargetStoreOp[] = ['store'];
    color: RenderTargetColor = RED;
    failRecord = false;
    notificationError: Error | null = null;
    asyncNotificationError: Error | null = null;
    submitted = 0;
    discarded = 0;

    record(context: RenderPipelineContext): void {
        const history = context.graph.acquireHistoryTexture(this.key, {
            format: 'rgba8unorm',
            extent: { width: 4, height: 4 },
            usage: ['sampled', 'attachment', 'copy-source'],
            bufferCount: 3
        });
        this.valid.push(history.valid);
        for (const storeOp of this.operations) {
            context.graph.addPass(clear, { texture: history.current, storeOp, color: this.color });
        }
        const output = context.graph.importOutput().color(0);
        if (history.valid) {
            context.graph.addPass(this.copy, { source: history.history(), destination: output });
        } else {
            context.graph.addPass(clear, { texture: output, storeOp: 'store', color: BLUE });
        }
        if (this.failRecord) throw new Error('record discarded');
    }

    frameSubmitted(): void {
        this.submitted++;
    }
    frameDiscarded(): void {
        this.discarded++;
    }
    recordRenderGraphTimeline(): unknown {
        if (this.notificationError !== null) throw this.notificationError;
        return this.asyncNotificationError === null
            ? undefined
            : Promise.reject(this.asyncNotificationError);
    }
    destroy(): void {
        // All resources are owned by the renderer.
    }
}

describe.each(['webgl2', 'webgpu'] as const)('history submission on %s', backend => {
    it('uses final stored contents and keeps prior history when the current slot is discarded', async () => {
        const pipeline = new HistoryPipeline();
        const renderer = await Renderer.create({
            backend,
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: { name: pipeline.name, create: () => pipeline }
        });
        const target = renderer.createRenderTarget({ width: 4, height: 4 });
        const scene = new Node();
        const camera = new PerspectiveCamera();
        try {
            pipeline.operations = ['discard'];
            renderer.renderToTarget(target, scene, camera);
            pipeline.operations = ['store'];
            pipeline.color = GREEN;
            renderer.renderToTarget(target, scene, camera);
            expect(pipeline.valid).toEqual([false, false]);

            pipeline.operations = ['store', 'discard'];
            pipeline.color = RED;
            renderer.renderToTarget(target, scene, camera);
            expect(Array.from((await target.readColorAttachment()).data.slice(0, 4))).toEqual([
                0, 255, 0, 255
            ]);
            pipeline.operations = ['discard', 'store'];
            renderer.renderToTarget(target, scene, camera);
            expect(Array.from((await target.readColorAttachment()).data.slice(0, 4))).toEqual([
                0, 255, 0, 255
            ]);
            pipeline.operations = [];
            renderer.renderToTarget(target, scene, camera);
            expect(Array.from((await target.readColorAttachment()).data.slice(0, 4))).toEqual([
                255, 0, 0, 255
            ]);
            expect(pipeline.valid).toEqual([false, false, true, true, true]);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    });

    it('commits runtime and history before reporting a post-submission observer exception', async () => {
        const pipeline = new HistoryPipeline();
        const renderer = await Renderer.create({
            backend,
            domElement: document.createElement('canvas'),
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: { name: pipeline.name, create: () => pipeline }
        });
        const target = renderer.createRenderTarget({ width: 4, height: 4 });
        const scene = new Node();
        const camera = new PerspectiveCamera();
        try {
            pipeline.notificationError = new Error('timeline consumer failed');
            expect(() => {
                renderer.renderToTarget(target, scene, camera);
            }).toThrow(pipeline.notificationError);
            await renderer.waitForIdle();
            expect(pipeline.submitted).toBe(1);
            expect(pipeline.discarded).toBe(0);
            pipeline.notificationError = null;
            renderer.renderToTarget(target, scene, camera);
            expect(pipeline.valid).toEqual([false, true]);
            expect(Array.from((await target.readColorAttachment()).data.slice(0, 4))).toEqual([
                255, 0, 0, 255
            ]);

            pipeline.failRecord = true;
            expect(() => {
                renderer.renderToTarget(target, scene, camera);
            }).toThrow('record discarded');
            expect(pipeline.discarded).toBe(1);
            pipeline.failRecord = false;
            renderer.renderToTarget(target, scene, camera);
            expect(pipeline.valid.at(-1)).toBe(true);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    });

    it('observes an async runtime notification even when the diagnostics consumer throws', async () => {
        const pipeline = new HistoryPipeline();
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const diagnosticFailure = new Error('diagnostics consumer failed');
        const runtimeFailure = new Error('runtime async consumer failed');
        const diagnosticCallback = vi
            .spyOn(diagnostics, 'recordRenderGraphTimeline')
            .mockImplementationOnce(() => {
                throw diagnosticFailure;
            });
        const reportError = vi.fn();
        vi.stubGlobal('reportError', reportError);
        const renderer = await Renderer.create({
            backend,
            domElement: canvas,
            width: 4,
            height: 4,
            antialias: false,
            renderPipeline: { name: pipeline.name, create: () => pipeline }
        });
        const target = renderer.createRenderTarget({ width: 4, height: 4 });
        try {
            pipeline.asyncNotificationError = runtimeFailure;
            expect(() => {
                renderer.renderToTarget(target, new Node(), new PerspectiveCamera());
            }).toThrow(diagnosticFailure);
            pipeline.asyncNotificationError = null;
            await renderer.waitForIdle();
            await vi.waitFor(() => {
                expect(reportError).toHaveBeenCalledWith(runtimeFailure);
            });
            expect(pipeline.submitted).toBe(1);
            expect(pipeline.discarded).toBe(0);
            expect(diagnosticCallback).toHaveBeenCalled();
        } finally {
            diagnosticCallback.mockRestore();
            target.destroy();
            renderer.destroy();
            unregisterRendererDiagnostics(canvas, diagnostics);
            vi.unstubAllGlobals();
        }
    });
});
