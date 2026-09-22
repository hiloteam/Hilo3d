import { Color, OrthographicCamera, Stage } from 'hilo3d';
import { configureLive2D, Live2DModel } from '@hilo/addon-live2d';

async function run(): Promise<void> {
    const mode = new URLSearchParams(location.search).get('mode');
    document.body.dataset['lazy'] = String(
        Reflect.get(globalThis, 'Live2DCubismCore') === undefined
    );
    if (mode === 'nonce') configureLive2D({ nonce: 'package-test-nonce' });
    const modelUrl = '/models/miku_sample_t04.model3.json';
    if (mode === 'retry') {
        try {
            await Live2DModel.load(modelUrl);
            throw new Error('Expected the injected CPU module request failure.');
        } catch (error: unknown) {
            if (!(error instanceof TypeError)) throw error;
            document.body.dataset['retried'] = 'true';
        }
    }
    const [model, second] = await Promise.all([
        Live2DModel.load(modelUrl),
        Live2DModel.load(modelUrl)
    ]);
    let stage: Stage<'webgl2'> | undefined;
    try {
        const bounds = model.getModelBounds();
        const camera = new OrthographicCamera({
            near: 0.1,
            far: 10,
            z: 2,
            left: bounds.left,
            right: bounds.right,
            bottom: bounds.bottom,
            top: bounds.top
        });
        stage = await Stage.create({
            backend: 'webgl2',
            width: 64,
            height: 64,
            pixelRatio: 1,
            antialias: false,
            camera,
            clearColor: new Color(0, 0, 0, 0)
        });
        model.playMotion('Idle', { loop: true });
        model.setParameter('ParamMouthOpenY', 1);
        stage.addChild(model);
        const target = stage.renderer.createRenderTarget({ width: 64, height: 64 });
        try {
            model.advance(1000 / 60);
            stage.renderer.renderToTarget(target, stage, camera, true);
            await stage.renderer.waitForIdle();
            const pixels = await target.readColorAttachment();
            let visible = 0;
            for (let y = 0; y < pixels.height; y++) {
                for (let x = 0; x < pixels.width; x++) {
                    const offset = y * pixels.bytesPerRow + x * pixels.bytesPerPixel;
                    if ((pixels.data[offset + 3] ?? 0) > 0) visible++;
                }
            }
            if (visible < 100)
                throw new Error('Packed default runtime produced no character pixels.');
            if (
                model.getParameter('ParamMouthOpenY') !== 1 ||
                second.getParameter('ParamMouthOpenY') === 1
            )
                throw new Error('Concurrent packed models must have independent parameter state.');
            document.body.dataset['pixels'] = String(visible);
            document.body.dataset['nonce'] =
                document.querySelector<HTMLScriptElement>('script[src*="live2dcubismcore."]')
                    ?.nonce ?? '';
        } finally {
            target.destroy();
        }
    } finally {
        second.destroy();
        if (stage) stage.destroy();
        else model.destroy();
    }
    if (!model.isDestroyed || !second.isDestroyed)
        throw new Error('Packed model ownership leaked.');
    document.body.dataset['result'] = 'passed';
}

void run().catch((error: unknown) => {
    document.body.dataset['error'] =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
    document.body.dataset['result'] = 'failed';
});
