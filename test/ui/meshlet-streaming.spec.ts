import { expect, test } from '@playwright/test';

test('streams complete meshlet LOD pages through clustered PBR with bounded uploads and recovery', async ({
    page
}, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    const completedPages = new Set<string>();
    const devtools = await page.context().newCDPSession(page);
    await devtools.send('Log.enable');
    devtools.on('Log.entryAdded', ({ entry }) => {
        if (entry.level === 'error' && entry.source === 'rendering') errors.push(entry.text);
    });
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfinished', request => {
        if (/\/meshlets\/page-\d+\.bin/u.test(request.url())) completedPages.add(request.url());
    });
    const query = testInfo.project.name === 'chromium-native-webgpu' ? '?native=1' : '';
    await page.goto(`/test/ui/fixtures/meshlet-streaming.html${query}`);
    await page.waitForFunction(
        () => window.__HILO3D_MESHLET_STREAMING_RESULT__ !== undefined,
        undefined,
        { timeout: 110_000 }
    );
    const result = await page.evaluate(() => window.__HILO3D_MESHLET_STREAMING_RESULT__);
    await devtools.detach();
    expect(errors).toEqual([]);
    expect(result).toBeDefined();
    if (result === undefined) throw new Error('Missing meshlet acceptance result');
    for (const comparison of [
        result.cold,
        result.fine,
        result.transformed,
        result.recovered,
        result.evicted,
        result.released,
        result.coarseSourceFine,
        result.coarseSourceReleased
    ]) {
        expect(comparison.mean).toBeLessThan(0.05);
        expect(comparison.maximum).toBeLessThanOrEqual(2);
    }
    expect(result.coarseEnergy).toBeGreaterThan(100_000);
    expect(result.fineEnergy).toBeGreaterThan(100_000);
    expect(result.coarseVisibleMeshlets).toBeGreaterThan(0);
    expect(result.fineVisibleMeshlets).toBeGreaterThan(result.coarseVisibleMeshlets);
    expect(result.coarsePages).toBe(result.groupCount);
    expect(result.finePages).toBe(result.groupCount * 2);
    expect(result.evictedPages).toBe(result.groupCount);
    expect(completedPages.size).toBe(result.groupCount * 2);
    expect(result.uploadBytes.some(bytes => bytes > 0)).toBe(true);
    expect(result.uploadBytes.every(bytes => bytes <= 16 * 1024)).toBe(true);
    expect(result.residentBytes).toBeGreaterThan(0);
    expect(result.residentBytes).toBeLessThanOrEqual(128 * 1024);
    expect(result.allocatedBytes).toBeGreaterThanOrEqual(128 * 1024);
    expect(result.culledVisibleMeshlets).toBe(0);
    expect(result.recoveryDeviceChanged).toBe(true);
    expect(result.retainedGeometryIdentity).toBe(true);
    expect(result.cpuBytesAfterDestroy).toBe(0);
    expect(result.coarseSourceTriangles).toBeGreaterThan(0);
    expect(result.coarseSourceTriangles).toBeLessThan(result.originalTriangles / 2);
});
