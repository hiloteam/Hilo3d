import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { captureStableFrame } from './stable-capture';
import { createExampleCatalog } from '../../examples/shared/catalog';
import {
    completionContractForExample,
    exampleCases,
    examplePaths,
    exampleRequestUrl,
    exampleRequiresRendering,
    exampleUsesDedicatedReleaseTest,
    type ExampleBackend,
    type ExampleCompletionContract
} from './example-paths';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    instrumentationErrors,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

interface CanvasContract {
    readonly frameUrl: string;
    readonly backend: string | null;
    readonly width: number;
    readonly height: number;
    readonly clientWidth: number;
    readonly clientHeight: number;
}

interface PageContract {
    readonly canvases: readonly CanvasContract[];
    readonly backendCanvases: readonly CanvasContract[];
}

interface CanvasPresentation {
    readonly frameUrl: string;
    readonly width: number;
    readonly height: number;
    readonly distinctColorCount: number;
    readonly visiblePixelCount: number;
}

interface CompressedTextureResult {
    readonly backend: string;
    readonly supportedSources: readonly string[];
    readonly renderedSources: readonly string[];
}

interface PianoState {
    readonly audioState: string;
    readonly noteCount: number;
    readonly activeVoices: number;
    readonly demoPlaying: boolean;
    readonly sustain: boolean;
    readonly effects: boolean;
    readonly volume: number;
    readonly reverb: number;
    readonly disposed: boolean;
}

interface PianoSourceEvidence {
    starts: number;
    samplePeak: number;
    readonly demoNotes: string[];
}

function meanSceneLuminance(scene: PNG): number {
    let total = 0;
    for (let offset = 0; offset < scene.data.length; offset += 4) {
        total +=
            (scene.data[offset] ?? 0) * 0.2126 +
            (scene.data[offset + 1] ?? 0) * 0.7152 +
            (scene.data[offset + 2] ?? 0) * 0.0722;
    }
    return total / (scene.width * scene.height);
}

function inspectBluePlumes(
    scene: PNG,
    idle: PNG
): { readonly coverage: number; readonly centerX: number } {
    if (scene.width !== idle.width || scene.height !== idle.height)
        throw new Error('Plume evidence requires matching idle and active capture dimensions.');
    // Restrict evidence to the space above the keys and require newly added blue radiance.
    // The instrument's permanent cold rim and strings must not count as active note plumes.
    const plumeHeight = Math.floor(scene.height * 0.55);
    let pixels = 0;
    let horizontal = 0;
    for (let y = 0; y < plumeHeight; y++) {
        for (let x = 0; x < scene.width; x++) {
            const offset = (y * scene.width + x) * 4;
            const red = scene.data[offset] ?? 0;
            const green = scene.data[offset + 1] ?? 0;
            const blue = scene.data[offset + 2] ?? 0;
            const addedBlue = blue - (idle.data[offset + 2] ?? 0);
            if (blue > 36 && blue > red + 16 && blue > green + 4 && addedBlue > 12) {
                pixels++;
                horizontal += x;
            }
        }
    }
    return {
        coverage: pixels / (scene.width * plumeHeight),
        centerX: pixels > 0 ? horizontal / pixels : 0
    };
}

declare global {
    interface Window {
        readonly __PIANO_STATE__?: PianoState;
        readonly __PIANO_SOURCE_EVIDENCE__?: PianoSourceEvidence;
    }
}

const GPU_DIAGNOSTIC_ERROR =
    /(?:webgl|webgpu|gpu(?:adapter|bindgroup|buffer|command|device|pipeline|queue|sampler|texture)|gl_invalid|validation error|framebuffer[^\n]*(?:incomplete|unsupported)|invalid (?:bind|buffer|command|pipeline|render|sampler|texture)|shader[^\n]*(?:compil|link))/iu;
const PRESENTATION_TIMEOUT = process.env['CI'] === 'true' ? 30_000 : 15_000;

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`audio piano plays notes, sustains blue key plumes and preserves its lifecycle @${backend}`, async ({
        page
    }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        await page.setViewportSize({ width: 960, height: 720 });
        await installRenderHealthProbe(page);
        await page.addInitScript(() => {
            const evidence: PianoSourceEvidence = { starts: 0, samplePeak: 0, demoNotes: [] };
            Object.defineProperty(window, '__PIANO_SOURCE_EVIDENCE__', { value: evidence });
            const examined = new WeakSet<AudioBuffer>();
            const originalStart = Reflect.get(AudioBufferSourceNode.prototype, 'start');
            AudioBufferSourceNode.prototype.start = function (
                ...args: Parameters<AudioBufferSourceNode['start']>
            ): void {
                originalStart.apply(this, args);
                evidence.starts++;
                // This proves a real source starts with non-silent PCM; it is not output metering.
                if (this.buffer && !examined.has(this.buffer)) {
                    examined.add(this.buffer);
                    const samples = this.buffer.getChannelData(0);
                    for (const sample of samples)
                        evidence.samplePeak = Math.max(evidence.samplePeak, Math.abs(sample));
                }
            };
        });
        await page.goto(`audio_piano.html?backend=${backend}&test=1`);
        const body = page.locator('body');
        const soundPanel = page.locator('#soundPanel');
        const settingsToggle = page.locator('#settingsToggle');
        const state = (): Promise<PianoState> =>
            page.evaluate(() => {
                const snapshot = window.__PIANO_STATE__;
                if (!snapshot) throw new Error('The piano must expose its read-only state');
                return snapshot;
            });
        const sourceEvidence = (): Promise<PianoSourceEvidence> =>
            page.evaluate(() => {
                const evidence = window.__PIANO_SOURCE_EVIDENCE__;
                if (!evidence) throw new Error('The piano test requires native source evidence');
                return evidence;
            });
        await expect(body).toHaveAttribute('data-runtime', 'ready');
        await expect(body).toHaveAttribute('data-audio-state', 'idle');
        await expect(page.locator('#pieceTitle')).toHaveText('Call of Silence');
        await expect(page.locator('#pieceDetail')).toHaveText('钢琴独奏 · 69 小节 · 84 BPM');
        await expect(soundPanel).toBeHidden();
        await expect(settingsToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('.score-link')).toHaveAttribute(
            'href',
            './audio/call-of-silence.pdf'
        );
        const scorePdf = await page.request.get(
            new URL('./audio/call-of-silence.pdf', page.url()).href
        );
        expect(scorePdf.ok(), 'The bundled source score must be available beside the example').toBe(
            true
        );
        expect((await scorePdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
        expect((await sourceEvidence()).starts).toBe(0);
        await expect
            .poll(async () => completedRenderCommands(await readRenderHealth(page), backend))
            .toBeGreaterThan(0);
        const idleCapture = await captureStableFrame(page, backend, {
            frames: 2,
            style: '.pianoOverlay { visibility: hidden !important; }'
        });
        await testInfo.attach(`piano-idle-${backend}`, {
            body: idleCapture,
            contentType: 'image/png'
        });
        const idleScene = PNG.sync.read(idleCapture);
        const idleLuminance = meanSceneLuminance(idleScene);
        await page.locator('#enableAudio').click();
        await expect(body).toHaveAttribute('data-audio-state', 'running');
        expect((await sourceEvidence()).starts).toBe(0);

        const middleC = page.locator('#keyboard [data-midi="60"]');
        await middleC.hover();
        await page.mouse.down();
        await expect(middleC).toHaveAttribute('data-active', 'true');
        await expect(page.locator('#lastNote')).toHaveText('C4');
        await expect.poll(async () => (await sourceEvidence()).starts).toBeGreaterThan(0);
        expect((await sourceEvidence()).samplePeak).toBeGreaterThan(0.01);
        await page.mouse.up();
        await expect(middleC).toHaveAttribute('data-active', 'false');

        const pointerNotes = (await state()).noteCount;
        await page.keyboard.down('a');
        await page.keyboard.down('w');
        await expect(page.locator('#lastNote')).toHaveText('C#4');
        await expect.poll(async () => (await state()).noteCount).toBe(pointerNotes + 2);
        await expect.poll(async () => (await state()).activeVoices).toBeGreaterThan(1);
        await page.keyboard.up('w');
        await page.keyboard.up('a');

        // Releasing Enter after focus moves must not leave the original button's note held.
        await middleC.focus();
        await page.keyboard.down('Enter');
        await expect(middleC).toHaveAttribute('data-active', 'true');
        await page.keyboard.press('Tab');
        await expect(middleC).not.toBeFocused();
        await page.keyboard.up('Enter');
        await expect(middleC).toHaveAttribute('data-active', 'false');
        await expect.poll(async () => (await state()).activeVoices, { timeout: 2_000 }).toBe(0);

        await page.locator('#sustainToggle').click();
        await expect(page.locator('#sustainToggle')).toHaveAttribute('aria-pressed', 'true');
        expect((await state()).sustain).toBe(true);
        await page.keyboard.press('s');
        await expect(page.locator('#lastNote')).toHaveText('D4');
        await expect.poll(async () => (await state()).activeVoices).toBeGreaterThan(0);
        await page.locator('#sustainToggle').click();
        expect((await state()).sustain).toBe(false);
        await settingsToggle.click();
        await expect(soundPanel).toBeVisible();
        await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');
        await page.locator('#volumeControl').fill('37');
        await page.locator('#reverbControl').fill('26');
        expect((await state()).volume).toBeCloseTo(0.37);
        expect((await state()).reverb).toBeCloseTo(0.26);

        // Keep a real chord held across the plume comparison, so expired notes cannot make the
        // effects-off frame pass. Distinct notes must grow separate columns above their keys.
        await middleC.focus();
        const lowerChord = ['a', 's', 'd'] as const;
        for (const key of lowerChord) await page.keyboard.down(key);
        await expect(middleC).toHaveAttribute('data-active', 'true');
        let performingCapture = idleCapture;
        await expect
            .poll(
                async () => {
                    performingCapture = await captureStableFrame(page, backend, {
                        frames: 2,
                        style: '.pianoOverlay { visibility: hidden !important; }'
                    });
                    const performing = PNG.sync.read(performingCapture);
                    const luminance = meanSceneLuminance(performing);
                    // The new plumes grow over time. Wait for the same pixel gates together,
                    // rather than capture the first narrow column before its lighting develops.
                    return {
                        bluePlumes: inspectBluePlumes(performing, idleScene).coverage > 0.01,
                        relativeIllumination: luminance > idleLuminance * 1.5,
                        absoluteIllumination: luminance - idleLuminance > 1
                    };
                },
                { timeout: 5_000 }
            )
            .toEqual({
                bluePlumes: true,
                relativeIllumination: true,
                absoluteIllumination: true
            });
        await testInfo.attach(`piano-playing-${backend}`, {
            body: performingCapture,
            contentType: 'image/png'
        });
        const scene = PNG.sync.read(performingCapture);
        const playingLuminance = meanSceneLuminance(scene);
        expect(
            playingLuminance,
            'A held chord must illuminate the actual scene above its quiet atmosphere'
        ).toBeGreaterThan(idleLuminance * 1.5);
        expect(playingLuminance - idleLuminance).toBeGreaterThan(1);
        const colors = new Set<number>();
        let minimum = 255;
        let maximum = 0;
        // The UI is hidden, so text and controls cannot make a blank canvas pass this gate.
        for (let y = 0; y < scene.height; y += 3) {
            for (let x = 0; x < scene.width; x += 3) {
                const offset = (y * scene.width + x) * 4;
                const red = scene.data[offset] ?? 0;
                const green = scene.data[offset + 1] ?? 0;
                const blue = scene.data[offset + 2] ?? 0;
                colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
                const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
                minimum = Math.min(minimum, luminance);
                maximum = Math.max(maximum, luminance);
            }
        }
        expect(
            colors.size,
            'The piano stage must present varied rendered materials'
        ).toBeGreaterThan(48);
        expect(
            maximum - minimum,
            'The stage must preserve luminous forms and shadows'
        ).toBeGreaterThan(90);

        // Controls must remain live after capture releases its ticker pause.
        await page.locator('#effectsToggle').click();
        await expect(body).toHaveAttribute('data-effects', 'off');
        expect((await state()).effects).toBe(false);
        const unlitCapture = await captureStableFrame(page, backend, {
            frames: 2,
            style: '.pianoOverlay { visibility: hidden !important; }'
        });
        await testInfo.attach(`piano-effects-off-${backend}`, {
            body: unlitCapture,
            contentType: 'image/png'
        });
        const unlit = PNG.sync.read(unlitCapture);
        let changed = 0;
        for (let offset = 0; offset < scene.data.length; offset += 4) {
            const difference = Math.max(
                Math.abs((scene.data[offset] ?? 0) - (unlit.data[offset] ?? 0)),
                Math.abs((scene.data[offset + 1] ?? 0) - (unlit.data[offset + 1] ?? 0)),
                Math.abs((scene.data[offset + 2] ?? 0) - (unlit.data[offset + 2] ?? 0))
            );
            if (difference > 12) changed++;
        }
        expect(
            changed / (scene.width * scene.height),
            'Disabling effects must change real stage pixels'
        ).toBeGreaterThan(0.001);
        expect(
            inspectBluePlumes(unlit, idleScene).coverage,
            'Disabling effects must remove the blue columns while the chord remains held'
        ).toBeLessThan(inspectBluePlumes(scene, idleScene).coverage * 0.2);
        await page.locator('#effectsToggle').click();
        await expect(body).toHaveAttribute('data-effects', 'on');
        await expect(middleC).toHaveAttribute('data-active', 'true');
        // Wait beyond the longest individual bubble lifetime: a held chord must keep emitting,
        // rather than displaying only the original attack burst or a static screenshot.
        await page.waitForTimeout(3_300);
        const sustainedCapture = await captureStableFrame(page, backend, {
            frames: 2,
            style: '.pianoOverlay { visibility: hidden !important; }'
        });
        const sustainedScene = PNG.sync.read(sustainedCapture);
        const sustainedLuminance = meanSceneLuminance(sustainedScene);
        const lowerPlumes = inspectBluePlumes(sustainedScene, idleScene);
        expect(
            lowerPlumes.coverage,
            'Held keys must continuously renew their plumes'
        ).toBeGreaterThan(0.01);
        await testInfo.attach(`piano-sustained-${backend}`, {
            body: sustainedCapture,
            contentType: 'image/png'
        });
        for (const key of lowerChord) await page.keyboard.up(key);
        await expect(middleC).toHaveAttribute('data-active', 'false');
        let fadedCapture = performingCapture;
        await expect
            .poll(async () => {
                fadedCapture = await captureStableFrame(page, backend, {
                    frames: 2,
                    style: '.pianoOverlay { visibility: hidden !important; }'
                });
                const faded = PNG.sync.read(fadedCapture);
                // Compare the fade against the lit frame immediately before release, rather than
                // the earlier growing frame taken before toggling effects. Every original fade
                // gate must settle together; a low average cannot hide surviving plumes.
                return Math.max(
                    meanSceneLuminance(faded) / (idleLuminance + Math.max(1, idleLuminance * 0.2)),
                    meanSceneLuminance(faded) / (sustainedLuminance * 0.65),
                    inspectBluePlumes(faded, idleScene).coverage / (lowerPlumes.coverage * 0.1)
                );
            })
            .toBeLessThan(1);
        expect(
            meanSceneLuminance(PNG.sync.read(fadedCapture)),
            'Releasing the note must let its illumination fade back into darkness'
        ).toBeLessThan(sustainedLuminance * 0.65);
        await testInfo.attach(`piano-faded-${backend}`, {
            body: fadedCapture,
            contentType: 'image/png'
        });
        expect(inspectBluePlumes(PNG.sync.read(fadedCapture), idleScene).coverage).toBeLessThan(
            lowerPlumes.coverage * 0.1
        );

        const upperChord = ['k', 'l', ';'] as const;
        for (const key of upperChord) await page.keyboard.down(key);
        let upperCapture = fadedCapture;
        await expect
            .poll(async () => {
                upperCapture = await captureStableFrame(page, backend, {
                    frames: 2,
                    style: '.pianoOverlay { visibility: hidden !important; }'
                });
                return inspectBluePlumes(PNG.sync.read(upperCapture), idleScene).coverage;
            })
            .toBeGreaterThan(0.01);
        expect(
            inspectBluePlumes(PNG.sync.read(upperCapture), idleScene).centerX - lowerPlumes.centerX,
            'Playing higher keys must move the blue plume columns with their key positions'
        ).toBeGreaterThan(scene.width * 0.06);
        await testInfo.attach(`piano-upper-keys-${backend}`, {
            body: upperCapture,
            contentType: 'image/png'
        });
        for (const key of upperChord) await page.keyboard.up(key);
        const notesBeforeDemo = (await state()).noteCount;
        const sourcesBeforeDemo = (await sourceEvidence()).starts;
        await page.evaluate(() => {
            const lastNote = document.querySelector('#lastNote');
            const evidence = window.__PIANO_SOURCE_EVIDENCE__;
            if (!lastNote || !evidence)
                throw new Error('Default score playback evidence is missing');
            // Observe the real audio-clock callback without mutating the score or scheduler.
            // Added text nodes preserve each event even if two callbacks share one browser turn.
            const observer = new MutationObserver(records => {
                for (const record of records)
                    for (const node of record.addedNodes) {
                        const name = node.textContent;
                        if (name && evidence.demoNotes.length < 2) evidence.demoNotes.push(name);
                    }
                if (evidence.demoNotes.length >= 2) observer.disconnect();
            });
            observer.observe(lastNote, { childList: true });
        });
        await page.locator('#demoToggle').click();
        await expect(page.locator('#demoToggle')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => (await sourceEvidence()).demoNotes).toEqual(['A4', 'C5']);
        expect((await sourceEvidence()).starts).toBeGreaterThanOrEqual(sourcesBeforeDemo + 2);
        await expect
            .poll(async () => (await state()).noteCount)
            .toBeGreaterThan(notesBeforeDemo + 1);
        await page.locator('#demoToggle').click();
        await expect(page.locator('#demoToggle')).toHaveAttribute('aria-pressed', 'false');
        expect((await state()).demoPlaying).toBe(false);

        // Two simultaneous, two-second notes in a format 0 MIDI file at the default 120 BPM.
        await page.locator('#midiFile').setInputFiles({
            name: 'local-nocturne.mid',
            mimeType: 'audio/midi',
            buffer: Buffer.from(
                '4d546864000000060000000101e04d54726b00000015009040640090435c8f008040000080430000ff2f00',
                'hex'
            )
        });
        await expect(page.locator('#pieceTitle')).toContainText('local-nocturne');
        const importedNotes = (await state()).noteCount;
        const importedSources = (await sourceEvidence()).starts;
        await page.locator('#demoToggle').click();
        await expect.poll(async () => (await state()).noteCount).toBe(importedNotes + 2);
        expect((await sourceEvidence()).starts).toBe(importedSources + 2);
        await page.locator('#demoToggle').click();
        expect((await state()).demoPlaying).toBe(false);

        await page.evaluate(() =>
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        );
        await expect(body).toHaveAttribute('data-runtime', 'suspended');
        expect((await state()).disposed).toBe(false);
        await page.evaluate(() =>
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
        );
        await expect(body).toHaveAttribute('data-runtime', 'ready');
        const notesBeforeRestore = (await state()).noteCount;
        await page.keyboard.press('d');
        await expect.poll(async () => (await state()).noteCount).toBe(notesBeforeRestore + 1);
        await settingsToggle.click();
        await expect(soundPanel).toBeHidden();
        await expect(settingsToggle).toHaveAttribute('aria-expanded', 'false');
        await testInfo.attach(`piano-interface-${backend}`, {
            body: await captureStableFrame(page, backend, { frames: 2 }),
            contentType: 'image/png'
        });
        await awaitTrackedGPUQueues(page);
        const health = await readRenderHealth(page);
        expect(completedRenderCommands(health, backend)).toBeGreaterThan(0);
        expect(instrumentationErrors(health, backend)).toEqual([]);
        await expect(page.locator('#error')).toBeEmpty();

        await page.evaluate(() =>
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
        );
        await expect(body).toHaveAttribute('data-runtime', 'destroyed');
        expect((await state()).disposed).toBe(true);
        const finalSources = (await sourceEvidence()).starts;
        const finalDraws = completedRenderCommands(await readRenderHealth(page), backend);
        await page.keyboard.press('a');
        // Keep the document alive to observe callbacks after ticker/audio resource disposal.
        await waitForStableAnimationFrames(page);
        await awaitTrackedGPUQueues(page);
        expect((await sourceEvidence()).starts).toBe(finalSources);
        const disposedHealth = await readRenderHealth(page);
        expect(completedRenderCommands(disposedHealth, backend)).toBe(finalDraws);
        expect(instrumentationErrors(disposedHealth, backend)).toEqual([]);
        expect(errors).toEqual([]);
    });

    test(`audio piano preserves a cached page while scene assets are loading @${backend}`, async ({
        page
    }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        await installRenderHealthProbe(page);
        let assetRequested = false;
        let releaseAssets: (() => void) | undefined;
        const assetGate = new Promise<void>(resolve => {
            releaseAssets = resolve;
        });
        await page.route('**/photo-studio-loft-hall/diffuse.rgbd', async route => {
            assetRequested = true;
            await assetGate;
            await route.continue();
        });
        try {
            await page.goto(`audio_piano.html?backend=${backend}&test=1`, {
                waitUntil: 'domcontentloaded'
            });
            await expect.poll(() => assetRequested).toBe(true);
            await expect(page.locator('#enableAudio')).toBeDisabled();
            await page.evaluate(() =>
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
            );
            await expect(page.locator('body')).toHaveAttribute('data-runtime', 'suspended');
            releaseAssets?.();
            // Initialization may finish while cached, but it must not start a hidden frame loop.
            await expect(page.locator('#enableAudio')).toBeEnabled();
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            await expect(page.locator('body')).toHaveAttribute('data-runtime', 'suspended');
            const suspendedHealth = await readRenderHealth(page);
            expect(completedRenderCommands(suspendedHealth, backend)).toBe(0);
            expect(instrumentationErrors(suspendedHealth, backend)).toEqual([]);

            await page.evaluate(() =>
                window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
            );
            await expect(page.locator('body')).toHaveAttribute('data-runtime', 'ready');
            await expect
                .poll(async () => completedRenderCommands(await readRenderHealth(page), backend))
                .toBeGreaterThan(0);
            const capture = await captureStableFrame(page, backend, {
                frames: 2,
                style: '.pianoOverlay { visibility: hidden !important; }'
            });
            expect(inspectCompositorPng(capture, page.url()).distinctColorCount).toBeGreaterThan(1);
            await expect(page.locator('#error')).toBeEmpty();

            // Autoplay is also an audio-unlock gesture; both controls must reflect that state.
            await expect(page.locator('body')).toHaveAttribute('data-audio-state', 'idle');
            await page.locator('#demoToggle').click();
            await expect(page.locator('body')).toHaveAttribute('data-audio-state', 'running');
            await expect(page.locator('#enableAudio')).toHaveAttribute('data-enabled', 'true');
            await expect(page.locator('#enableAudio')).toContainText('声音已开启');
            await expect(page.locator('#demoToggle')).toHaveAttribute('aria-pressed', 'true');

            await page.evaluate(() =>
                window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
            );
            await expect(page.locator('body')).toHaveAttribute('data-runtime', 'destroyed');
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            expect(instrumentationErrors(await readRenderHealth(page), backend)).toEqual([]);
            expect(errors).toEqual([]);
        } finally {
            releaseAssets?.();
        }
    });

    test(`asset residency lab changes demand and tears down cleanly @${backend}`, async ({
        page
    }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await installRenderHealthProbe(page);
        await page.goto(`asset_streaming.html?backend=${backend}&test=1`);
        const status = page.locator('#diagnostics');
        await expect(status).toContainText('ETC1S study: resident / mip 0');
        await page.getByRole('button', { name: 'Switch texture set' }).click();
        await expect(status).toContainText('UASTC study: resident / mip 0');
        await expect(status).toContainText('evictions: 1');
        await page.getByRole('button', { name: 'Use coarse detail' }).click();
        await expect(status).toContainText('UASTC study: resident / mip 3');
        await page.getByRole('button', { name: 'Use full detail' }).click();
        await expect(status).toContainText('UASTC study: resident / mip 0');
        await awaitTrackedGPUQueues(page);
        const health = await readRenderHealth(page);
        expect(completedRenderCommands(health, backend)).toBeGreaterThan(0);
        expect(instrumentationErrors(health, backend)).toEqual([]);
        await expect(page.locator('#error')).toBeEmpty();
        await page.evaluate(() =>
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
        );
        await waitForStableAnimationFrames(page);
        expect(errors).toEqual([]);
        expect(instrumentationErrors(await readRenderHealth(page), backend)).toEqual([]);
    });
}

function recordUnique(messages: string[], message: string): void {
    if (!messages.includes(message)) messages.push(message);
}

async function readPageContract(page: Page): Promise<PageContract> {
    const frameContracts = await Promise.all(
        page.frames().map(async frame => {
            const frameUrl = frame.url();
            try {
                const canvases = await frame.evaluate(() =>
                    [...document.querySelectorAll<HTMLCanvasElement>('canvas')].map(canvas => ({
                        backend: canvas.dataset['hilo3dBackend'] ?? null,
                        width: canvas.width,
                        height: canvas.height,
                        clientWidth: canvas.clientWidth,
                        clientHeight: canvas.clientHeight
                    }))
                );
                return { frameUrl, canvases };
            } catch (error: unknown) {
                if (frame.isDetached()) return { frameUrl, canvases: [] };
                throw error;
            }
        })
    );
    const canvases = frameContracts.flatMap(({ frameUrl, canvases: frameCanvases }) =>
        frameCanvases.map(canvas => ({ frameUrl, ...canvas }))
    );
    return {
        canvases,
        backendCanvases: canvases.filter(canvas => canvas.backend !== null)
    };
}

async function readCanvasBufferPresentations(
    page: Page,
    backend: ExampleBackend
): Promise<readonly CanvasPresentation[]> {
    const framePresentations = await Promise.all(
        page.frames().map(async frame => {
            const frameUrl = frame.url();
            try {
                const presentations = await frame.evaluate(expectedBackend => {
                    return [
                        ...document.querySelectorAll<HTMLCanvasElement>(
                            `canvas[data-hilo3d-backend="${expectedBackend}"]`
                        )
                    ].map(source => {
                        const width = Math.min(128, source.width);
                        const height = Math.min(128, source.height);
                        const scratch = document.createElement('canvas');
                        scratch.width = width;
                        scratch.height = height;
                        const context = scratch.getContext('2d', { willReadFrequently: true });
                        if (!context) throw new Error('Unable to create a presentation readback');
                        context.drawImage(source, 0, 0, width, height);
                        const pixels = context.getImageData(0, 0, width, height).data;
                        const colors = new Set<number>();
                        let visiblePixelCount = 0;
                        for (let offset = 0; offset < pixels.length; offset += 4) {
                            const red = pixels[offset] ?? 0;
                            const green = pixels[offset + 1] ?? 0;
                            const blue = pixels[offset + 2] ?? 0;
                            const alpha = pixels[offset + 3] ?? 0;
                            if (alpha > 0) visiblePixelCount++;
                            colors.add((red << 16) | (green << 8) | blue);
                            if (colors.size > 1 && visiblePixelCount > 0) break;
                        }
                        return {
                            width,
                            height,
                            distinctColorCount: colors.size,
                            visiblePixelCount
                        };
                    });
                }, backend);
                return presentations.map(presentation => ({ frameUrl, ...presentation }));
            } catch (error: unknown) {
                if (frame.isDetached()) return [];
                throw error;
            }
        })
    );
    return framePresentations.flat();
}

function inspectCompositorPng(png: Buffer, frameUrl: string): CanvasPresentation {
    const decoded = PNG.sync.read(png);
    const width = Math.min(128, decoded.width);
    const height = Math.min(128, decoded.height);
    const colors = new Set<number>();
    let visiblePixelCount = 0;
    for (let y = 0; y < height; y += 1) {
        const sourceY = Math.min(decoded.height - 1, Math.floor((y * decoded.height) / height));
        for (let x = 0; x < width; x += 1) {
            const sourceX = Math.min(decoded.width - 1, Math.floor((x * decoded.width) / width));
            const offset = (sourceY * decoded.width + sourceX) * 4;
            const red = decoded.data[offset] ?? 0;
            const green = decoded.data[offset + 1] ?? 0;
            const blue = decoded.data[offset + 2] ?? 0;
            const alpha = decoded.data[offset + 3] ?? 0;
            if (alpha > 0) visiblePixelCount++;
            colors.add((red << 16) | (green << 8) | blue);
            if (colors.size > 1 && visiblePixelCount > 0) {
                return {
                    frameUrl,
                    width,
                    height,
                    distinctColorCount: colors.size,
                    visiblePixelCount
                };
            }
        }
    }
    return {
        frameUrl,
        width,
        height,
        distinctColorCount: colors.size,
        visiblePixelCount
    };
}

async function readCompositorCanvasPresentations(
    page: Page,
    backend: ExampleBackend
): Promise<readonly CanvasPresentation[]> {
    const selector = `canvas[data-hilo3d-backend="${backend}"]`;
    const presentations: CanvasPresentation[] = [];
    for (const frame of page.frames()) {
        const canvases = frame.locator(selector);
        const count = await canvases.count();
        for (let index = 0; index < count; index++) {
            const png = await canvases.nth(index).screenshot({
                type: 'png',
                animations: 'allow',
                caret: 'hide'
            });
            presentations.push(inspectCompositorPng(png, frame.url()));
        }
    }
    return presentations;
}

async function readCanvasPresentations(
    page: Page,
    backend: ExampleBackend
): Promise<readonly CanvasPresentation[]> {
    const direct = await readCanvasBufferPresentations(page, backend);
    if (
        direct.length > 0 &&
        direct.every(
            presentation =>
                presentation.visiblePixelCount > 0 && presentation.distinctColorCount > 1
        )
    ) {
        return direct;
    }
    return readCompositorCanvasPresentations(page, backend);
}

function canvasPresentationsAreVisible(presentations: readonly CanvasPresentation[]): boolean {
    return (
        presentations.length > 0 &&
        presentations.every(
            presentation =>
                presentation.width > 0 &&
                presentation.height > 0 &&
                presentation.visiblePixelCount > 0 &&
                presentation.distinctColorCount > 1
        )
    );
}

async function expectVisibleCanvasPresentations(
    page: Page,
    examplePath: string,
    backend: ExampleBackend
): Promise<void> {
    if (examplePath === 'audio_piano.html') {
        // Keep production resolution while yielding the continuously animated showcase's ticker
        // for its compositor capture. The shared helper waits for real submission completion.
        const png = await captureStableFrame(page, backend, {
            frames: 2,
            style: '.pianoOverlay { visibility: hidden !important; }'
        });
        expect(
            canvasPresentationsAreVisible([inspectCompositorPng(png, page.url())]),
            `${examplePath} must present a visible non-uniform ${backend} frame`
        ).toBe(true);
        const capturedDraws = completedRenderCommands(await readRenderHealth(page), backend);
        await expect
            .poll(async () => completedRenderCommands(await readRenderHealth(page), backend))
            .toBeGreaterThan(capturedDraws);
        return;
    }
    const deadline = Date.now() + PRESENTATION_TIMEOUT;
    let presentations: readonly CanvasPresentation[] = [];
    // Do not discard a valid compositor read merely because the read itself crossed the deadline.
    // The deadline controls whether another probe may start; the enclosing Playwright timeout still
    // bounds a stalled screenshot operation.
    while (Date.now() < deadline) {
        presentations = await readCanvasPresentations(page, backend);
        if (canvasPresentationsAreVisible(presentations)) return;
        if (Date.now() >= deadline) break;
        await page.waitForTimeout(100);
    }
    expect(
        canvasPresentationsAreVisible(presentations),
        `${examplePath} must present a visible non-uniform ${backend} frame`
    ).toBe(true);
}

async function assertCompletionContract(
    page: Page,
    contract: ExampleCompletionContract | null,
    backend: ExampleBackend
): Promise<void> {
    if (contract === null) return;
    if (contract === 'gltf-viewer') {
        await expect(page.locator('body')).toHaveAttribute('data-model-ready', 'true', {
            timeout: 15_000
        });
        return;
    }
    if (contract === 'resource-diagnostics') {
        await expect(page.locator('body')).toHaveAttribute(
            'data-resource-diagnostics-complete',
            'true',
            { timeout: 15_000 }
        );
        await expect(page.locator('#resource-diagnostics')).toContainText('textureBox destroyed');
        await expect(page.locator('#resource-diagnostics')).toContainText(
            'post-destroy mesh rendered'
        );
        return;
    }

    await page.waitForFunction(
        expectedBackend => {
            const result = (
                window as Window & {
                    __HILO3D_COMPRESSED_TEXTURE_RESULT__?: CompressedTextureResult;
                }
            ).__HILO3D_COMPRESSED_TEXTURE_RESULT__;
            return (
                result?.backend === expectedBackend &&
                result.renderedSources.length === result.supportedSources.length &&
                result.renderedSources.every(
                    (source, index) => source === result.supportedSources[index]
                )
            );
        },
        backend,
        { timeout: 15_000 }
    );
    const result = await page.evaluate(
        () =>
            (
                window as Window & {
                    __HILO3D_COMPRESSED_TEXTURE_RESULT__?: CompressedTextureResult;
                }
            ).__HILO3D_COMPRESSED_TEXTURE_RESULT__
    );
    expect(result?.backend).toBe(backend);
    expect(result?.renderedSources).toEqual(result?.supportedSources);
}

async function assertObservableRender(
    page: Page,
    examplePath: string,
    backend: ExampleBackend
): Promise<void> {
    await expect
        .poll(async () => completedRenderCommands(await readRenderHealth(page), backend), {
            message: `${examplePath} must issue a native ${backend} render command`,
            timeout: 30_000
        })
        .toBeGreaterThan(0);
}

test('canonical examples index opens the WebGPU gallery by default', async ({ page }) => {
    await page.goto('/examples/index.html', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/examples\/list\.html#\w+$/u);
    await expect(page.locator('#backendSelect')).toHaveValue('webgpu');
    await expect(page.locator('#exampleFrame')).toHaveAttribute(
        'src',
        /[?&]backend=webgpu(?:&|$)/u
    );
});

test('PBR showcase controls remain usable at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 344, height: 728 });
    await page.route('**/*.ts', route =>
        route.fulfill({
            contentType: 'application/javascript',
            body: ''
        })
    );

    await page.goto('/examples/list.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.siteLinks')).toHaveCSS('display', 'none');
    const brandBounds = await page.locator('.brand').boundingBox();
    const backendBounds = await page.locator('.backendControl').boundingBox();
    if (!brandBounds || !backendBounds) throw new Error('Mobile gallery header is not visible');
    expect(brandBounds.x + brandBounds.width).toBeLessThanOrEqual(backendBounds.x);
    expect(backendBounds.x + backendBounds.width).toBeLessThanOrEqual(344);

    await page.goto('/examples/pbr2.html', { waitUntil: 'domcontentloaded' });
    await page.locator('body').evaluate(body => {
        const stats = document.createElement('div');
        stats.className = 'hilo3dStats';
        body.append(stats);
    });
    await expect(page.locator('.hilo3dStats')).toHaveCSS('display', 'none');
    const labPanelBounds = await page.locator('.labPanel').boundingBox();
    if (!labPanelBounds) throw new Error('Mobile PBR lab panel is not visible');
    expect(labPanelBounds.x).toBeGreaterThanOrEqual(0);
    expect(labPanelBounds.x + labPanelBounds.width).toBeLessThanOrEqual(344);

    await page.goto('/examples/pbr_layered_materials.html', {
        waitUntil: 'domcontentloaded'
    });
    const featureCardLayout = await page.locator('.featureCards').evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        visibleCards: [...element.children].filter(
            child => getComputedStyle(child).display !== 'none'
        ).length
    }));
    expect(featureCardLayout.scrollWidth).toBeGreaterThan(featureCardLayout.clientWidth);
    expect(featureCardLayout.visibleCards).toBe(3);

    await page.goto('/examples/gltf_material_extensions.html', {
        waitUntil: 'domcontentloaded'
    });
    const assetSwitcherLayout = await page.locator('.assetSwitcher').evaluate(element => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        visibleButtons: [...element.children].filter(
            child => getComputedStyle(child).display !== 'none'
        ).length
    }));
    expect(assetSwitcherLayout.scrollWidth).toBeGreaterThan(assetSwitcherLayout.clientWidth);
    expect(assetSwitcherLayout.visibleButtons).toBe(7);
});

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`example gallery discovers every ${backend} page @${backend}`, async ({ page }) => {
        test.setTimeout(60_000);
        await page.goto(`/examples/list.html?backend=${backend}`, { waitUntil: 'networkidle' });
        const expected = createExampleCatalog(examplePaths);
        const expectedHighlights = expected.filter(entry => entry.featured);
        const navigationItems = page.locator('#exampleNavigation .exampleButton');
        expect(
            await page
                .locator('#exampleNavigation .exampleButtonTitle')
                .evaluateAll(items => items.map(item => item.textContent))
        ).toEqual(expectedHighlights.map(entry => entry.title));
        expect(
            await navigationItems.evaluateAll(items =>
                items.map(item => (item as HTMLElement).dataset['examplePath'])
            )
        ).toEqual(expectedHighlights.map(entry => entry.path));

        await page.locator('#allMode').click();
        await expect(navigationItems).toHaveCount(expected.length);
        expect(
            await navigationItems.evaluateAll(items =>
                items.map(item => (item as HTMLElement).dataset['examplePath'])
            )
        ).toEqual(expected.map(entry => entry.path));
        const exclusiveBackendCounts = {
            webgl2: expected.filter(
                entry =>
                    entry.supportedBackends.length === 1 && entry.supportedBackends[0] === 'webgl2'
            ).length,
            webgpu: expected.filter(
                entry =>
                    entry.supportedBackends.length === 1 && entry.supportedBackends[0] === 'webgpu'
            ).length
        };
        await expect(page.locator('.exampleBackendBadge[data-backend="webgpu"]')).toHaveCount(
            exclusiveBackendCounts.webgpu
        );
        await expect(page.locator('.exampleBackendBadge[data-backend="webgl2"]')).toHaveCount(
            exclusiveBackendCounts.webgl2
        );
        await expect(page.locator('.exampleButton[data-backend-compatible="false"]')).toHaveCount(
            expected.filter(entry => !entry.supportedBackends.includes(backend)).length
        );

        const exampleFrame = page.locator('#exampleFrame');
        await expect(page.locator('#currentTitle')).toHaveText('Quick Start');
        await expect(exampleFrame).toHaveAttribute(
            'src',
            new RegExp(`[?&]backend=${backend}(?:&|$)`, 'u')
        );

        await page.locator('#exampleSearch').fill('Geometry Primitives');
        await expect(navigationItems).toHaveCount(1);
        await page.locator('[data-example-path="geometry_primitives.html"]').click();
        await expect(page.frameLocator('#exampleFrame').locator('.hilo3dStats')).toContainText(
            `renderBackend: ${backend === 'webgl2' ? 'WebGL 2' : 'WebGPU'}`
        );

        await page.locator('#exampleSearch').fill('glTF Viewer');
        await expect(navigationItems).toHaveCount(1);
        await page.locator('[data-example-path="glTFViewer/index.html"]').click();
        const gltfSource = await exampleFrame.getAttribute('src');
        if (!gltfSource) throw new Error('glTF Viewer navigation did not set an iframe source.');
        expect(new URL(gltfSource).searchParams.get('url')).toBe(
            '/examples/models/Tmall/Tmall.gltf'
        );

        await page.locator('#exampleSearch').fill('Quick Start');
        await expect(navigationItems).toHaveCount(1);
        await page.locator('[data-example-path="quickStart.html"]').click();
        const quickStartSource = await exampleFrame.getAttribute('src');
        if (!quickStartSource)
            throw new Error('Quick Start navigation did not set an iframe source.');
        const quickStartUrl = new URL(quickStartSource);
        expect(quickStartUrl.searchParams.get('backend')).toBe(backend);
        expect(quickStartUrl.searchParams.has('url')).toBe(false);

        await page.locator('#exampleSearch').fill('');
        const fallbackPath = backend === 'webgl2' ? 'compute_gpu_driven.html' : 'webxr.html';
        const fallbackBackend = backend === 'webgl2' ? 'webgpu' : 'webgl2';
        const fallbackLabel = backend === 'webgl2' ? 'WebGPU only' : 'WebGL 2 only';
        await page.route(`**/${fallbackPath}*`, route =>
            route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Single-backend example</title>'
            })
        );
        await page.locator(`[data-example-path="${fallbackPath}"]`).click();
        await expect(page.locator('#currentBackend')).toHaveText(fallbackLabel);
        await expect(page.locator('#currentBackend')).toHaveAttribute('data-fallback', 'true');
        const fallbackSource = await exampleFrame.getAttribute('src');
        if (!fallbackSource) throw new Error(`${fallbackPath} did not set an iframe source.`);
        expect(new URL(fallbackSource).searchParams.get('backend')).toBe(fallbackBackend);

        await page.setViewportSize({ width: 600, height: 720 });
        const sidebarToggle = page.locator('#sidebarToggle');
        await expect(sidebarToggle).toBeVisible();
        await sidebarToggle.click();
        await expect(page.locator('body')).toHaveClass(/sidebarOpen/u);
        await page.locator('#sidebarBackdrop').click({ position: { x: 590, y: 300 } });
        await expect(page.locator('body')).not.toHaveClass(/sidebarOpen/u);
    });
}

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`gallery filters survive reload and backend changes @${backend}`, async ({ page }) => {
        // This test exercises the gallery's DOM/URL state, including an opposite-backend switch.
        // Keep that switch out of native GPU work in the hosted WebGL2 lane. Actual iframe draws
        // and backend health remain covered by the gallery integration and page release gates.
        await page.route('**/quickStart.html*', route =>
            route.fulfill({
                contentType: 'text/html',
                body: '<!doctype html><title>Gallery navigation fixture</title>'
            })
        );
        await page.goto(`list.html?backend=${backend}`);
        const topics = page.locator('#categorySelect');
        const results = page.locator('.exampleButton');
        await expect(topics.locator('option[value="2d"]')).toHaveText('2D games (3)');
        await expect(page.locator('#exampleCount')).toHaveText('26 of 26 highlights');
        await topics.selectOption('2d');
        await expect(results).toHaveCount(3);
        await page.locator('#exampleSearch').fill('Sprite Batching');
        await expect(results).toHaveCount(0);
        await expect(topics.locator('option[value="2d"]')).toHaveText('2D games (0)');
        await page.locator('#allMode').click();
        await expect(results).toHaveCount(1);
        await expect(topics.locator('option[value="2d"]')).toHaveText('2D games (1)');
        await page.locator('#exampleSearch').fill('');
        await expect(results).toHaveCount(6);
        await expect(topics.locator('option[value="2d"]')).toHaveText('2D games (6)');
        await page.locator('#featuredMode').click();
        await expect(results).toHaveCount(3);
        await expect(page.locator('#exampleCount')).toHaveText('3 of 26 highlights');
        await page.locator('#allMode').click();
        await page.locator('#categorySelect').selectOption('rendering');
        await page.locator('#exampleSearch').fill('texture depth');
        await expect(page.locator('.exampleButton')).toHaveCount(1);
        await expect(page.locator('.exampleButton')).toHaveAttribute(
            'data-example-id',
            'depthTexture'
        );
        await page.locator('#compatibleOnly').check();
        await page.reload();
        await expect(page.locator('#exampleSearch')).toHaveValue('texture depth');
        await expect(page.locator('#categorySelect')).toHaveValue('rendering');
        await expect(page.locator('#compatibleOnly')).toBeChecked();
        await expect(page.locator('.exampleButton')).toHaveCount(1);
        const source = await page.locator('#exampleFrame').getAttribute('src');
        if (!source) throw new Error('Missing example frame');
        const query = new URL(source).searchParams;
        for (const key of ['q', 'category', 'collection', 'compatible'])
            expect(query.has(key)).toBe(false);
        await page
            .locator('#backendSelect')
            .selectOption(backend === 'webgl2' ? 'webgpu' : 'webgl2');
        await expect(page.locator('#exampleFrame')).toHaveAttribute(
            'src',
            new RegExp(`[?&]backend=${backend === 'webgl2' ? 'webgpu' : 'webgl2'}(?:&|$)`, 'u')
        );
        await expect(page.locator('#exampleSearch')).toHaveValue('texture depth');
        await expect(page.locator('#categorySelect')).toHaveValue('rendering');
        await page.locator('#clearFilters').click();
        await page.locator('#allMode').click();
        await page.locator('#compatibleOnly').check();
        await expect(page.locator('.exampleButton[data-backend-compatible="false"]')).toHaveCount(
            0
        );
        await page.locator('#exampleSearch').fill('没有这样的示例');
        await expect(page.locator('.emptyState')).toBeVisible();
        await page.locator('#clearFilters').click();
        await page.locator('#exampleSearch').fill('几何');
        await expect(page.locator('.exampleButton')).toHaveCount(
            createExampleCatalog(examplePaths).filter(entry => entry.category === 'geometry').length
        );
    });
}

test('gallery restores history, tolerates malformed hashes and opens mobile search @webgl2', async ({
    page
}) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('list.html?backend=webgl2#%invalid');
    await expect(page.locator('#currentTitle')).toHaveText('Quick Start');
    await page.locator('#allMode').click();
    await page.locator('[data-example-id="geometry_primitives"]').click();
    await expect(page.locator('#currentTitle')).toHaveText('Geometry Primitives');
    await page.goBack();
    await expect(page.locator('#currentTitle')).toHaveText('Quick Start');
    await page.goForward();
    await expect(page.locator('[data-example-id="geometry_primitives"]')).toHaveAttribute(
        'aria-current',
        'page'
    );
    await page.setViewportSize({ width: 344, height: 740 });
    await expect(page.locator('#gallerySidebar')).toHaveJSProperty('inert', true);
    await page.locator('#backendSelect').blur();
    await page.keyboard.press('/');
    await expect(page.locator('#exampleSearch')).toBeFocused();
    await expect(page.locator('#sidebarToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.viewer')).toHaveJSProperty('inert', true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#sidebarToggle')).toBeFocused();
    await expect(page.locator('#gallerySidebar')).toHaveJSProperty('inert', true);
    await page.locator('#sidebarToggle').click();
    await page.locator('#exampleSearch').fill('Geometry Primitives');
    await page.locator('[data-example-id="geometry_primitives"]').click();
    await expect(page.locator('#sidebarToggle')).toHaveAttribute('aria-expanded', 'false');
    // A wider fallback font reproduces Linux's min-content pressure on macOS as well.
    await page.addStyleTag({ content: '.viewerTitle { font-family: monospace; }' });
    for (const width of [344, 320]) {
        await page.setViewportSize({ width, height: 740 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        for (const selector of ['.viewerToolbar', '.viewerIdentity', '.viewerActions']) {
            const bounds = await page.locator(selector).boundingBox();
            if (!bounds) throw new Error(`${selector} is missing from the mobile gallery`);
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        }
    }
    expect(errors).toEqual([]);
});

test('gallery reports initialization failures and retries the same example @webgl2', async ({
    page
}) => {
    await page.route('**/geometry_dynamic2.html*', route =>
        route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><script type="module">
            import '/examples/shared/gallery-status.ts';
            throw new Error('Gallery failure fixture');
        </script>`
        })
    );
    await page.goto('list.html?backend=webgl2&collection=featured#geometry_dynamic2');
    await expect(page.locator('#featuredMode')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('#featuredMode')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#frameStatus')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#frameStatusText')).toContainText('Gallery failure fixture');
    await page.unroute('**/geometry_dynamic2.html*');
    await page.locator('#retryExample').click();
    await expect(page.locator('#frameStatus')).toHaveAttribute('data-state', 'ready');
    await expect(page.frameLocator('#exampleFrame').locator('.hilo3dStats')).toContainText(
        'renderBackend: WebGL 2'
    );
});

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`cascaded shadow toy diorama demonstrates detail and live controls through ${backend} @${backend}`, async ({
        page
    }) => {
        test.slow();
        // Software WebGL2 needs time for the daylight comparisons and the complete dusk sequence.
        test.setTimeout(backend === 'webgl2' ? 420_000 : 240_000);
        const pageErrors: string[] = [];
        page.on('pageerror', error => {
            recordUnique(pageErrors, error.message);
        });
        await page.setViewportSize({ width: 960, height: 640 });
        await installRenderHealthProbe(page);
        await page.goto(exampleRequestUrl('cascaded_shadows.html', backend), {
            waitUntil: 'networkidle'
        });
        await expect(page.locator('body')).toHaveAttribute('data-csm-ready', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-csm-train', 'true');
        await expect(page.locator('#trainToggle')).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#trainToggle').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-motion', 'false');
        await expect(page.locator('body')).toHaveAttribute('data-csm-msaa', '4');
        await expect(page.locator('body')).toHaveAttribute('data-csm-aa', 'msaa');
        await expect(page.locator('body')).toHaveAttribute('data-csm-mode', '4');
        await expect(page.locator('body')).toHaveAttribute('data-csm-strength', '1');
        await expect(page.locator('body')).toHaveAttribute('data-csm-view', 'courtyard');
        await expect(page.locator('body')).toHaveAttribute('data-csm-tour', 'false');
        await expect(page.locator('body')).toHaveAttribute('data-csm-budget', 'balanced');
        await expect(page.locator('body')).toHaveAttribute('data-csm-map-size', '1024');
        await expect(page.locator('body')).toHaveAttribute('data-csm-shadow-texels', '4194304');
        await expect(page.locator('body')).toHaveAttribute('data-time-of-day', 'morning');
        await expect(page.locator('body')).toHaveAttribute('data-csm-dusk-progress', '0.0000');
        await expect(page.locator('body')).toHaveAttribute('data-csm-local-lights', '0');
        await expect(page.locator('body')).toHaveAttribute('data-csm-windows-lit', 'false');
        await expect(page.locator('[data-cascade-count="4"]')).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await expect(page.locator('#splitValues')).toContainText('C4 220.0 m');
        await expect(page.locator('#modeSummary')).toContainText('4 ×');
        await expect(page.locator('[data-view="courtyard"]')).toHaveAttribute(
            'aria-pressed',
            'true'
        );

        const captureScene = async (): Promise<PNG> => {
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            return PNG.sync.read(
                await captureStableFrame(page, backend, {
                    frames: 2,
                    style: '.csmOverlay { visibility: hidden !important; }'
                })
            );
        };
        const changedPixelFraction = (before: PNG, after: PNG): number => {
            expect(after.width).toBe(before.width);
            expect(after.height).toBe(before.height);
            let changed = 0;
            for (let offset = 0; offset < before.data.length; offset += 4) {
                const difference = Math.max(
                    Math.abs((before.data[offset] ?? 0) - (after.data[offset] ?? 0)),
                    Math.abs((before.data[offset + 1] ?? 0) - (after.data[offset + 1] ?? 0)),
                    Math.abs((before.data[offset + 2] ?? 0) - (after.data[offset + 2] ?? 0))
                );
                if (difference > 12) changed++;
            }
            return changed / (before.width * before.height);
        };
        const meanLuminance = (scene: PNG): number => {
            let total = 0;
            for (let offset = 0; offset < scene.data.length; offset += 4)
                total +=
                    0.2126 * (scene.data[offset] ?? 0) +
                    0.7152 * (scene.data[offset + 1] ?? 0) +
                    0.0722 * (scene.data[offset + 2] ?? 0);
            return total / (scene.width * scene.height);
        };
        const courtyardScene = await captureScene();
        const courtyardCaption = await page.locator('#viewCaption').textContent();

        await page.locator('[data-view="compare"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-view', 'compare');
        await expect(page.locator('body')).toHaveAttribute('data-csm-motion', 'false');
        await expect(page.locator('body')).toHaveAttribute('data-csm-budget', 'study');
        await expect(page.locator('#shadowQuality')).toHaveValue('study');
        await expect(page.locator('#lambdaControl')).toHaveValue('0.65');
        await expect(page.locator('body')).toHaveAttribute('data-csm-map-size', '512');
        await expect(page.locator('body')).toHaveAttribute('data-csm-shadow-texels', '1048576');
        const cascadedStudy = await captureScene();

        await page.locator('[data-cascade-count="1"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-mode', '1');
        await expect(page.locator('#modeSummary')).toContainText('single');
        await expect(page.locator('body')).toHaveAttribute('data-csm-map-size', '1024');
        await expect(page.locator('body')).toHaveAttribute('data-csm-shadow-texels', '1048576');
        expect(
            changedPixelFraction(cascadedStudy, await captureScene()),
            'The paused comparison view must make equal-budget single and cascaded shadows visibly different'
        ).toBeGreaterThan(0.002);

        await page.locator('[data-cascade-count="0"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-mode', 'off');
        expect(
            changedPixelFraction(cascadedStudy, await captureScene()),
            'Disabling shadows must visibly change the rendered toy landscape'
        ).toBeGreaterThan(0.0002);
        await page.locator('[data-cascade-count="4"]').click();

        await page.locator('[data-view="detail"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-view', 'detail');
        await expect(page.locator('[data-view="detail"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#viewCaption')).not.toHaveText(courtyardCaption ?? '');
        await expect(page.locator('body')).toHaveAttribute('data-csm-budget', 'balanced');
        await expect(page.locator('#shadowQuality')).toHaveValue('balanced');
        await expect(page.locator('#lambdaControl')).toHaveValue('0.3');
        await expect(page.locator('body')).toHaveAttribute('data-csm-map-size', '1024');
        await expect(page.locator('body')).toHaveAttribute('data-csm-shadow-texels', '4194304');
        expect(
            changedPixelFraction(courtyardScene, await captureScene()),
            'The detail preset must change the camera view, beyond its UI label'
        ).toBeGreaterThan(0.05);

        await page.locator('#tourToggle').click();
        await expect(page.locator('#tourToggle')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-csm-tour', 'true');
        await page.locator('[data-view="distance"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-view', 'distance');
        await expect(page.locator('body')).toHaveAttribute('data-csm-tour', 'false');
        await expect(page.locator('#tourToggle')).toHaveAttribute('aria-pressed', 'false');

        await page.locator('#trainToggle').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-train', 'true');
        await page.locator('[data-cascade-count="1"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-train', 'true');
        await expect(page.locator('#trainToggle')).toHaveAttribute('aria-pressed', 'true');
        await page.locator('[data-cascade-count="4"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-motion', 'true');
        await page.locator('#trainToggle').click();
        await page.locator('[data-cascade-count="1"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-motion', 'false');
        await page.locator('[data-cascade-count="4"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-train', 'false');

        await page.getByText('Shadow settings', { exact: true }).click();
        await page.locator('#stabilizeToggle').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-stabilized', 'false');
        await page.locator('#distanceControl').evaluate(element => {
            if (!(element instanceof HTMLInputElement)) {
                throw new Error('Expected #distanceControl to be an input element');
            }
            element.value = '90';
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await expect(page.locator('body')).toHaveAttribute('data-csm-mode', '4');
        await expect(page.locator('#distanceOutput')).toHaveText('90 m');
        await expect(page.locator('#splitValues')).toContainText('C4 90.0 m');
        await page.locator('#strengthControl').evaluate(element => {
            if (!(element instanceof HTMLInputElement)) {
                throw new Error('Expected #strengthControl to be an input element');
            }
            element.value = '1.2';
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await expect(page.locator('body')).toHaveAttribute('data-csm-strength', '1.2');
        await expect(page.locator('#strengthOutput')).toHaveText('1.20');
        await page.getByText('Shadow settings', { exact: true }).click();

        await page.locator('[data-view="courtyard"]').click();
        const morningScene = await captureScene();
        await page.locator('[data-time="dusk"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-time-of-day', 'dusk');
        await expect(page.locator('[data-time="dusk"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-csm-local-lights', '5');
        await expect(page.locator('body')).toHaveAttribute('data-csm-windows-lit', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-csm-motion', 'false');
        await expect(page.locator('body')).toHaveAttribute('data-csm-local-shadows', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-csm-lights-ready', 'true', {
            timeout: 15_000
        });
        await expect(page.locator('body')).toHaveAttribute('data-csm-dusk-progress', '1.0000');
        const illuminatedDusk = await captureScene();
        expect(
            changedPixelFraction(morningScene, illuminatedDusk),
            'Dusk must visibly transform the rendered landscape beyond the time-of-day label'
        ).toBeGreaterThan(0.08);
        expect(
            meanLuminance(illuminatedDusk),
            'Dusk must visibly darken the scene while the town lights are enabled'
        ).toBeLessThan(meanLuminance(morningScene) * 0.82);

        await page.getByText('Shadow settings', { exact: true }).click();
        await page.locator('#localShadowToggle').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-local-shadows', 'false');
        await expect(page.locator('#localShadowToggle')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('body')).toHaveAttribute('data-csm-local-lights', '5');
        const unshadowedDusk = await captureScene();
        expect(
            changedPixelFraction(illuminatedDusk, unshadowedDusk),
            'Local spotlights must cast visible shadows on the paused dusk scene'
        ).toBeGreaterThan(0.0002);
        await page.locator('#localShadowToggle').click();
        await expect(page.locator('body')).toHaveAttribute('data-csm-local-shadows', 'true');
        await expect(page.locator('#localShadowToggle')).toHaveAttribute('aria-pressed', 'true');
        expect(
            changedPixelFraction(illuminatedDusk, await captureScene()),
            'Restoring local shadows must reproduce the paused dusk image'
        ).toBeLessThan(0.00002);

        await page.locator('[data-time="morning"]').click();
        await expect(page.locator('body')).toHaveAttribute('data-time-of-day', 'morning');
        await expect(page.locator('[data-time="morning"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-csm-local-lights', '0');
        await expect(page.locator('body')).toHaveAttribute('data-csm-windows-lit', 'false');
        await expect(page.locator('body')).toHaveAttribute('data-csm-lights-ready', 'true', {
            timeout: 15_000
        });
        await expect(page.locator('body')).toHaveAttribute('data-csm-dusk-progress', '0.0000');

        await assertObservableRender(page, 'cascaded_shadows.html', backend);
        await assertStableInstrumentationHealth(
            backend,
            `cascaded shadow toy diorama render health on ${backend}`,
            {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            }
        );
        expect(pageErrors).toEqual([]);
    });

    test(`cascaded shadow toy transitions gradually and reversibly while paused through ${backend} @${backend}`, async ({
        page
    }) => {
        test.setTimeout(120_000);
        const pageErrors: string[] = [];
        page.on('pageerror', error => {
            recordUnique(pageErrors, error.message);
        });
        await page.setViewportSize({ width: 640, height: 420 });
        // Install before navigation so the running scene never changes clock implementations.
        await page.clock.install();
        await installRenderHealthProbe(page);
        // This case already owns RAF/timer pacing through Playwright's clock. GPU completion
        // runs in real time and must not gate callbacks advanced by the virtual clock.
        await page.goto(`${exampleRequestUrl('cascaded_shadows.html', backend)}&testClock=1`, {
            waitUntil: 'networkidle'
        });
        const body = page.locator('body');
        await expect(body).toHaveAttribute('data-csm-ready', 'true');
        await page.locator('#trainToggle').click();
        await expect(body).toHaveAttribute('data-csm-motion', 'false');
        // Leave headroom for software frames; pauseAt fires each pending timer only once.
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
        const switchTime = async (
            time: 'morning' | 'dusk'
        ): Promise<{ progress: number; lightsReady: string | undefined }> =>
            page.locator(`[data-time="${time}"]`).evaluate(button => {
                if (!(button instanceof HTMLButtonElement)) {
                    throw new Error('Expected the time-of-day control to be a button');
                }
                button.click();
                return {
                    progress: Number(document.body.dataset['csmDuskProgress']),
                    lightsReady: document.body.dataset['csmLightsReady']
                };
            });
        const readDuskProgress = async (): Promise<number> =>
            Number(await body.getAttribute('data-csm-dusk-progress'));
        expect(await switchTime('dusk')).toEqual({ progress: 0, lightsReady: 'false' });
        // Sample one intermediate frame without relying on software rendering speed.
        await page.clock.fastForward(2500);
        const midpoint = await readDuskProgress();
        expect(midpoint).toBeGreaterThan(0.2);
        expect(midpoint).toBeLessThan(0.8);
        expect(await switchTime('morning')).toEqual({
            progress: midpoint,
            lightsReady: 'false'
        });
        await page.clock.fastForward(1000);
        const returning = await readDuskProgress();
        expect(returning).toBeGreaterThan(0);
        expect(returning).toBeLessThan(midpoint);
        expect(await switchTime('dusk')).toEqual({
            progress: returning,
            lightsReady: 'false'
        });
        await page.clock.fastForward(5000);
        await expect(body).toHaveAttribute('data-csm-dusk-progress', '1.0000');
        await expect(body).toHaveAttribute('data-csm-lights-ready', 'true');
        await expect(body).toHaveAttribute('data-csm-local-lights', '5');
        expect(await switchTime('morning')).toEqual({ progress: 1, lightsReady: 'false' });
        await page.clock.fastForward(2500);
        const sunrise = await readDuskProgress();
        expect(sunrise).toBeGreaterThan(0.2);
        expect(sunrise).toBeLessThan(0.8);
        await expect(body).toHaveAttribute('data-csm-lights-ready', 'false');
        await page.clock.fastForward(2500);
        await expect(body).toHaveAttribute('data-csm-dusk-progress', '0.0000');
        await expect(body).toHaveAttribute('data-csm-lights-ready', 'true');
        await expect(body).toHaveAttribute('data-csm-local-lights', '0');
        await expect(body).toHaveAttribute('data-csm-motion', 'false');
        await page.clock.resume();
        await assertObservableRender(page, 'cascaded_shadows.html', backend);
        await assertStableInstrumentationHealth(
            backend,
            `cascaded shadow toy transition render health on ${backend}`,
            {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            }
        );
        expect(pageErrors).toEqual([]);
    });

    test(`cascaded shadow toy weather accumulates snow and preserves motion through ${backend} @${backend}`, async ({
        page
    }) => {
        test.setTimeout(backend === 'webgl2' ? 300_000 : 210_000);
        const pageErrors: string[] = [];
        page.on('pageerror', error => {
            recordUnique(pageErrors, error.message);
        });
        await page.setViewportSize({ width: 960, height: 640 });
        await installRenderHealthProbe(page);
        await page.goto(exampleRequestUrl('cascaded_shadows.html', backend), {
            waitUntil: 'networkidle'
        });
        const body = page.locator('body');
        await expect(body).toHaveAttribute('data-csm-ready', 'true');
        await expect(body).toHaveAttribute('data-weather', 'clear');
        await expect(body).toHaveAttribute('data-csm-motion', 'true');
        await expect(page.locator('#lightningButton')).toBeHidden();
        await page.locator('#trainToggle').click();
        await expect(body).toHaveAttribute('data-csm-motion', 'false');

        const captureScene = async (): Promise<PNG> => {
            await waitForStableAnimationFrames(page);
            await awaitTrackedGPUQueues(page);
            return PNG.sync.read(
                await captureStableFrame(page, backend, {
                    frames: 2,
                    style: '.csmOverlay { visibility: hidden !important; }'
                })
            );
        };
        const changedPixelFraction = (before: PNG, after: PNG): number => {
            expect(after.width).toBe(before.width);
            expect(after.height).toBe(before.height);
            let changed = 0;
            for (let offset = 0; offset < before.data.length; offset += 4) {
                if (
                    Math.max(
                        Math.abs((before.data[offset] ?? 0) - (after.data[offset] ?? 0)),
                        Math.abs((before.data[offset + 1] ?? 0) - (after.data[offset + 1] ?? 0)),
                        Math.abs((before.data[offset + 2] ?? 0) - (after.data[offset + 2] ?? 0))
                    ) > 12
                )
                    changed++;
            }
            return changed / (before.width * before.height);
        };
        const setSnowAmount = async (amount: number): Promise<void> => {
            await page.locator('#snowAmount').evaluate((element, value) => {
                if (!(element instanceof HTMLInputElement)) {
                    throw new Error('Expected #snowAmount to be a range input');
                }
                element.value = String(value);
                element.dispatchEvent(new Event('input', { bubbles: true }));
            }, amount);
            await expect(body).toHaveAttribute('data-csm-snow-amount', String(amount));
            await expect(page.locator('#snowAmountOutput')).toHaveText(`${String(amount)}%`);
        };

        const clearScene = await captureScene();
        await page.locator('button[data-weather="rain"]').click();
        await expect(body).toHaveAttribute('data-weather', 'rain');
        await expect(page.locator('button[data-weather="rain"]')).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        await expect(body).toHaveAttribute('data-csm-motion', 'false');
        await expect(body).toHaveAttribute('data-csm-train', 'false');
        expect(
            changedPixelFraction(clearScene, await captureScene()),
            'Rain must change the rendered weather beyond its selected button'
        ).toBeGreaterThan(0.0003);

        await page.locator('button[data-weather="snow"]').click();
        await expect(body).toHaveAttribute('data-weather', 'snow');
        await expect(body).toHaveAttribute('data-csm-snow-amount', '0');
        await expect(body).toHaveAttribute('data-csm-motion', 'false');
        const fallingSnowWithoutCover = await captureScene();
        await page.getByText('Shadow settings', { exact: true }).click();
        await setSnowAmount(80);
        expect(
            changedPixelFraction(fallingSnowWithoutCover, await captureScene()),
            'Accumulation must visibly cover the town surfaces while flakes stay at the same phase'
        ).toBeGreaterThan(0.03);
        await setSnowAmount(0);
        expect(
            changedPixelFraction(fallingSnowWithoutCover, await captureScene()),
            'Removing accumulated snow must restore the paused scene without hiding falling flakes'
        ).toBeLessThan(0.0002);

        await page.locator('#trainToggle').click();
        await expect(body).toHaveAttribute('data-csm-train', 'true');
        await expect
            .poll(async () => Number(await body.getAttribute('data-csm-snow-amount')))
            .toBeGreaterThan(0);
        await page.locator('button[data-weather="storm"]').click();
        await expect(body).toHaveAttribute('data-weather', 'storm');
        await expect(body).toHaveAttribute('data-csm-motion', 'true');
        await expect(body).toHaveAttribute('data-csm-train', 'true');
        await page.locator('#trainToggle').click();
        await expect(body).toHaveAttribute('data-csm-motion', 'false');
        await expect(page.locator('#lightningButton')).toBeVisible();
        const lightning = page.locator('#lightningButton');
        await lightning.click({ trial: true });
        const flashAtTrigger = await lightning.evaluate(button => {
            if (!(button instanceof HTMLButtonElement)) throw new Error('Missing lightning button');
            button.click();
            return document.body.dataset['csmLightning'];
        });
        expect(flashAtTrigger).toBe('true');
        await expect(body).toHaveAttribute('data-csm-lightning', 'false');

        const lightsReadyImmediately = await page.locator('[data-time="dusk"]').evaluate(button => {
            if (!(button instanceof HTMLButtonElement)) {
                throw new Error('Expected the dusk control to be a button');
            }
            button.click();
            return document.body.dataset['csmLightsReady'];
        });
        expect(lightsReadyImmediately).toBe('false');
        await expect(body).toHaveAttribute('data-csm-lights-ready', 'true', { timeout: 15_000 });
        await expect(body).toHaveAttribute('data-csm-motion', 'false');
        await page.locator('button[data-weather="clear"]').click();
        await expect(body).toHaveAttribute('data-weather', 'clear');
        await expect(page.locator('#lightningButton')).toBeHidden();

        await assertStableInstrumentationHealth(
            backend,
            `cascaded shadow toy weather render health on ${backend}`,
            {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            }
        );
        expect(pageErrors).toEqual([]);
    });
}

test.describe('examples using the generic release gate', () => {
    // Parallel mode lets Playwright shard individual catalog cases across isolated CI machines.
    // Every machine still uses one worker, so SwiftShader work remains serial within each process;
    // unlike serial mode, one failure cannot skip the remainder of the release matrix. Heavy
    // examples may use a dedicated gate with stronger example-specific output.
    test.describe.configure({ mode: 'parallel' });

    for (const exampleCase of exampleCases) {
        const { path: examplePath, backend } = exampleCase;
        if (exampleUsesDedicatedReleaseTest(examplePath)) continue;
        test(`${examplePath} renders through ${backend} @${backend}`, async ({ page }) => {
            if (
                examplePath === 'pbr2.html' ||
                examplePath === 'ground_truth_ambient_occlusion.html' ||
                examplePath === 'particle_gpu_nebula.html' ||
                examplePath === 'particle_noise_fields.html' ||
                examplePath === 'particle_orbital_weave.html'
            ) {
                // HDR material/particle galleries and multi-pass post-processing require extra
                // time for software rendering under CI SwiftShader.
                test.slow();
            }
            await installRenderHealthProbe(page);

            const consoleErrors: string[] = [];
            const cdpGraphicsErrors: string[] = [];
            const pageErrors: string[] = [];
            const failedRequests: string[] = [];
            const failedResponses: string[] = [];
            const devtools = await page.context().newCDPSession(page);
            await devtools.send('Log.enable');

            devtools.on('Log.entryAdded', ({ entry }) => {
                const description = `${entry.source}: ${entry.text}`;
                if (
                    entry.level === 'error' &&
                    (entry.source === 'rendering' || GPU_DIAGNOSTIC_ERROR.test(description))
                ) {
                    recordUnique(cdpGraphicsErrors, description);
                }
            });
            page.on('console', message => {
                if (message.type() === 'error') recordUnique(consoleErrors, message.text());
            });
            page.on('pageerror', error => {
                recordUnique(pageErrors, error.message);
            });
            page.on('requestfailed', request => {
                const failure = request.failure()?.errorText ?? 'unknown network failure';
                recordUnique(failedRequests, `${request.method()} ${request.url()}: ${failure}`);
            });
            page.on('response', response => {
                if (response.status() >= 400) {
                    recordUnique(
                        failedResponses,
                        `${String(response.status())} ${response.request().method()} ${response.url()}`
                    );
                }
            });

            const response = await page.goto(exampleRequestUrl(examplePath, backend), {
                waitUntil: 'load'
            });
            await page.waitForLoadState('networkidle');
            await assertCompletionContract(
                page,
                completionContractForExample(examplePath),
                backend
            );
            if (exampleRequiresRendering(examplePath)) {
                await assertObservableRender(page, examplePath, backend);
            }

            expect(response?.ok(), `HTTP status for ${examplePath} on ${backend}`).toBe(true);

            const rootContract = await page.evaluate(() => ({
                moduleScriptCount: document.querySelectorAll('script[type="module"]').length,
                bodyChildCount: document.body.children.length
            }));
            expect(rootContract.moduleScriptCount).toBeGreaterThan(0);
            expect(rootContract.bodyChildCount).toBeGreaterThan(0);

            const contract = await readPageContract(page);
            for (const canvas of contract.canvases) {
                expect(canvas.width, `${canvas.frameUrl} canvas width`).toBeGreaterThan(0);
                expect(canvas.height, `${canvas.frameUrl} canvas height`).toBeGreaterThan(0);
                expect(
                    canvas.clientWidth,
                    `${canvas.frameUrl} canvas client width`
                ).toBeGreaterThan(0);
                expect(
                    canvas.clientHeight,
                    `${canvas.frameUrl} canvas client height`
                ).toBeGreaterThan(0);
            }

            if (exampleRequiresRendering(examplePath)) {
                expect(
                    contract.backendCanvases.length,
                    `${examplePath} must expose a renderer-owned backend canvas`
                ).toBeGreaterThan(0);
                expect(
                    [...new Set(contract.backendCanvases.map(canvas => canvas.backend))],
                    `renderer backend for ${examplePath}`
                ).toEqual([backend]);
            } else {
                expect(
                    contract.backendCanvases,
                    `${examplePath} is the declared non-rendering example`
                ).toEqual([]);
            }

            if (exampleRequiresRendering(examplePath)) {
                await assertStableInstrumentationHealth(
                    backend,
                    `graphics instrumentation errors in ${examplePath} on ${backend}`,
                    {
                        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                        readRenderHealth: () => readRenderHealth(page)
                    }
                );
                await expectVisibleCanvasPresentations(page, examplePath, backend);
            } else {
                await waitForStableAnimationFrames(page);
            }

            if (examplePath === 'video.html') {
                await page.evaluate(async () => {
                    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
                    // Keep the document alive long enough to catch uploads after source disposal.
                    for (let frame = 0; frame < 3; frame++) {
                        await new Promise<void>(resolve => {
                            requestAnimationFrame(() => {
                                resolve();
                            });
                        });
                    }
                });
            }
            await devtools.detach();
            expect(pageErrors, `page errors in ${examplePath} on ${backend}`).toEqual([]);
            expect(consoleErrors, `console errors in ${examplePath} on ${backend}`).toEqual([]);
            expect(
                cdpGraphicsErrors,
                `CDP graphics errors in ${examplePath} on ${backend}`
            ).toEqual([]);
            expect(failedRequests, `failed requests in ${examplePath} on ${backend}`).toEqual([]);
            expect(failedResponses, `HTTP failures in ${examplePath} on ${backend}`).toEqual([]);
        });
    }
});

test.describe('WebGL render-health browser contract', () => {
    test('counts a valid native draw and keeps the final health gate clean', async ({ page }) => {
        await installRenderHealthProbe(page);
        await page.goto('/test/ui/fixtures/render-health-webgl.html?mode=valid', {
            waitUntil: 'load'
        });
        await expect(page.locator('body')).toHaveAttribute('data-render-health-complete', 'valid');

        expect(completedRenderCommands(await readRenderHealth(page), 'webgl2')).toBe(1);
        await expect(
            assertStableInstrumentationHealth('webgl2', 'valid WebGL draw', {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            })
        ).resolves.toBeUndefined();
    });

    test('retains an invalid native draw error and refuses to count it as progress', async ({
        page
    }) => {
        await installRenderHealthProbe(page);
        await page.goto('/test/ui/fixtures/render-health-webgl.html?mode=invalid', {
            waitUntil: 'load'
        });
        await expect(page.locator('body')).toHaveAttribute(
            'data-render-health-complete',
            'invalid'
        );

        const health = await readRenderHealth(page);
        expect(completedRenderCommands(health, 'webgl2')).toBe(0);
        expect(instrumentationErrors(health, 'webgl2').join('\n')).toContain(
            'INVALID_OPERATION (0x0502)'
        );
        await expect(
            assertStableInstrumentationHealth('webgl2', 'invalid WebGL draw', {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            })
        ).rejects.toThrow('INVALID_OPERATION (0x0502)');
    });

    test('samples native errors issued after the final draw before accepting health', async ({
        page
    }) => {
        await installRenderHealthProbe(page);
        await page.goto('/test/ui/fixtures/render-health-webgl.html?mode=invalid-after-draw', {
            waitUntil: 'load'
        });
        await expect(page.locator('body')).toHaveAttribute(
            'data-render-health-complete',
            'invalid-after-draw'
        );

        const health = await readRenderHealth(page);
        expect(completedRenderCommands(health, 'webgl2')).toBe(1);
        expect(instrumentationErrors(health, 'webgl2').join('\n')).toContain(
            'finalHealthSnapshot: INVALID_ENUM (0x0500)'
        );
        await expect(
            assertStableInstrumentationHealth('webgl2', 'trailing WebGL error', {
                waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
                awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
                readRenderHealth: () => readRenderHealth(page)
            })
        ).rejects.toThrow('finalHealthSnapshot: INVALID_ENUM (0x0500)');
    });
});

test.describe('WebGPU render-health browser contract', () => {
    test('fences every tracked native GPUQueue before the final snapshot', async ({ page }) => {
        await installRenderHealthProbe(page);
        await page.goto('/test/ui/fixtures/blank.html', { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
            const adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: false });
            if (!adapter) throw new Error('WebGPU queue-fence fixture requires an adapter.');
            const device = await adapter.requestDevice();
            const queue = device.queue;
            const nativeCompletion = queue.onSubmittedWorkDone.bind(queue);
            Reflect.set(window, '__HILO3D_QUEUE_FENCE_COUNT__', 0);
            Reflect.set(window, '__HILO3D_QUEUE_FENCE_DEVICE__', device);
            Object.defineProperty(queue, 'onSubmittedWorkDone', {
                configurable: true,
                writable: true,
                async value(): Promise<void> {
                    const current: unknown = Reflect.get(window, '__HILO3D_QUEUE_FENCE_COUNT__');
                    Reflect.set(
                        window,
                        '__HILO3D_QUEUE_FENCE_COUNT__',
                        typeof current === 'number' ? current + 1 : 1
                    );
                    await nativeCompletion();
                }
            });
            const encoder = device.createCommandEncoder({ label: 'render-health queue fence' });
            queue.submit([encoder.finish()]);
        });

        expect(
            await page.evaluate(() => {
                const value: unknown = Reflect.get(window, '__HILO3D_QUEUE_FENCE_COUNT__');
                return typeof value === 'number' ? value : -1;
            })
        ).toBe(0);
        await assertStableInstrumentationHealth('webgpu', 'native queue fence contract', {
            waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
            awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
            readRenderHealth: () => readRenderHealth(page)
        });
        expect(
            await page.evaluate(() => {
                const value: unknown = Reflect.get(window, '__HILO3D_QUEUE_FENCE_COUNT__');
                return typeof value === 'number' ? value : -1;
            })
        ).toBeGreaterThan(0);
        await page.evaluate(() => {
            const device: unknown = Reflect.get(window, '__HILO3D_QUEUE_FENCE_DEVICE__');
            if (typeof device === 'object' && device !== null) {
                const destroy: unknown = Reflect.get(device, 'destroy');
                if (typeof destroy === 'function') Reflect.apply(destroy, device, []);
            }
        });
    });
});

/** Canvas coordinates follow the exhibit's centered 1000 × 620 design space. */
async function studioPoint(
    page: Page,
    x: number,
    y: number,
    designWidth = 1000,
    designHeight = 620
): Promise<{ x: number; y: number }> {
    const bounds = await page.locator('#container canvas').boundingBox();
    if (!bounds) throw new Error('2D Studio canvas is missing');
    const scale = Math.min(bounds.width / designWidth, bounds.height / designHeight);
    return {
        x: bounds.x + (bounds.width - designWidth * scale) / 2 + x * scale,
        y: bounds.y + (bounds.height - designHeight * scale) / 2 + y * scale
    };
}

for (const backend of ['webgl2', 'webgpu'] as const) {
    test(`2D studio animation and composition controls @${backend}`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`2d_sprite_animation.html?backend=${backend}`);
        await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true');
        await page.getByRole('button', { name: 'Frame 4', exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-frame', '3');
        await expect(page.locator('body')).toHaveAttribute('data-playing', 'false');
        const frameFour = await page.locator('#container canvas').screenshot();
        await page.getByRole('button', { name: 'Frame 1', exact: true }).click();
        await expect(page.locator('body')).toHaveAttribute('data-frame', '0');
        expect((await page.locator('#container canvas').screenshot()).equals(frameFour)).toBe(
            false
        );
        const moth = await studioPoint(page, 500, 315);
        await page.mouse.click(moth.x, moth.y);
        await expect(page.locator('body')).toHaveAttribute('data-playing', 'true');
        await page.getByRole('checkbox', { name: '显示 3D 天体' }).uncheck();
        await expect(page.getByRole('checkbox', { name: '显示 3D 天体' })).not.toBeChecked();
        for (const link of await page.locator('.studio-tab').all()) {
            await expect(link).toHaveAttribute('href', new RegExp(`backend=${backend}`));
        }
    });

    test(`2D studio batch population and formations @${backend}`, async ({ page }) => {
        test.slow();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`2d_sprite_batch.html?backend=${backend}`);
        await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-triangle-count', /^[1-9]\d*$/u);
        const initialTriangles = Number(
            await page.locator('body').getAttribute('data-triangle-count')
        );
        const initialDraws = Number(await page.locator('body').getAttribute('data-draw-count'));
        await expect(page.locator('#container .studio-render-debug')).toBeVisible();
        await expect(page.locator('.studio-inspector .studio-render-debug')).toHaveCount(0);
        await expect(page.locator('.studio-inspector')).not.toContainText('BATCH NOTES');
        await page.getByLabel('精灵数量', { exact: true }).selectOption('512');
        await expect(page.locator('body')).toHaveAttribute('data-sprite-count', '512');
        await expect(page.locator('body')).toHaveAttribute(
            'data-triangle-count',
            String(initialTriangles - 7168)
        );
        await expect(page.locator('body')).toHaveAttribute(
            'data-draw-count',
            String(initialDraws - 28)
        );
        const spiral = await page.locator('#container canvas').screenshot();
        await page.getByLabel('星群队形', { exact: true }).selectOption('Ribbon river');
        await expect(page.locator('body')).toHaveAttribute('data-formation', 'Ribbon river');
        expect((await page.locator('#container canvas').screenshot()).equals(spiral)).toBe(false);
        await page.getByLabel('精灵数量', { exact: true }).selectOption('8192');
        await expect(page.locator('body')).toHaveAttribute('data-sprite-count', '8192');
        await expect(page.locator('body')).toHaveAttribute(
            'data-triangle-count',
            String(initialTriangles + 8192)
        );
        await expect(page.locator('body')).toHaveAttribute(
            'data-draw-count',
            String(initialDraws + 32)
        );
        await expect(
            page.locator('.studio-metric').filter({ hasText: '预期精灵批次' })
        ).toContainText('64');
    });

    test(`2D studio nine-slice pointer states and resized hit regions @${backend}`, async ({
        page
    }) => {
        await page.goto(`2d_ui_button.html?backend=${backend}`);
        await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true');
        await expect(page.locator('.studio-slice-source span')).toHaveCount(9);
        await expect(page.getByRole('checkbox', { name: '显示九宫格切线' })).toBeChecked();
        const button = await studioPoint(page, 650, 296);
        await page.mouse.move(button.x, button.y);
        await expect(page.locator('body')).toHaveAttribute('data-button-state', 'hover');
        await page.mouse.down();
        await expect(page.locator('body')).toHaveAttribute('data-button-state', 'down');
        await page.mouse.up();
        await expect(page.locator('body')).toHaveAttribute('data-dispatches', '1');
        const locked = await studioPoint(page, 650, 452);
        await page.mouse.click(locked.x, locked.y);
        await expect(page.locator('body')).toHaveAttribute('data-dispatches', '1');
        await page.getByRole('checkbox', { name: '解锁群星山谷' }).check();
        await page.mouse.click(locked.x, locked.y);
        await expect(page.locator('body')).toHaveAttribute('data-dispatches', '2');
        await page.getByLabel('按钮宽度', { exact: true }).fill('210');
        await page.getByLabel('按钮高度', { exact: true }).fill('74');
        await waitForStableAnimationFrames(page);
        const outside = await studioPoint(page, 795, 296);
        await page.mouse.click(outside.x, outside.y);
        await expect(page.locator('body')).toHaveAttribute('data-dispatches', '2');
        await page.mouse.click(button.x, button.y);
        await expect(page.locator('body')).toHaveAttribute('data-dispatches', '3');
        await page.getByLabel('按钮宽度', { exact: true }).fill('410');
        await page.getByLabel('按钮高度', { exact: true }).fill('42');
        await waitForStableAnimationFrames(page);
        await page.mouse.click(outside.x, outside.y);
        await expect(page.locator('body')).toHaveAttribute('data-dispatches', '4');
        await page.getByLabel('九宫格美术皮肤').selectOption('Rose Reliquary · 玫瑰秘藏');
        await expect(page.locator('body')).toHaveAttribute(
            'data-ui-skin',
            'Rose Reliquary · 玫瑰秘藏'
        );
        await waitForStableAnimationFrames(page);
        await page.mouse.click(outside.x, outside.y);
        await expect(page.locator('body')).toHaveAttribute('data-dispatches', '5');
    });

    test(`2D studio editable text, wrapping and town routing @${backend}`, async ({ page }) => {
        await page.goto(`2d_text.html?backend=${backend}`);
        await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true');
        const before = await page.locator('#container canvas').screenshot();
        await page.getByLabel('Postcard message').fill('月光来信 / A new journey.');
        await page.getByRole('button', { name: '寄出明信片 / Send' }).click();
        await expect(page.locator('body')).toHaveAttribute('data-letters-sent', '1');
        expect((await page.locator('#container canvas').screenshot()).equals(before)).toBe(false);
        await page.goto(`2d_text_layout.html?backend=${backend}`);
        await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true');
        const wide = await page.locator('#container canvas').screenshot();
        await page.getByLabel('卡片宽度', { exact: true }).fill('260');
        await expect(page.locator('body')).toHaveAttribute('data-text-width', '208');
        await page.getByLabel('摘录最多行数', { exact: true }).fill('1');
        expect((await page.locator('#container canvas').screenshot()).equals(wide)).toBe(false);
        await page.goto(`2d_sorting_town.html?backend=${backend}`);
        await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-town-character', 'yui-hirasawa');
        await page.getByLabel('角色位置对照').selectOption('花坛后方');
        await expect(page.locator('body')).toHaveAttribute('data-town-pose', '花坛后方');
        await waitForStableAnimationFrames(page);
        const behind = await page.locator('#container canvas').screenshot();
        await page.getByRole('checkbox', { name: '启用脚底 Y 排序' }).uncheck();
        await waitForStableAnimationFrames(page);
        expect((await page.locator('#container canvas').screenshot()).equals(behind)).toBe(false);
        await page.getByRole('checkbox', { name: '启用脚底 Y 排序' }).check();
        await page.getByLabel('角色位置对照').selectOption('花坛前方');
        await expect(page.locator('body')).toHaveAttribute('data-town-pose', '花坛前方');
        await page.getByLabel('角色位置对照').selectOption('自由寻路');
        await page.getByRole('checkbox', { name: '自动巡游' }).uncheck();
        await page.getByRole('checkbox', { name: '启用脚底 Y 排序' }).uncheck();
        await expect(page.locator('body')).toHaveAttribute('data-sorting', 'false');
        await page.locator('#container canvas').click({ position: { x: 250, y: 250 } });
        await expect(page.locator('body')).toHaveAttribute('data-route-mode', 'player');
    });
}

test('2D studio phone layout keeps exhibits and controls inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of [
        '2d_sprite_animation',
        '2d_sprite_batch',
        '2d_text',
        '2d_text_layout',
        '2d_ui_button',
        '2d_sorting_town'
    ]) {
        await page.goto(`${path}.html?backend=webgl2`);
        await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
            390
        );
        if (path === '2d_ui_button') {
            const point = await studioPoint(page, 230, 489, 460, 780);
            await page.mouse.click(point.x, point.y);
            await expect(page.locator('body')).toHaveAttribute('data-dispatches', '1');
        }
        if (path === '2d_text') {
            const point = await studioPoint(page, 130, 626, 460, 790);
            await page.mouse.click(point.x, point.y);
            await expect(page.locator('body')).toHaveAttribute('data-letters-sent', '1');
        }
        for (const selector of ['#container', '.studio-inspector']) {
            const bounds = await page.locator(selector).boundingBox();
            if (!bounds) throw new Error(`${path}: ${selector} is missing`);
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
        }
    }
});
