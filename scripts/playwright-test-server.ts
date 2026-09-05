export const testServerPort = process.env['HILO3D_PLAYWRIGHT_PORT'] ?? '4173';
if (!/^\d+$/u.test(testServerPort)) {
    throw new Error(`Invalid HILO3D_PLAYWRIGHT_PORT: ${testServerPort}`);
}

export const testServerOrigin = `http://127.0.0.1:${testServerPort}`;
