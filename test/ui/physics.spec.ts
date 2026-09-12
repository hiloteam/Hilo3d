import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import {
    PHYSICS_RELEASE_TEST_CASES,
    type PHYSICS_RELEASE_TEST_EXAMPLES,
    type ExampleBackend
} from './example-paths';
import { installPageFailureMonitor } from './page-failure-monitor';
import { captureStableFrame } from './stable-capture';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    completedRenderCommands,
    installRenderHealthProbe,
    nativeRenderProgress,
    nativeRenderProgressAdvanced,
    readRenderHealth,
    waitForStableAnimationFrames
} from './render-health';

// Video and trace screencasts compete with SwiftShader for CPU. Keep DOM/action/network traces,
// attach a real canvas PNG in every case, and retain native draws, errors, and GPU queue fences.
test.use({
    video: 'off',
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true }
});

const POLL_TIMEOUT = 30_000;
type Scene = (typeof PHYSICS_RELEASE_TEST_EXAMPLES)[number];

async function assertExhibitPixels(
    page: Page,
    backend: ExampleBackend,
    testInfo: TestInfo,
    name: string
): Promise<Buffer> {
    const canvas = page.locator(`canvas[data-hilo3d-backend="${backend}"]`);
    await expect(canvas).toBeVisible();
    const frame = await canvas.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const health = window.__HILO3D_UI_RENDER_HEALTH__;
        if (!health) throw new Error('Physics screenshots require native render instrumentation');
        return {
            bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
            viewport: { x: 0, y: 0, width: innerWidth, height: innerHeight },
            health
        };
    });
    expect(frame.bounds, 'The exhibit canvas must cover the complete viewport').toEqual(
        frame.viewport
    );
    expect(
        completedRenderCommands([{ url: page.url(), snapshot: frame.health }], backend),
        'A viewport capture requires real native draws and, on WebGPU, a submitted canvas frame'
    ).toBeGreaterThan(0);
    // The canvas fills a fixed viewport. Capture its composited pixels directly without the
    // locator screenshot's scroll and consecutive-animation-frame element-stability checks.
    const capture = await captureStableFrame(page, backend);
    await testInfo.attach(`${name}-${backend}-canvas`, { body: capture, contentType: 'image/png' });
    const image = PNG.sync.read(capture);
    const mobile = image.width < 700;
    // Measure the unobstructed exhibit region. DOM captions and buttons cannot make a blank
    // canvas satisfy this gate, even though the viewport capture includes page compositing.
    const left = Math.floor(image.width * (mobile ? 0.1 : 0.28));
    const right = Math.floor(image.width * (mobile ? 0.9 : 0.92));
    const top = Math.floor(image.height * (mobile ? 0.36 : 0.22));
    const bottom = Math.floor(
        mobile ? image.height * 0.76 : Math.min(image.height * 0.8, image.height - 160)
    );
    const colors = new Set<number>();
    let samples = 0;
    let bright = 0;
    let chromatic = 0;
    let minimum = 255;
    let maximum = 0;
    for (let y = top; y < bottom; y += 3) {
        for (let x = left; x < right; x += 3) {
            const offset = (y * image.width + x) * 4;
            const red = image.data[offset] ?? 0;
            const green = image.data[offset + 1] ?? 0;
            const blue = image.data[offset + 2] ?? 0;
            const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
            const peak = Math.max(red, green, blue);
            minimum = Math.min(minimum, luminance);
            maximum = Math.max(maximum, luminance);
            if (luminance > 100) bright += 1;
            if (peak > 65 && peak - Math.min(red, green, blue) > 22) chromatic += 1;
            colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
            samples += 1;
        }
    }
    expect(samples).toBeGreaterThan(1000);
    expect(colors.size, 'The exhibit must contain varied rendered material colors').toBeGreaterThan(
        48
    );
    expect(
        maximum - minimum,
        'Lit forms and shadows must span a visible luminance range'
    ).toBeGreaterThan(90);
    expect(
        bright / samples,
        'The apparatus must occupy a material part of the playfield'
    ).toBeGreaterThan(0.04);
    expect(
        chromatic / samples,
        'The apparatus must preserve its colored materials'
    ).toBeGreaterThan(0.025);
    return capture;
}

function changedPlayfieldRatio(before: Buffer, after: Buffer): number {
    const reference = PNG.sync.read(before);
    const candidate = PNG.sync.read(after);
    expect(candidate.width).toBe(reference.width);
    expect(candidate.height).toBe(reference.height);
    const mobile = reference.width < 700;
    const left = Math.floor(reference.width * (mobile ? 0.1 : 0.28));
    const right = Math.floor(reference.width * (mobile ? 0.9 : 0.92));
    const top = Math.floor(reference.height * (mobile ? 0.36 : 0.22));
    const bottom = Math.floor(
        mobile ? reference.height * 0.76 : Math.min(reference.height * 0.8, reference.height - 160)
    );
    let samples = 0;
    let changed = 0;
    for (let y = top; y < bottom; y += 3) {
        for (let x = left; x < right; x += 3) {
            const offset = (y * reference.width + x) * 4;
            let difference = 0;
            for (let channel = 0; channel < 3; channel += 1) {
                difference = Math.max(
                    difference,
                    Math.abs(
                        (reference.data[offset + channel] ?? 0) -
                            (candidate.data[offset + channel] ?? 0)
                    )
                );
            }
            if (difference > 24) changed += 1;
            samples += 1;
        }
    }
    return changed / samples;
}

async function exerciseCharacterInspection(
    page: Page,
    backend: ExampleBackend,
    testInfo: TestInfo,
    name: string
): Promise<void> {
    const inspection = page.locator('#courier-inspect');
    await expect(inspection).toBeInViewport();
    await expect(page.locator('body')).toHaveAttribute('data-courier-view', 'route');
    const automatic = await page.locator('body').getAttribute('data-courier-auto');
    if (automatic !== 'true' && automatic !== 'false') {
        throw new Error('The courier must expose its actual patrol state before inspection');
    }
    const pausedStep = await pause(page);
    const before = await assertExhibitPixels(page, backend, testInfo, `${name}-route`);
    const progress = nativeRenderProgress(await readRenderHealth(page), backend);
    await inspection.click();
    await expect(page.locator('body')).toHaveAttribute('data-courier-view', 'detail');
    await expect(page.locator('body')).toHaveAttribute('data-courier-auto', 'false');
    await expect(inspection).toHaveAttribute('aria-pressed', 'true');
    await waitForStableAnimationFrames(page);
    const after = await assertExhibitPixels(page, backend, testInfo, `${name}-detail`);
    expect(
        changedPlayfieldRatio(before, after),
        'Inspection must visibly reframe the frozen courier, beyond changes to DOM controls'
    ).toBeGreaterThan(0.08);
    expect(await numberReadout(page, 'physicsSteps')).toBe(pausedStep);
    expect(
        nativeRenderProgressAdvanced(
            progress,
            nativeRenderProgress(await readRenderHealth(page), backend),
            backend
        )
    ).toBe(true);
    await page.locator('#camera-home').click();
    await expect(page.locator('body')).toHaveAttribute('data-courier-view', 'route');
    await expect(page.locator('body')).toHaveAttribute('data-courier-auto', automatic);
    await expect(inspection).toHaveAttribute('aria-pressed', 'false');
    await resume(page, pausedStep);
}

async function numberReadout(page: Page, key: string): Promise<number> {
    return page.evaluate(name => Number(document.body.dataset[name] ?? Number.NaN), key);
}

async function vectorReadout(page: Page, key: string): Promise<number[]> {
    return page.evaluate(name => (document.body.dataset[name] ?? '').split(',').map(Number), key);
}

async function expectIncrease(page: Page, key: string, previous: number): Promise<void> {
    await expect
        .poll(() => numberReadout(page, key), {
            message: `${key} must advance from real simulation`,
            timeout: POLL_TIMEOUT
        })
        .toBeGreaterThan(previous);
}

async function pause(page: Page): Promise<number> {
    await page.locator('#pause').click();
    await expect(page.locator('body')).toHaveAttribute('data-paused', 'true');
    // Shared diagnostics refresh every 150 ms; drain both a render window and that readout window.
    await waitForStableAnimationFrames(page);
    await page.waitForTimeout(180);
    return numberReadout(page, 'physicsSteps');
}

async function resume(page: Page, previousStep: number): Promise<void> {
    await page.locator('#pause').click();
    await expect(page.locator('body')).toHaveAttribute('data-paused', 'false');
    await expectIncrease(page, 'physicsSteps', previousStep);
}

async function motionReadout(page: Page, scene: Scene['name']): Promise<string> {
    return page.evaluate(name => {
        const data = document.body.dataset;
        switch (name) {
            case 'impulse':
                return [data['toppled'], data['contacts']].join('/');
            case 'materials':
                return [data['physicsHeights'], data['physicsSlides']].join('/');
            case 'joints':
                return [data['motorRpm'], data['sliderPosition']].join('/');
            case 'marble':
                return [data['physicsRotor'], data['physicsPasses']].join('/');
            case 'character':
                return [data['courierPosition'], data['courierGrounded']].join('/');
            case 'bridge':
                return [data['bridgeDeflection'], data['bridgeSway'], data['bridgeLoads']].join(
                    '/'
                );
        }
    }, scene);
}

async function exercisePlayback(page: Page, scene: Scene['name']): Promise<void> {
    const pausedStep = await pause(page);
    const pausedMotion = await motionReadout(page, scene);
    await waitForStableAnimationFrames(page);
    await page.waitForTimeout(180);
    expect(await numberReadout(page, 'physicsSteps')).toBe(pausedStep);
    expect(await motionReadout(page, scene)).toBe(pausedMotion);

    await page.locator('#slow').click();
    await expect(page.locator('body')).toHaveAttribute('data-time-scale', '0.25');
    await resume(page, pausedStep);
    const slowStep = await numberReadout(page, 'physicsSteps');
    await expectIncrease(page, 'physicsSteps', slowStep + 2);
    await page.locator('#slow').click();
    await expect(page.locator('body')).toHaveAttribute('data-time-scale', '1');
}

async function exerciseImpulse(page: Page): Promise<void> {
    const resetStep = await pause(page);
    await page.locator('#reset').click();
    await expect.poll(() => numberReadout(page, 'toppled')).toBe(0);
    await expect.poll(() => numberReadout(page, 'contacts')).toBe(0);
    const pushes = (await numberReadout(page, 'pushes')) || 0;
    await page.locator('#push').click();
    await expectIncrease(page, 'pushes', pushes);
    await resume(page, resetStep);
    await expect
        .poll(() => numberReadout(page, 'toppled'), { timeout: POLL_TIMEOUT })
        .toBeGreaterThan(2);

    const contacts = await numberReadout(page, 'contacts');
    const shots = (await numberReadout(page, 'shots')) || 0;
    await page.locator('#launch').click();
    await expectIncrease(page, 'shots', shots);
    await expectIncrease(page, 'contacts', contacts);
    await page.locator('#gravity').click();
    await expect(page.locator('body')).toHaveAttribute('data-gravity', 'moon');
    await expect(page.locator('[data-metric="gravity"]')).toContainText('1.62');
    const lunarStep = await numberReadout(page, 'physicsSteps');
    await expectIncrease(page, 'physicsSteps', lunarStep);
    await page.locator('#gravity').click();
    await expect(page.locator('body')).toHaveAttribute('data-gravity', 'earth');
    await expect(page.locator('[data-metric="gravity"]')).toContainText('9.81');

    await pause(page);
    const resets = await numberReadout(page, 'resets');
    await page.locator('#reset').click();
    await expectIncrease(page, 'resets', resets);
    await expect.poll(() => numberReadout(page, 'toppled')).toBe(0);
    await expect.poll(() => numberReadout(page, 'contacts')).toBe(0);
}

async function exerciseMaterials(page: Page): Promise<void> {
    const resetStep = await pause(page);
    const release = await numberReadout(page, 'physicsRelease');
    await page.locator('#replay').click();
    await expectIncrease(page, 'physicsRelease', release);
    expect(await numberReadout(page, 'physicsContacts')).toBe(0);
    expect(await numberReadout(page, 'physicsElapsed')).toBe(0);
    const heights = await vectorReadout(page, 'physicsHeights');
    expect(heights).toHaveLength(4);
    for (const height of heights) expect(height).toBeCloseTo(3.33, 2);
    expect(await vectorReadout(page, 'physicsSlides')).toEqual([0, 0, 0, 0]);
    await resume(page, resetStep);
    await expect
        .poll(() => numberReadout(page, 'physicsContacts'), { timeout: POLL_TIMEOUT })
        .toBeGreaterThanOrEqual(4);
    await expect
        .poll(
            async () => {
                const current = await vectorReadout(page, 'physicsHeights');
                return (current[3] ?? 0) - (current[0] ?? 0);
            },
            { message: 'High restitution retains more rebound height', timeout: POLL_TIMEOUT }
        )
        .toBeGreaterThan(0.5);
    await expect
        .poll(async () => (await vectorReadout(page, 'physicsSlides'))[0] ?? 0, {
            message: 'The low-friction specimen must travel down the slope',
            timeout: POLL_TIMEOUT
        })
        .toBeGreaterThan(0.5);
    const distances = await vectorReadout(page, 'physicsSlides');
    expect(distances).toHaveLength(4);
    expect(distances[3]).toBeLessThan(0.06);
    expect((distances[0] ?? 0) - (distances[3] ?? 0)).toBeGreaterThan(0.4);
}

async function exerciseJoints(page: Page): Promise<void> {
    await expect
        .poll(() => numberReadout(page, 'motorRpm'), { timeout: POLL_TIMEOUT })
        .toBeLessThan(-5);
    const jointCount = await numberReadout(page, 'jointCount');
    expect(jointCount).toBeGreaterThanOrEqual(7);
    const slider = await numberReadout(page, 'sliderPosition');
    await expect
        .poll(async () => Math.abs((await numberReadout(page, 'sliderPosition')) - slider), {
            timeout: POLL_TIMEOUT
        })
        .toBeGreaterThan(0.02);

    await page.locator('#motor-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-motor-running', 'false');
    await expect
        .poll(async () => Math.abs(await numberReadout(page, 'motorRpm')), {
            message: 'The motor brake must reduce real angular velocity',
            timeout: POLL_TIMEOUT
        })
        .toBeLessThan(2);
    await page.locator('#motor-reverse').click();
    await page.locator('#motor-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-motor-direction', '1');
    await expect
        .poll(() => numberReadout(page, 'motorRpm'), { timeout: POLL_TIMEOUT })
        .toBeGreaterThan(5);
    await page.locator('#pendulum-impulse').click();
    await expectIncrease(page, 'impulseCount', 0);
    const perturbedSlider = await numberReadout(page, 'sliderPosition');
    await expect
        .poll(
            async () => Math.abs((await numberReadout(page, 'sliderPosition')) - perturbedSlider),
            { timeout: POLL_TIMEOUT }
        )
        .toBeGreaterThan(0.02);

    const resetStep = await pause(page);
    await page.locator('#machine-reset').click();
    await expect(page.locator('body')).toHaveAttribute('data-motor-direction', '-1');
    await expect(page.locator('body')).toHaveAttribute('data-motor-running', 'true');
    await expect(page.locator('body')).toHaveAttribute('data-impulse-count', '0');
    await expect.poll(() => numberReadout(page, 'motorRpm')).toBe(0);
    expect(await numberReadout(page, 'jointCount')).toBe(jointCount);
    await resume(page, resetStep);
    await expect
        .poll(() => numberReadout(page, 'motorRpm'), { timeout: POLL_TIMEOUT })
        .toBeLessThan(-5);
}

async function exerciseMarbles(page: Page): Promise<void> {
    expect(await numberReadout(page, 'physicsMarbles')).toBe(30);
    await expectIncrease(page, 'physicsPasses', 1);
    const passes = await numberReadout(page, 'physicsPasses');
    const recycles = await numberReadout(page, 'physicsRecycles');
    await page.locator('#marble-release').click();
    await expectIncrease(page, 'physicsRecycles', recycles + 5);
    await expectIncrease(page, 'physicsPasses', passes);
    await page.locator('#marble-reverse').click();
    await expect(page.locator('body')).toHaveAttribute('data-motor-direction', '-1');
    const reverseStep = await numberReadout(page, 'physicsSteps');
    await expectIncrease(page, 'physicsSteps', reverseStep + 30);
    let previousAngle = await numberReadout(page, 'physicsRotor');
    await expect
        .poll(
            async () => {
                const currentAngle = await numberReadout(page, 'physicsRotor');
                const delta = currentAngle - previousAngle;
                previousAngle = currentAngle;
                return Math.atan2(Math.sin(delta), Math.cos(delta));
            },
            { message: 'The revolute motor must physically turn in reverse', timeout: POLL_TIMEOUT }
        )
        .toBeLessThan(-0.015);
    const score = await page.evaluate(() => {
        const data = document.body.dataset;
        return {
            total: Number(data['physicsScore']),
            passes: Number(data['physicsPasses']),
            lanes: (data['physicsLanes'] ?? '').split(',').map(Number),
            marbles: Number(data['physicsMarbles'])
        };
    });
    expect(score.marbles).toBe(30);
    expect(score.lanes).toHaveLength(5);
    expect(score.lanes.reduce((sum, count) => sum + count, 0)).toBe(score.passes);
    expect(
        score.lanes.reduce(
            (sum, count, index) => sum + count * ([10, 25, 50, 25, 10][index] ?? 0),
            0
        )
    ).toBe(score.total);
}

async function graphicsHealth(page: Page, backend: ExampleBackend, context: string): Promise<void> {
    await assertStableInstrumentationHealth(backend, context, {
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        readRenderHealth: () => readRenderHealth(page)
    });
}

async function assertMobileControls(
    page: Page,
    requiredActionIds: readonly string[]
): Promise<void> {
    // The exhibit has finished laying out before its pixel capture. Sample all controls together
    // so software rendering does not have to service a separate browser RPC for every button.
    const layout = await page.evaluate(() => {
        const actions = document.querySelector('#scene-actions')?.getBoundingClientRect();
        const playback = document.querySelector('.playback')?.getBoundingClientRect();
        if (!actions || !playback) throw new Error('Physics controls are missing');
        const sceneButtons = [
            ...document.querySelectorAll<HTMLButtonElement>('#scene-actions button')
        ];
        const playbackButtons = ['pause', 'slow', 'camera-home'].map(id => {
            const button = document.getElementById(id);
            if (!(button instanceof HTMLButtonElement)) {
                throw new Error(`Physics playback control ${id} is missing`);
            }
            return button;
        });
        const chapters = [...document.querySelectorAll<HTMLAnchorElement>('.chapter-link')];
        return {
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            actionBottom: actions.bottom,
            playbackTop: playback.top,
            centerIsCanvas:
                document.elementFromPoint(innerWidth / 2, innerHeight * 0.56)?.tagName === 'CANVAS',
            chapters: chapters.length,
            backendLinks: chapters.every(
                link => new URL(link.href).searchParams.get('backend') === 'webgl2'
            ),
            actionIds: sceneButtons.map(button => button.id),
            controls: [...sceneButtons, ...playbackButtons].map(button => {
                const bounds = button.getBoundingClientRect();
                const style = getComputedStyle(button);
                let opacity = Number(style.opacity);
                for (let parent = button.parentElement; parent; parent = parent.parentElement) {
                    opacity *= Number(getComputedStyle(parent).opacity);
                }
                return {
                    id: button.id,
                    width: bounds.width,
                    height: bounds.height,
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom,
                    display: style.display,
                    visibility: style.visibility,
                    opacity
                };
            })
        };
    });
    expect(layout.chapters).toBe(6);
    expect(layout.actionIds).toEqual(expect.arrayContaining([...requiredActionIds]));
    expect(layout.actionIds.length).toBeGreaterThanOrEqual(requiredActionIds.length);
    for (const control of layout.controls) {
        expect(control.width, `${control.id} must have positive width`).toBeGreaterThan(0);
        expect(control.height, `${control.id} must have positive height`).toBeGreaterThan(0);
        expect(control.display, `${control.id} must be displayed`).not.toBe('none');
        expect(control.visibility, `${control.id} must be CSS-visible`).toBe('visible');
        expect(
            control.opacity,
            `${control.id} must have visible effective opacity`
        ).toBeGreaterThan(0);
        expect(control.left, `${control.id} must fit inside the viewport`).toBeGreaterThanOrEqual(
            0
        );
        expect(control.top, `${control.id} must fit inside the viewport`).toBeGreaterThanOrEqual(0);
        expect(control.right, `${control.id} must fit inside the viewport`).toBeLessThanOrEqual(
            layout.width
        );
        expect(control.bottom, `${control.id} must fit inside the viewport`).toBeLessThanOrEqual(
            layout.height
        );
    }
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.actionBottom).toBeLessThan(layout.playbackTop);
    expect(layout.centerIsCanvas).toBe(true);
    expect(layout.backendLinks).toBe(true);
}

async function exerciseCharacter(page: Page): Promise<void> {
    const resetStep = await pause(page);
    await page.locator('#courier-reset').click();
    await expect(page.locator('body')).toHaveAttribute('data-courier-auto', 'true');
    await expect(page.locator('body')).toHaveAttribute('data-courier-jumps', '0');
    await expect(page.locator('body')).toHaveAttribute('data-courier-landings', '0');
    const resetPosition = await vectorReadout(page, 'courierPosition');
    expect(resetPosition).toHaveLength(3);
    expect(resetPosition[0]).toBeCloseTo(-4.7, 2);
    expect(resetPosition[2]).toBeCloseTo(1.6, 2);
    await page.locator('#courier-auto').click();
    await expect(page.locator('body')).toHaveAttribute('data-courier-auto', 'false');
    await page.locator('#courier-step').click();
    await expect(page.locator('body')).toHaveAttribute('data-courier-step-assist', 'false');
    await page.locator('#courier-step').click();
    await expect(page.locator('body')).toHaveAttribute('data-courier-step-assist', 'true');
    await resume(page, resetStep);
    await expect(page.locator('body')).toHaveAttribute('data-courier-grounded', 'true', {
        timeout: POLL_TIMEOUT
    });

    const groundPosition = await vectorReadout(page, 'courierPosition');
    const landings = await numberReadout(page, 'courierLandings');
    await page.locator('#courier-jump').click();
    await expectIncrease(page, 'courierJumps', 0);
    await expect
        .poll(async () => (await vectorReadout(page, 'courierPosition'))[1] ?? 0, {
            message: 'The controller capsule must actually rise above its grounded pose',
            timeout: POLL_TIMEOUT
        })
        .toBeGreaterThan((groundPosition[1] ?? 0) + 0.12);
    await expectIncrease(page, 'courierLandings', landings);
    await expect(page.locator('body')).toHaveAttribute('data-courier-grounded', 'true');

    const beforeMove = await vectorReadout(page, 'courierPosition');
    await page.locator('#courier-right').click();
    await expect
        .poll(async () => (await vectorReadout(page, 'courierPosition'))[0] ?? 0, {
            message: 'Directional input must move the physics character',
            timeout: POLL_TIMEOUT
        })
        .toBeGreaterThan((beforeMove[0] ?? 0) + 0.15);
    await page.locator('#courier-auto').click();
    await expect(page.locator('body')).toHaveAttribute('data-courier-auto', 'true');
    const beforePatrol = await vectorReadout(page, 'courierPosition');
    await expect
        .poll(
            async () => {
                const position = await vectorReadout(page, 'courierPosition');
                return Math.hypot(
                    (position[0] ?? 0) - (beforePatrol[0] ?? 0),
                    (position[2] ?? 0) - (beforePatrol[2] ?? 0)
                );
            },
            { message: 'Autonomous patrol must resume physical movement', timeout: POLL_TIMEOUT }
        )
        .toBeGreaterThan(0.2);
}

async function exerciseBridge(page: Page): Promise<void> {
    await expect(page.locator('body')).toHaveAttribute('data-bridge-loads', '0');
    const joints = await numberReadout(page, 'bridgeJoints');
    expect(joints).toBeGreaterThan(12);
    const unloaded = await numberReadout(page, 'bridgeDeflection');
    await page.locator('#bridge-load').click();
    await page.locator('#bridge-load').click();
    await expect(page.locator('body')).toHaveAttribute('data-bridge-loads', '2');
    await expect
        .poll(() => numberReadout(page, 'bridgeDeflection'), {
            message: 'Added rigid-body loads must deform the constrained bridge',
            timeout: POLL_TIMEOUT
        })
        .toBeGreaterThan(unloaded + 0.08);
    await page.locator('#bridge-unload').click();
    await expect(page.locator('body')).toHaveAttribute('data-bridge-loads', '0');
    await expect
        .poll(() => numberReadout(page, 'bridgeDeflection'), {
            message: 'Removing the load must let the bridge recover',
            timeout: 45_000
        })
        .toBeLessThan(unloaded + 0.06);
    const sways = await numberReadout(page, 'bridgeSways');
    const initialSway = Math.abs(await numberReadout(page, 'bridgeSway'));
    await page.locator('#bridge-sway').click();
    await expectIncrease(page, 'bridgeSways', sways);
    await expect
        .poll(async () => Math.abs(await numberReadout(page, 'bridgeSway')), {
            message: 'A lateral impulse must physically displace the bridge deck',
            timeout: POLL_TIMEOUT
        })
        .toBeGreaterThan(initialSway + 0.015);

    await pause(page);
    const resets = await numberReadout(page, 'bridgeResets');
    await page.locator('#bridge-reset').click();
    await expectIncrease(page, 'bridgeResets', resets);
    await expect(page.locator('body')).toHaveAttribute('data-bridge-loads', '0');
    await expect
        .poll(async () => Math.abs(await numberReadout(page, 'bridgeDeflection')))
        .toBeLessThan(0.005);
    expect(await numberReadout(page, 'bridgeJoints')).toBe(joints);
}

for (const scene of PHYSICS_RELEASE_TEST_CASES) {
    const { backend } = scene;
    test(`physics ${scene.name} simulates and responds to controls @${backend}`, async ({
        page
    }, testInfo) => {
        test.setTimeout(180_000);
        // Keep the desktop 16:10 composition and request the bounded 512px test shadow map. The
        // real scene, shadows, simulation, native health and pixel thresholds remain in this lane;
        // full-resolution art review is captured separately in documentation/assets/physics.
        await page.setViewportSize({ width: 960, height: 600 });
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`${scene.path}?backend=${backend}&test=1`);
            await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true', {
                timeout: POLL_TIMEOUT
            });
            await expect(page.locator('body')).toHaveAttribute('data-physics-scene', scene.name);
            await expect(page.locator('#chapter')).toHaveText(scene.chapter);
            await expect(page.locator(`canvas[data-hilo3d-backend="${backend}"]`)).toBeVisible();
            await expectIncrease(page, 'physicsSteps', 5);
            await expect
                .poll(async () => completedRenderCommands(await readRenderHealth(page), backend))
                .toBeGreaterThan(0);
            const before = nativeRenderProgress(await readRenderHealth(page), backend);
            if (scene.name === 'character') {
                await exerciseCharacterInspection(page, backend, testInfo, scene.name);
            } else {
                await assertExhibitPixels(page, backend, testInfo, scene.name);
            }
            await exercisePlayback(page, scene.name);
            switch (scene.name) {
                case 'impulse':
                    await exerciseImpulse(page);
                    break;
                case 'materials':
                    await exerciseMaterials(page);
                    break;
                case 'joints':
                    await exerciseJoints(page);
                    break;
                case 'marble':
                    await exerciseMarbles(page);
                    break;
                case 'character':
                    await exerciseCharacter(page);
                    break;
                case 'bridge':
                    await exerciseBridge(page);
                    break;
            }
            const after = nativeRenderProgress(await readRenderHealth(page), backend);
            expect(nativeRenderProgressAdvanced(before, after, backend)).toBe(true);
            await graphicsHealth(page, backend, `${scene.name} physics graphics on ${backend}`);
            await page.goto('about:blank');
            failures.assertEmpty(`${scene.name} physics lifecycle on ${backend}`);
        } finally {
            await failures.dispose();
        }
    });
}

test('physics collection keeps mobile controls outside the playfield @webgl2', async ({
    page
}, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    try {
        await page.goto('physics/rapier2d_marble.html?backend=webgl2&test=1');
        await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true', {
            timeout: POLL_TIMEOUT
        });
        await expectIncrease(page, 'physicsPasses', 0);
        await assertExhibitPixels(page, 'webgl2', testInfo, 'marble-mobile');
        await assertMobileControls(page, ['marble-release', 'marble-reverse']);
        const passes = await numberReadout(page, 'physicsPasses');
        await page.locator('#marble-release').click();
        await expectIncrease(page, 'physicsPasses', passes);
        await graphicsHealth(page, 'webgl2', 'mobile physics graphics');
        await page.goto('about:blank');
        failures.assertEmpty('mobile physics lifecycle');
    } finally {
        await failures.dispose();
    }
});

for (const scene of PHYSICS_RELEASE_TEST_CASES.filter(
    item => item.backend === 'webgl2' && (item.name === 'character' || item.name === 'bridge')
)) {
    test(`physics ${scene.name} keeps mobile actions usable and simulates @webgl2`, async ({
        page
    }, testInfo) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: 390, height: 844 });
        await installRenderHealthProbe(page);
        const failures = await installPageFailureMonitor(page);
        try {
            await page.goto(`${scene.path}?backend=webgl2&test=1`);
            await expect(page.locator('body')).toHaveAttribute('data-example-ready', 'true', {
                timeout: POLL_TIMEOUT
            });
            await expectIncrease(page, 'physicsSteps', 5);
            if (scene.name === 'character') {
                await exerciseCharacterInspection(page, 'webgl2', testInfo, 'character-mobile');
            } else {
                await assertExhibitPixels(page, 'webgl2', testInfo, `${scene.name}-mobile`);
            }
            await assertMobileControls(
                page,
                scene.name === 'character'
                    ? [
                          'courier-auto',
                          'courier-jump',
                          'courier-reset',
                          'courier-step',
                          'courier-inspect',
                          'courier-left',
                          'courier-right',
                          'courier-forward',
                          'courier-back'
                      ]
                    : [
                          'bridge-load',
                          'bridge-unload',
                          'bridge-sway',
                          'bridge-reset',
                          'bridge-focus'
                      ]
            );
            const before = nativeRenderProgress(await readRenderHealth(page), 'webgl2');
            if (scene.name === 'character') {
                await page.locator('#courier-reset').click();
                await page.locator('#courier-auto').click();
                await expect(page.locator('body')).toHaveAttribute('data-courier-auto', 'false');
                const initial = await vectorReadout(page, 'courierPosition');
                await page.locator('#courier-right').click();
                await expect
                    .poll(async () => (await vectorReadout(page, 'courierPosition'))[0] ?? 0, {
                        message: 'The mobile directional control must move the real capsule',
                        timeout: POLL_TIMEOUT
                    })
                    .toBeGreaterThan((initial[0] ?? 0) + 0.15);
            } else {
                const initial = await numberReadout(page, 'bridgeDeflection');
                await page.locator('#bridge-load').click();
                await expect(page.locator('body')).toHaveAttribute('data-bridge-loads', '1');
                await expect
                    .poll(() => numberReadout(page, 'bridgeDeflection'), {
                        message: 'A mobile load action must bend the physical bridge',
                        timeout: POLL_TIMEOUT
                    })
                    .toBeGreaterThan(initial + 0.04);
            }
            const after = nativeRenderProgress(await readRenderHealth(page), 'webgl2');
            expect(nativeRenderProgressAdvanced(before, after, 'webgl2')).toBe(true);
            await graphicsHealth(page, 'webgl2', `${scene.name} mobile physics graphics`);
            await page.goto('about:blank');
            failures.assertEmpty(`${scene.name} mobile physics lifecycle`);
        } finally {
            await failures.dispose();
        }
    });
}
