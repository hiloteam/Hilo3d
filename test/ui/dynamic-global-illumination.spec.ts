import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { ClusteredForwardPlusDiagnostics } from '../../src/render/pipeline/ClusteredForwardPlus';
import { installPageFailureMonitor } from './page-failure-monitor';
import { captureStableFrame } from './stable-capture';
import {
    assertStableInstrumentationHealth,
    awaitTrackedGPUQueues,
    waitForStableAnimationFrames,
    installRenderHealthProbe,
    readRenderHealth
} from './render-health';

// Software GPU ray tracing competes with video encoding; retain trace and actual pixel captures.
test.use({ video: 'off' });

interface AtelierEvidence {
    readonly giEnabled: boolean;
    readonly timeOfDay: 'night' | 'day';
    readonly doorAngle: number;
    readonly lampPosition: number;
    readonly wallPalette: string;
    readonly diagnostics: Readonly<ClusteredForwardPlusDiagnostics>;
}
interface AtelierAPI {
    settle(frames?: number): Promise<AtelierEvidence>;
    setGI(enabled: boolean): void;
    setDoor(angle: number): void;
    setLamp(value: number): void;
    setWall(palette: 'sage' | 'clay' | 'chalk'): void;
    setTimeOfDay(value: 'night' | 'day'): void;
    dispose(): Promise<void>;
}
type AtelierWindow = Window & { __HILO3D_ATELIER_TEST_API__?: AtelierAPI };

async function settle(page: Page, frames = 14): Promise<AtelierEvidence> {
    return page.evaluate(async count => {
        const api = (window as AtelierWindow).__HILO3D_ATELIER_TEST_API__;
        if (api === undefined) throw new Error('Atelier test controls unavailable');
        return api.settle(count);
    }, frames);
}
function pixelDifference(
    first: Buffer,
    second: Buffer
): Readonly<{ changedRatio: number; meanRGB: number }> {
    const a = PNG.sync.read(first);
    const b = PNG.sync.read(second);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    let changed = 0;
    let sampled = 0;
    let totalDelta = 0;
    // Compare the room itself, excluding changing labels, pressed states, and controls.
    for (let i = 0; i < a.data.length; i += 4) {
        const pixel = i / 4;
        const x = pixel % a.width;
        const y = Math.floor(pixel / a.width);
        if (x < a.width * 0.22 || x > a.width * 0.9 || y < a.height * 0.18 || y > a.height * 0.76)
            continue;
        sampled++;
        totalDelta +=
            Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)) +
            Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)) +
            Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0));
        if (
            Math.max(
                Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)),
                Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)),
                Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0))
            ) > 6
        )
            changed++;
    }
    return { changedRatio: changed / sampled, meanRGB: totalDelta / (sampled * 3) };
}

function difference(first: Buffer, second: Buffer): number {
    return pixelDifference(first, second).changedRatio;
}

type Pigment = 'sage' | 'clay';
type PixelPoint = readonly [number, number];
interface ReceiverLayout {
    readonly width: number;
    readonly height: number;
    readonly regions: readonly {
        readonly name: string;
        readonly polygons: readonly (readonly PixelPoint[])[];
    }[];
}
interface PigmentCaptures {
    readonly chalk: Readonly<{ on: Buffer; off: Buffer }>;
    readonly sage: Readonly<{ on: Buffer; off: Buffer }>;
    readonly clay: Readonly<{ on: Buffer; off: Buffer }>;
}
interface ReceiverMetrics {
    readonly pixels: number;
    readonly onMeanRGB: number;
    readonly offMeanRGB: number;
    readonly onCoverage6: number;
    readonly offCoverage6: number;
    readonly transportMeanRGB: number;
    readonly pigmentChroma: number;
}

// Reviewed geometry interiors from the neutral chalk image, before inspecting color differences.
// Separate portrait framing requires separate polygons. The six regions contain neutral sofa
// back/seats/apron/arms and two exposed rug surfaces, never wall, loose pillows, wood, or emitters.
// A camera/asset change requires reviewing the attached receiver mask again, not selecting hotspots.
const RECEIVER_LAYOUTS: Readonly<Record<'960x600' | '716x860', ReceiverLayout>> = {
    '960x600': {
        width: 960,
        height: 600,
        regions: [
            {
                name: 'sofa-back',
                polygons: [
                    [
                        [426, 226],
                        [531, 236],
                        [530, 243],
                        [423, 233]
                    ],
                    [
                        [477, 246],
                        [491, 248],
                        [487, 260],
                        [480, 269],
                        [476, 266]
                    ]
                ]
            },
            {
                name: 'sofa-seats',
                polygons: [
                    [
                        [399, 273],
                        [422, 272],
                        [442, 278],
                        [436, 282],
                        [399, 278]
                    ],
                    [
                        [455, 281],
                        [479, 281],
                        [498, 287],
                        [499, 292],
                        [451, 286]
                    ]
                ]
            },
            {
                name: 'sofa-apron',
                polygons: [
                    [
                        [394, 287],
                        [500, 303],
                        [499, 308],
                        [394, 292]
                    ]
                ]
            },
            {
                name: 'sofa-arms',
                polygons: [
                    [
                        [387, 255],
                        [395, 252],
                        [395, 272],
                        [386, 280]
                    ],
                    [
                        [511, 279],
                        [532, 270],
                        [532, 286],
                        [512, 299]
                    ]
                ]
            },
            {
                name: 'rug-left',
                polygons: [
                    [
                        [320, 350],
                        [373, 326],
                        [388, 327],
                        [393, 339],
                        [405, 346],
                        [402, 355],
                        [381, 363]
                    ]
                ]
            },
            {
                name: 'rug-front',
                polygons: [
                    [
                        [342, 351],
                        [534, 400],
                        [564, 382],
                        [427, 362]
                    ]
                ]
            }
        ]
    },
    '716x860': {
        width: 716,
        height: 860,
        regions: [
            {
                name: 'sofa-back',
                polygons: [
                    [
                        [243, 342],
                        [370, 357],
                        [367, 365],
                        [237, 350]
                    ],
                    [
                        [302, 362],
                        [317, 365],
                        [313, 375],
                        [307, 391],
                        [299, 394]
                    ]
                ]
            },
            {
                name: 'sofa-seats',
                polygons: [
                    [
                        [202, 399],
                        [234, 398],
                        [262, 406],
                        [258, 414],
                        [202, 406]
                    ],
                    [
                        [281, 410],
                        [310, 412],
                        [328, 418],
                        [328, 428],
                        [271, 419]
                    ]
                ]
            },
            {
                name: 'sofa-apron',
                polygons: [
                    [
                        [195, 416],
                        [328, 441],
                        [327, 446],
                        [195, 421]
                    ]
                ]
            },
            {
                name: 'sofa-arms',
                polygons: [
                    [
                        [190, 380],
                        [200, 377],
                        [200, 397],
                        [190, 407]
                    ],
                    [
                        [343, 403],
                        [369, 393],
                        [369, 420],
                        [343, 438]
                    ]
                ]
            },
            {
                name: 'rug-left',
                polygons: [
                    [
                        [118, 493],
                        [183, 467],
                        [196, 466],
                        [202, 478],
                        [221, 488],
                        [214, 498],
                        [179, 509]
                    ]
                ]
            },
            {
                name: 'rug-front',
                polygons: [
                    [
                        [143, 499],
                        [351, 553],
                        [389, 529],
                        [253, 520]
                    ]
                ]
            }
        ]
    }
};

const SCENE_CAPTURE_STYLE = `
.masthead, .introduction, .scene-label, .control-area, .atelier-footer, .paper-light {
    visibility: hidden !important;
}`;

function captureScene(page: Page, frames = 0): Promise<Buffer> {
    // Screenshot-only styling is restored before the next button/slider interaction.
    return captureStableFrame(page, 'webgpu', { frames, style: SCENE_CAPTURE_STYLE });
}

function containsPixel(polygon: readonly PixelPoint[], x: number, y: number): boolean {
    let previous = polygon.at(-1);
    if (previous === undefined) throw new Error('Receiver polygon must not be empty');
    let inside = false;
    for (const current of polygon) {
        if (
            current[1] > y !== previous[1] > y &&
            x <
                ((previous[0] - current[0]) * (y - current[1])) / (previous[1] - current[1]) +
                    current[0]
        )
            inside = !inside;
        previous = current;
    }
    return inside;
}

function receiverSamples(layout: ReceiverLayout): ReadonlyMap<string, readonly number[]> {
    const groups = new Map<string, readonly number[]>();
    const sofa = new Set<number>();
    const rug = new Set<number>();
    for (const region of layout.regions) {
        const points = region.polygons.flat();
        const left = Math.max(0, Math.floor(Math.min(...points.map(point => point[0]))));
        const right = Math.min(layout.width, Math.ceil(Math.max(...points.map(point => point[0]))));
        const top = Math.max(0, Math.floor(Math.min(...points.map(point => point[1]))));
        const bottom = Math.min(
            layout.height,
            Math.ceil(Math.max(...points.map(point => point[1])))
        );
        const offsets: number[] = [];
        for (let y = top; y < bottom; y++) {
            for (let x = left; x < right; x++) {
                if (!region.polygons.some(polygon => containsPixel(polygon, x + 0.5, y + 0.5)))
                    continue;
                const offset = (y * layout.width + x) * 4;
                offsets.push(offset);
                (region.name.startsWith('sofa-') ? sofa : rug).add(offset);
            }
        }
        expect(offsets.length, region.name).toBeGreaterThan(0);
        groups.set(region.name, offsets);
    }
    groups.set('sofa-all', [...sofa]);
    groups.set('rug-all', [...rug]);
    groups.set('all', [...new Set([...sofa, ...rug])]);
    return groups;
}

function pigmentMetrics(
    chalkOn: PNG,
    chalkOff: PNG,
    colorOn: PNG,
    colorOff: PNG,
    offsets: readonly number[],
    pigment: Pigment
): ReceiverMetrics {
    let on = 0,
        off = 0,
        transport = 0,
        onChanged = 0,
        offChanged = 0;
    const signed: [number, number, number] = [0, 0, 0];
    for (const offset of offsets) {
        let onMaximum = 0,
            offMaximum = 0;
        for (let channel = 0; channel < 3; channel++) {
            const onDelta =
                (colorOn.data[offset + channel] ?? 0) - (chalkOn.data[offset + channel] ?? 0);
            const offDelta =
                (colorOff.data[offset + channel] ?? 0) - (chalkOff.data[offset + channel] ?? 0);
            on += Math.abs(onDelta);
            off += Math.abs(offDelta);
            transport += Math.abs(onDelta - offDelta);
            signed[channel] = (signed[channel] ?? 0) + onDelta - offDelta;
            onMaximum = Math.max(onMaximum, Math.abs(onDelta));
            offMaximum = Math.max(offMaximum, Math.abs(offDelta));
        }
        if (onMaximum > 6) onChanged++;
        if (offMaximum > 6) offChanged++;
    }
    const count = offsets.length;
    return {
        pixels: count,
        onMeanRGB: on / (count * 3),
        offMeanRGB: off / (count * 3),
        onCoverage6: onChanged / count,
        offCoverage6: offChanged / count,
        transportMeanRGB: transport / (count * 3),
        // A four-state difference cancels direct repaint response; opposite channel directions
        // distinguish green/red pigment transport from a plain change in light intensity.
        pigmentChroma: (pigment === 'sage' ? signed[1] - signed[0] : signed[0] - signed[1]) / count
    };
}

async function capturePigments(
    page: Page,
    chalkOn: Buffer,
    chalkOff: Buffer
): Promise<PigmentCaptures> {
    // Start at chalk with GI off. Camera, night lighting, door and lamp pose stay fixed.
    await page.locator('button[data-wall="sage"]').click();
    await settle(page, 32);
    const sageOff = await captureScene(page);
    await page.locator('button[data-wall="clay"]').click();
    await settle(page, 32);
    const clayOff = await captureScene(page);
    await page.locator('#giToggle').click();
    expect((await settle(page, 64)).giEnabled).toBe(true);
    const clayOn = await captureScene(page);
    await page.locator('button[data-wall="sage"]').click();
    await settle(page, 64);
    const sageOn = await captureScene(page);
    return {
        chalk: { on: chalkOn, off: chalkOff },
        sage: { on: sageOn, off: sageOff },
        clay: { on: clayOn, off: clayOff }
    };
}

async function assertPigmentTransport(
    captures: PigmentCaptures,
    layout: ReceiverLayout,
    testInfo: TestInfo
): Promise<void> {
    const groups = receiverSamples(layout);
    const all = groups.get('all');
    if (all === undefined) throw new Error('Combined receiver mask is missing');
    expect(
        all.length / (layout.width * layout.height),
        'receiver mask must cover a substantial visible area'
    ).toBeGreaterThan(0.005);
    const mask = new PNG({ width: layout.width, height: layout.height });
    for (let offset = 3; offset < mask.data.length; offset += 4) mask.data[offset] = 255;
    for (const offset of groups.get('sofa-all') ?? []) mask.data.set([80, 220, 255, 255], offset);
    for (const offset of groups.get('rug-all') ?? []) mask.data.set([255, 225, 85, 255], offset);
    await testInfo.attach('atelier-reviewed-receiver-mask', {
        body: PNG.sync.write(mask),
        contentType: 'image/png'
    });
    const chalkOn = PNG.sync.read(captures.chalk.on),
        chalkOff = PNG.sync.read(captures.chalk.off);
    const report: Record<string, Readonly<Record<string, ReceiverMetrics>>> = {};
    for (const pigment of ['sage', 'clay'] as const) {
        const colorOn = PNG.sync.read(captures[pigment].on),
            colorOff = PNG.sync.read(captures[pigment].off);
        for (const image of [chalkOn, chalkOff, colorOn, colorOff])
            expect([image.width, image.height]).toEqual([layout.width, layout.height]);
        const regions: Record<string, ReceiverMetrics> = {};
        for (const [name, offsets] of groups)
            regions[name] = pigmentMetrics(chalkOn, chalkOff, colorOn, colorOff, offsets, pigment);
        report[pigment] = regions;
        for (const state of ['on', 'off'] as const)
            await testInfo.attach(`atelier-${pigment}-${state}`, {
                body: captures[pigment][state],
                contentType: 'image/png'
            });
    }
    await testInfo.attach('atelier-receiver-pigment-statistics', {
        body: JSON.stringify({ layout, report }, null, 2),
        contentType: 'application/json'
    });
    for (const pigment of ['sage', 'clay'] as const) {
        const overall = report[pigment]?.['all'];
        if (overall === undefined) throw new Error('Combined receiver statistics are missing');
        // Stronger than the previous 3-level / 225-pixel point check: a broad visible surface,
        // a majority of changed pixels, and an expected pigment direction must all agree.
        expect(overall.onMeanRGB, `${pigment} broad receiver response`).toBeGreaterThan(8);
        expect(overall.onMeanRGB).toBeGreaterThan(overall.offMeanRGB * 4);
        expect(
            overall.offMeanRGB,
            `${pigment} must not recolor receivers or tint a fill light`
        ).toBeLessThan(1.5);
        expect(overall.onCoverage6, `${pigment} must affect most receiver pixels`).toBeGreaterThan(
            0.5
        );
        expect(
            overall.pigmentChroma,
            `${pigment} must transport pigment, not just brightness`
        ).toBeGreaterThan(6);
    }
}

async function verifyHealthAndTeardown(page: Page): Promise<void> {
    await assertStableInstrumentationHealth('webgpu', 'Atelier', {
        readRenderHealth: () => readRenderHealth(page),
        awaitTrackedGPUQueues: () => awaitTrackedGPUQueues(page),
        waitForStableAnimationFrames: () => waitForStableAnimationFrames(page)
    });
    await page.evaluate(async () => {
        await (window as AtelierWindow).__HILO3D_ATELIER_TEST_API__?.dispose();
        await new Promise<void>(resolve =>
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    resolve();
                })
            )
        );
    });
}

test('Atelier presents dynamic GI, responds after captures and tears down cleanly @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(240_000);
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    try {
        await page.setViewportSize({ width: 960, height: 600 });
        await page.goto(
            '/examples/dynamic_global_illumination_atelier.html?backend=webgpu&test=1',
            { waitUntil: 'load' }
        );
        await expect(page.locator('body')).toHaveAttribute('data-atelier-ready', 'true', {
            timeout: 120_000
        });
        const initial = await settle(page, 7);
        expect(initial.timeOfDay).toBe('night');
        expect(initial.diagnostics.dynamicGlobalIllumination).toMatchObject({
            probeCount: 315,
            updatedProbeCount: 48,
            tracedRayCount: 6144
        });
        expect(initial.diagnostics.dynamicGlobalIllumination?.sceneTriangleCount).toBeGreaterThan(
            20_000
        );
        expect(initial.diagnostics.visibleObjectCount).toBeGreaterThan(0);
        await settle(page, 64);
        const lit = await captureScene(page);
        let previousStatic = lit;
        for (let frame = 0; frame < 16; frame++) {
            const nextStatic = await captureScene(page, 1);
            const delta = pixelDifference(previousStatic, nextStatic);
            expect(delta.meanRGB, `static night frame ${String(frame)}`).toBeLessThan(0.65);
            expect(delta.changedRatio, `static night frame ${String(frame)}`).toBeLessThan(0.03);
            previousStatic = nextStatic;
        }
        await testInfo.attach('atelier-gi-on', { body: lit, contentType: 'image/png' });
        await page.locator('#giToggle').click();
        // Compare settled lighting states after the existing temporal color history has converged.
        expect((await settle(page, 32)).giEnabled).toBe(false);
        const unlit = await captureScene(page);
        await testInfo.attach('atelier-gi-off', { body: unlit, contentType: 'image/png' });
        expect(difference(lit, unlit)).toBeGreaterThan(0.005);
        const pigments = await capturePigments(page, lit, unlit);
        await assertPigmentTransport(pigments, RECEIVER_LAYOUTS['960x600'], testInfo);
        await page.locator('button[data-wall="chalk"]').click();
        await settle(page, 64);
        await page.locator('button[data-lamp="100"]').click();
        expect((await settle(page, 14)).lampPosition).toBe(100);
        const lampMoved = await captureScene(page);
        expect(difference(lit, lampMoved)).toBeGreaterThan(0.01);
        await page.locator('button[data-wall="clay"]').click();
        expect((await settle(page, 14)).wallPalette).toBe('clay');
        const wallChanged = await captureScene(page);
        expect(difference(lampMoved, wallChanged)).toBeGreaterThan(0.01);
        await page.locator('#doorButton').click();
        const changed = await settle(page, 14);
        expect(changed.doorAngle).toBe(90);
        const doorOpened = await captureScene(page);
        expect(difference(wallChanged, doorOpened)).toBeGreaterThan(0.005);
        await testInfo.attach('atelier-night-open-door', {
            body: doorOpened,
            contentType: 'image/png'
        });
        await page.locator('button[data-time="day"]').click();
        expect((await settle(page, 21)).timeOfDay).toBe('day');
        const daylight = await captureScene(page);
        expect(difference(doorOpened, daylight)).toBeGreaterThan(0.2);
        await testInfo.attach('atelier-day', { body: daylight, contentType: 'image/png' });
        // Interaction after stable capture must continue to submit actual rendering work.
        const before = changed.diagnostics.dynamicGlobalIllumination?.submittedFrameCount ?? 0;
        await page.locator('#giToggle').click();
        const after = await settle(page, 2);
        expect(after.diagnostics.dynamicGlobalIllumination?.submittedFrameCount).toBeGreaterThan(
            before
        );
        await verifyHealthAndTeardown(page);
        failures.assertEmpty('Atelier including after resource teardown');
    } finally {
        await failures.dispose();
    }
});

test('Atelier transports wall pigment over broad portrait receivers @webgpu', async ({
    page
}, testInfo) => {
    test.setTimeout(240_000);
    await installRenderHealthProbe(page);
    const failures = await installPageFailureMonitor(page);
    try {
        await page.setViewportSize({ width: 716, height: 860 });
        await page.goto(
            '/examples/dynamic_global_illumination_atelier.html?backend=webgpu&test=1',
            { waitUntil: 'load' }
        );
        await expect(page.locator('body')).toHaveAttribute('data-atelier-ready', 'true', {
            timeout: 120_000
        });
        expect((await settle(page, 64)).timeOfDay).toBe('night');
        const chalkOn = await captureScene(page);
        await page.locator('#giToggle').click();
        expect((await settle(page, 32)).giEnabled).toBe(false);
        const chalkOff = await captureScene(page);
        const pigments = await capturePigments(page, chalkOn, chalkOff);
        await testInfo.attach('atelier-portrait-chalk-on', {
            body: chalkOn,
            contentType: 'image/png'
        });
        await testInfo.attach('atelier-portrait-chalk-off', {
            body: chalkOff,
            contentType: 'image/png'
        });
        await assertPigmentTransport(pigments, RECEIVER_LAYOUTS['716x860'], testInfo);
        // Capture styling must restore every control so the visitor can continue interacting.
        await page.locator('button[data-wall="chalk"]').click();
        expect((await settle(page, 2)).wallPalette).toBe('chalk');
        await verifyHealthAndTeardown(page);
        failures.assertEmpty('Portrait Atelier including after resource teardown');
    } finally {
        await failures.dispose();
    }
});
