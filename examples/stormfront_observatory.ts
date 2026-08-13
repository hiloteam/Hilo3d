import * as Hilo3d from '../src/Hilo3d';

const TAU = Math.PI * 2;
const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function requireElement<T extends HTMLElement>(selector: string, type: new () => T): T {
    const element = document.querySelector(selector);
    if (!(element instanceof type))
        throw new Error(`Stormfront Observatory is missing ${selector}`);
    return element;
}

function createCylinderGeometry(segments = 64): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const add = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
        const index = positions.length / 3;
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        return index;
    };
    const topCenter = add(0, 0.5, 0, 0, 1, 0);
    const bottomCenter = add(0, -0.5, 0, 0, -1, 0);
    for (let segment = 0; segment < segments; segment += 1) {
        const a0 = (segment / segments) * TAU;
        const a1 = ((segment + 1) / segments) * TAU;
        const c0 = Math.cos(a0);
        const s0 = Math.sin(a0);
        const c1 = Math.cos(a1);
        const s1 = Math.sin(a1);
        const top0 = add(c0, 0.5, s0, 0, 1, 0);
        const top1 = add(c1, 0.5, s1, 0, 1, 0);
        const bottom0 = add(c0, -0.5, s0, 0, -1, 0);
        const bottom1 = add(c1, -0.5, s1, 0, -1, 0);
        indices.push(topCenter, top1, top0, bottomCenter, bottom0, bottom1);
        const side0Top = add(c0, 0.5, s0, c0, 0, s0);
        const side0Bottom = add(c0, -0.5, s0, c0, 0, s0);
        const side1Top = add(c1, 0.5, s1, c1, 0, s1);
        const side1Bottom = add(c1, -0.5, s1, c1, 0, s1);
        indices.push(side0Top, side1Top, side1Bottom, side0Top, side1Bottom, side0Bottom);
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function createTorusGeometry(majorSegments = 80, minorSegments = 12): Hilo3d.Geometry {
    const row = minorSegments + 1;
    const positions = new Float32Array((majorSegments + 1) * row * 3);
    const normals = new Float32Array(positions.length);
    const indices = new Uint16Array(majorSegments * minorSegments * 6);
    let vertex = 0;
    for (let major = 0; major <= majorSegments; major += 1) {
        const majorAngle = (major / majorSegments) * TAU;
        for (let minor = 0; minor <= minorSegments; minor += 1) {
            const minorAngle = (minor / minorSegments) * TAU;
            const radial = 1 + Math.cos(minorAngle) * 0.08;
            positions[vertex] = Math.cos(majorAngle) * radial;
            positions[vertex + 1] = Math.sin(majorAngle) * radial;
            positions[vertex + 2] = Math.sin(minorAngle) * 0.08;
            normals[vertex] = Math.cos(majorAngle) * Math.cos(minorAngle);
            normals[vertex + 1] = Math.sin(majorAngle) * Math.cos(minorAngle);
            normals[vertex + 2] = Math.sin(minorAngle);
            vertex += 3;
        }
    }
    let offset = 0;
    for (let major = 0; major < majorSegments; major += 1) {
        for (let minor = 0; minor < minorSegments; minor += 1) {
            const current = major * row + minor;
            const next = (major + 1) * row + minor;
            indices.set([current, next, current + 1, next, next + 1, current + 1], offset);
            offset += 6;
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(positions, 3),
        normals: new Hilo3d.GeometryData(normals, 3),
        indices: new Hilo3d.GeometryData(indices, 1)
    });
}

function qualityFromQuery(): Hilo3d.AtmosphereWeatherQuality {
    const value = search.get('quality');
    return value === 'low' || value === 'medium' || value === 'ultra' ? value : 'high';
}

function debugFromQuery(): Hilo3d.AtmosphereWeatherDebugView {
    const value = search.get('debug');
    const accepted: readonly Hilo3d.AtmosphereWeatherDebugView[] = [
        'transmittance',
        'multi-scattering',
        'sky-view',
        'weather-map',
        'cloud-radiance',
        'cloud-transmittance',
        'cloud-shadow'
    ];
    return accepted.includes(value as Hilo3d.AtmosphereWeatherDebugView)
        ? (value as Hilo3d.AtmosphereWeatherDebugView)
        : 'none';
}

async function main(): Promise<void> {
    const container = requireElement('#container', HTMLElement);
    const loadingTitle = requireElement('#loadingTitle', HTMLElement);
    const loadingDetail = requireElement('#loadingDetail', HTMLElement);
    const loadingProgress = requireElement('#loadingProgress', HTMLElement);
    const errorPanel = requireElement('#errorPanel', HTMLElement);
    const errorMessage = requireElement('#errorMessage', HTMLElement);
    const timeControl = requireElement('#timeControl', HTMLInputElement);
    const cloudControl = requireElement('#cloudControl', HTMLInputElement);
    const windControl = requireElement('#windControl', HTMLInputElement);
    const stormControl = requireElement('#stormControl', HTMLInputElement);
    const qualityControl = requireElement('#qualityControl', HTMLSelectElement);
    const debugControl = requireElement('#debugControl', HTMLSelectElement);
    const viewButton = requireElement('#viewButton', HTMLButtonElement);
    const timeOutput = requireElement('#timeOutput', HTMLOutputElement);
    const cloudOutput = requireElement('#cloudOutput', HTMLOutputElement);
    const windOutput = requireElement('#windOutput', HTMLOutputElement);
    const stormOutput = requireElement('#stormOutput', HTMLOutputElement);
    const utcReadout = requireElement('#utcReadout', HTMLElement);
    const cloudReadout = requireElement('#cloudReadout', HTMLElement);
    const windReadout = requireElement('#windReadout', HTMLElement);
    const stormReadout = requireElement('#stormReadout', HTMLElement);
    const exposureReadout = requireElement('#exposureReadout', HTMLElement);
    const qualityLabel = requireElement('#qualityLabel', HTMLElement);

    const quality = testMode ? 'low' : qualityFromQuery();
    const debugView = debugFromQuery();
    qualityControl.value = qualityFromQuery();
    debugControl.value = debugView;
    qualityLabel.textContent = `${quality.toUpperCase()} / WEBGPU`;

    const weather = new Hilo3d.AtmosphereWeatherState();
    weather.cloudCoverage = Number(cloudControl.value);
    weather.cloudDensity = 1.18;
    weather.storminess = Number(stormControl.value);
    weather.windSpeed = Number(windControl.value);
    weather.windDirection.set(0.92, 0, 0.38).normalize();

    const boxGeometry = new Hilo3d.BoxGeometry();
    const cylinderGeometry = createCylinderGeometry();
    const torusGeometry = createTorusGeometry();
    const sphereGeometry = new Hilo3d.SphereGeometry({
        radius: 1,
        widthSegments: 40,
        heightSegments: 24
    });
    const planeGeometry = new Hilo3d.PlaneGeometry({ width: 1, height: 1 });
    const rock = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.025, 0.035, 0.04),
        metallic: 0.12,
        roughness: 0.78
    });
    const wetRock = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.035, 0.048, 0.052),
        metallic: 0.28,
        roughness: 0.31
    });
    const steel = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.075, 0.095, 0.1),
        metallic: 0.88,
        roughness: 0.27
    });
    const paleSteel = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.25, 0.31, 0.31),
        metallic: 0.72,
        roughness: 0.36
    });
    const copper = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.42, 0.16, 0.055),
        metallic: 0.9,
        roughness: 0.24
    });
    const glass = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.035, 0.12, 0.14),
        metallic: 0.52,
        roughness: 0.09
    });
    const signal = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.23, 0.055, 0.012),
        metallic: 0.1,
        roughness: 0.3,
        emission: new Hilo3d.Color(6.4, 1.05, 0.12)
    });
    const coldSignal = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.01, 0.12, 0.16),
        metallic: 0.15,
        roughness: 0.25,
        emission: new Hilo3d.Color(0.08, 1.7, 2.6)
    });

    const buckets: readonly Hilo3d.GPUSceneBucket[] = [
        { geometry: boxGeometry, material: rock },
        { geometry: boxGeometry, material: wetRock },
        { geometry: boxGeometry, material: steel },
        { geometry: boxGeometry, material: paleSteel },
        { geometry: boxGeometry, material: signal },
        { geometry: cylinderGeometry, material: wetRock },
        { geometry: cylinderGeometry, material: steel },
        { geometry: cylinderGeometry, material: paleSteel },
        { geometry: cylinderGeometry, material: copper },
        { geometry: cylinderGeometry, material: signal },
        { geometry: torusGeometry, material: copper },
        { geometry: torusGeometry, material: signal },
        { geometry: sphereGeometry, material: glass },
        { geometry: sphereGeometry, material: signal },
        { geometry: sphereGeometry, material: coldSignal },
        { geometry: planeGeometry, material: wetRock }
    ];
    const width = testMode ? 960 : innerWidth;
    const height = testMode ? 600 : innerHeight;
    const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
        buckets,
        maxObjects: 384,
        maxLights: 32,
        maxLightIndices: 131_072,
        maxLightsPerCluster: 48,
        tileSize: testMode ? 40 : 32,
        zSlices: testMode ? 16 : 24,
        maxViewportWidth: testMode ? 960 : 2560,
        maxViewportHeight: testMode ? 600 : 1440,
        hiZ: true,
        toneMapping: 'filmic',
        bloomStrength: 0.2,
        exposure: 0.5,
        autoExposure: {
            minimumEV: -3,
            maximumEV: 0.15,
            compensation: -0.8,
            keyValue: 0.12,
            speedUp: 1.25,
            speedDown: 2.8
        },
        temporalAA: {
            renderScale: testMode ? 0.5 : 0.82,
            historyWeight: 0.93,
            depthThreshold: 0.025,
            varianceGamma: 1.15,
            sharpness: 0.1
        },
        groundTruthAmbientOcclusion: {
            resolutionScale: testMode ? 0.25 : 0.5,
            radius: 2.8,
            directionCount: testMode ? 4 : 6,
            stepCount: testMode ? 3 : 5,
            power: 1.18
        },
        atmosphere: {
            quality,
            state: weather,
            debugView,
            atmosphere: {
                sunIlluminance: 5,
                sunColor: new Hilo3d.Color(1, 0.72, 0.44),
                mieScaleHeight: 780,
                mieAnisotropy: 0.84,
                aerialPerspectiveDistance: 180_000,
                groundAlbedo: new Hilo3d.Color(0.055, 0.07, 0.065)
            },
            clouds: {
                baseHeight: 900,
                thickness: 7_400,
                weatherScale: 105_000,
                detailScale: 5_600,
                anisotropy: 0.76,
                silverLining: 2.2,
                ambientStrength: 0.48,
                historyWeight: 0.93,
                shadowDistance: 90_000
            }
        },
        volumetricLighting: {
            quality: testMode ? 'low' : 'high',
            resolutionScale: testMode ? 0.25 : 0.4,
            shadowSteps: testMode ? 1 : 3,
            density: 0.0022,
            baseHeight: 0,
            heightFalloff: 0.055,
            maxDistance: 105,
            albedo: new Hilo3d.Color(0.72, 0.84, 0.88),
            anisotropy: 0.48,
            ambientStrength: 0.08,
            historyWeight: 0.92,
            depthThreshold: 0.035,
            localVolumes: [
                {
                    shape: 'box',
                    center: new Hilo3d.Vector3(0, 7, 0),
                    halfExtents: new Hilo3d.Vector3(32, 9, 24),
                    density: 0.0014,
                    edgeFalloff: 0.28,
                    albedo: new Hilo3d.Color(0.55, 0.72, 0.78)
                }
            ]
        }
    });

    loadingProgress.style.width = '42%';
    loadingTitle.textContent = 'Allocating temporal cloud history';
    const camera = new Hilo3d.PerspectiveCamera({
        aspect: width / Math.max(height, 1),
        fov: 47,
        near: 0.08,
        far: 220_000,
        depthMode: 'reversed'
    });
    const stage = await Hilo3d.Stage.create<'webgpu'>({
        backend: 'webgpu',
        container,
        camera,
        width,
        height,
        pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.35),
        antialias: false,
        alpha: false,
        clearColor: new Hilo3d.Color(0.005, 0.008, 0.009),
        renderingProfile: 'high-end',
        renderPipeline: factory
    });

    const addMesh = (
        geometry: Hilo3d.Geometry,
        material: Hilo3d.PBRMaterial,
        position: readonly [number, number, number],
        scale: readonly [number, number, number],
        rotation: readonly [number, number, number] = [0, 0, 0]
    ): Hilo3d.Mesh => {
        const mesh = new Hilo3d.Mesh({
            geometry,
            material,
            x: position[0],
            y: position[1],
            z: position[2],
            rotationX: rotation[0],
            rotationY: rotation[1],
            rotationZ: rotation[2],
            frustumTest: true,
            pointerEnabled: false
        }).addTo(stage);
        mesh.setScale(scale[0], scale[1], scale[2]);
        return mesh;
    };

    for (let index = 0; index < 18; index += 1) {
        const angle = (index / 18) * TAU;
        const radius = 15 + (index % 4) * 2.2;
        addMesh(
            boxGeometry,
            index % 3 === 0 ? wetRock : rock,
            [Math.cos(angle) * radius, -1.2 + (index % 5) * 0.35, Math.sin(angle) * radius - 1],
            [8 + (index % 3) * 2.4, 3.5 + (index % 4), 6 + ((index + 1) % 4) * 1.6],
            [index * 7, (-angle * 180) / Math.PI + index * 9, index % 2 === 0 ? 5 : -7]
        );
    }
    addMesh(cylinderGeometry, wetRock, [0, 2.1, 0], [13.8, 3.1, 13.8]);
    addMesh(cylinderGeometry, steel, [0, 4.35, 0], [12.8, 1.45, 12.8]);
    addMesh(cylinderGeometry, paleSteel, [0, 6.45, -1.1], [6.9, 3.1, 6.9]);
    addMesh(cylinderGeometry, steel, [0, 9.2, -1.1], [5.2, 2.5, 5.2]);
    addMesh(sphereGeometry, glass, [0, 11.15, -1.1], [4.45, 2.3, 4.45]);
    addMesh(torusGeometry, copper, [0, 10.45, -1.1], [5.05, 5.05, 1], [90, 0, 0]);
    addMesh(torusGeometry, signal, [0, 11.35, -1.1], [4.6, 4.6, 1], [90, 0, 0]);
    addMesh(cylinderGeometry, steel, [0, 15.4, -1.1], [0.32, 6.4, 0.32]);
    addMesh(sphereGeometry, signal, [0, 18.7, -1.1], [0.48, 0.48, 0.48]);
    addMesh(cylinderGeometry, copper, [0.15, 16.15, -1.1], [0.1, 5.6, 0.1], [0, 0, -24]);

    for (const side of [-1, 1] as const) {
        addMesh(
            boxGeometry,
            steel,
            [side * 8.8, 6.2, -1.2],
            [6.2, 0.4, 4.8],
            [0, side * -9, side * 18]
        );
        addMesh(
            boxGeometry,
            glass,
            [side * 8.8, 6.63, -1.2],
            [5.5, 0.12, 4.1],
            [0, side * -9, side * 18]
        );
        addMesh(
            cylinderGeometry,
            paleSteel,
            [side * 9.2, 4.2, -1.1],
            [0.28, 4.2, 0.28],
            [0, 0, side * 8]
        );
    }
    for (let index = 0; index < 16; index += 1) {
        const angle = (index / 16) * TAU;
        addMesh(
            cylinderGeometry,
            paleSteel,
            [Math.cos(angle) * 11.3, 6.25, Math.sin(angle) * 11.3],
            [0.08, 1.5, 0.08]
        );
    }
    for (let index = 0; index < 9; index += 1) {
        const x = -11.5 + index * 2.9;
        addMesh(
            boxGeometry,
            steel,
            [x, 3.6, 10.8],
            [2.1, 0.35, 2.5],
            [0, index % 2 === 0 ? -5 : 5, 0]
        );
        addMesh(sphereGeometry, signal, [x, 4.15, 11.5], [0.13, 0.13, 0.13]);
    }
    addMesh(planeGeometry, wetRock, [0, 3.2, 12], [29, 17, 1], [-90, 0, 0]);
    addMesh(cylinderGeometry, paleSteel, [-8.1, 12.2, -3.5], [4.1, 0.28, 4.1], [0, 0, 52]);
    addMesh(cylinderGeometry, steel, [-8.1, 8.1, -3.5], [0.42, 6.2, 0.42], [0, 0, 8]);
    addMesh(sphereGeometry, coldSignal, [-10.9, 15.6, -3.5], [0.22, 0.22, 0.22]);
    addMesh(boxGeometry, wetRock, [-19, 1.6, -4], [8, 4.5, 18], [0, 18, -5]);
    addMesh(boxGeometry, rock, [20, 0.4, -7], [10, 6, 14], [4, -22, 8]);

    new Hilo3d.AmbientLight({ color: new Hilo3d.Color(0.12, 0.22, 0.3), amount: 1.65 }).addTo(
        stage
    );
    const sunLight = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.68, 0.39),
        amount: 4.2,
        direction: new Hilo3d.Vector3(-0.4, -0.3, 0.86)
    }).addTo(stage);
    for (let index = 0; index < 9; index += 1) {
        const x = -11.5 + index * 2.9;
        new Hilo3d.PointLight({
            color: new Hilo3d.Color(1, 0.25, 0.035),
            amount: 4.8,
            range: 7,
            x,
            y: 4.2,
            z: 11.5
        }).addTo(stage);
    }
    new Hilo3d.PointLight({
        color: new Hilo3d.Color(0.08, 0.72, 1),
        amount: 6,
        range: 18,
        x: 0,
        y: 11.5,
        z: -1
    }).addTo(stage);
    new Hilo3d.PointLight({
        color: new Hilo3d.Color(0.08, 0.36, 0.55),
        amount: 5.2,
        range: 34,
        x: -12,
        y: 9,
        z: 13
    }).addTo(stage);
    new Hilo3d.PointLight({
        color: new Hilo3d.Color(0.12, 0.28, 0.42),
        amount: 4.2,
        range: 30,
        x: 13,
        y: 7,
        z: 8
    }).addTo(stage);

    const controls = new Hilo3d.OrbitControls(stage, {
        camera,
        target: new Hilo3d.Vector3(0, 7.4, 0),
        enablePan: false,
        minDistance: 18,
        maxDistance: 68,
        minPolarAngle: Math.PI * 0.2,
        maxPolarAngle: Math.PI * 0.69,
        rotateSpeed: 0.5,
        zoomSpeed: 0.75
    });
    const views = [
        new Hilo3d.Vector3(10, 6.8, 30),
        new Hilo3d.Vector3(-34, 10.5, 24),
        new Hilo3d.Vector3(29, 12.5, 37)
    ] as const;
    const target = new Hilo3d.Vector3(0, 8.1, -1);
    let viewIndex = 0;
    controls.setView(views[0], target);

    const setSolarTime = (hour: number): void => {
        const daylight = Math.max(0, Math.sin(((hour - 5.4) / 15.2) * Math.PI));
        const elevation = 0.025 + daylight * 0.48;
        const azimuth = ((hour - 12.1) / 15.2) * Math.PI;
        weather.sunDirection
            .set(
                Math.cos(azimuth) * Math.cos(elevation),
                Math.sin(elevation),
                Math.sin(azimuth) * Math.cos(elevation)
            )
            .normalize();
        sunLight.direction.copy(weather.sunDirection).negate();
        sunLight.amount = 1.2 + daylight * 4.2;
        const hours = Math.floor(hour);
        const minutes = Math.floor((hour - hours) * 60);
        const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        timeOutput.value = formatted;
        utcReadout.textContent = `${formatted} UTC`;
    };
    const syncWeather = (): void => {
        const coverage = Number(cloudControl.value);
        const wind = Number(windControl.value);
        const storm = Number(stormControl.value);
        weather.cloudCoverage = coverage;
        weather.windSpeed = wind;
        weather.storminess = storm;
        weather.cloudDensity = 0.82 + storm * 0.78;
        cloudOutput.value = `${String(Math.round(coverage * 100))}%`;
        windOutput.value = `${String(Math.round(wind))} m/s`;
        stormOutput.value = storm.toFixed(2);
        cloudReadout.textContent = cloudOutput.value;
        windReadout.textContent = windOutput.value;
        stormReadout.textContent = stormOutput.value;
    };
    setSolarTime(Number(timeControl.value));
    syncWeather();
    timeControl.addEventListener('input', () => {
        setSolarTime(Number(timeControl.value));
    });
    cloudControl.addEventListener('input', syncWeather);
    windControl.addEventListener('input', syncWeather);
    stormControl.addEventListener('input', syncWeather);
    const reloadWith = (key: string, value: string): void => {
        const url = new URL(location.href);
        url.searchParams.set(key, value);
        location.assign(url);
    };
    qualityControl.addEventListener('change', () => {
        reloadWith('quality', qualityControl.value);
    });
    debugControl.addEventListener('change', () => {
        reloadWith('debug', debugControl.value);
    });
    const nextView = (): void => {
        viewIndex = (viewIndex + 1) % views.length;
        const view = views[viewIndex];
        if (view !== undefined) controls.setView(view, target);
        camera.invalidateTransformHistory();
    };
    viewButton.addEventListener('click', nextView);
    window.addEventListener('keydown', event => {
        if (event.key.toLowerCase() === 'v') nextView();
    });

    let elapsed = 0;
    const animate: Hilo3d.Tickable = {
        tick(deltaMilliseconds: number): void {
            if (!reducedMotion) elapsed += Math.min(deltaMilliseconds, 50) * 0.001;
            weather.timeSeconds = elapsed;
        }
    };
    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(animate);
    ticker.addTick(stage);
    const stepFrames = async (count: number): Promise<void> => {
        ticker.stop();
        for (let frame = 0; frame < count; frame += 1) {
            animate.tick(1000 / 60);
            stage.tick(1000 / 60);
            await stage.renderer.waitForIdle();
        }
    };
    loadingProgress.style.width = '82%';
    loadingTitle.textContent = 'Waiting for the eye to adapt';
    loadingDetail.textContent = 'Resolving blue-noise clouds and cloud-broken directional light.';
    await stepFrames(testMode ? 4 : 10);
    const diagnostics = await factory.readDiagnostics();
    exposureReadout.textContent = `${diagnostics.autoExposureEV >= 0 ? '+' : ''}${diagnostics.autoExposureEV.toFixed(2)} EV`;
    loadingProgress.style.width = '100%';
    document.body.dataset['stormfrontReady'] = 'true';
    if (!testMode) ticker.start();

    window.__HILO3D_STORMFRONT_RESULT__ = {
        backend: 'webgpu',
        atmosphere: true,
        clouds: true,
        autoExposure: true,
        visibleObjectCount: diagnostics.visibleObjectCount
    };
    window.__HILO3D_STORMFRONT_TEST_API__ = {
        settle: stepFrames,
        nextView: async (): Promise<void> => {
            nextView();
            await stepFrames(4);
        }
    };
    const resize = (): void => {
        if (testMode) return;
        camera.aspect = innerWidth / Math.max(innerHeight, 1);
        stage.resize(innerWidth, innerHeight, Math.min(devicePixelRatio, 1.35));
    };
    window.addEventListener('resize', resize);
    window.addEventListener(
        'pagehide',
        () => {
            ticker.stop();
            controls.dispose();
            stage.destroy();
        },
        { once: true }
    );

    errorPanel.hidden = true;
    errorMessage.textContent = '';
}

void main().catch((error: unknown) => {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    document.body.dataset['stormfrontError'] = message;
    const panel = document.querySelector<HTMLElement>('#errorPanel');
    const detail = document.querySelector<HTMLElement>('#errorMessage');
    if (detail !== null) detail.textContent = message;
    if (panel !== null) panel.hidden = false;
});

declare global {
    interface Window {
        __HILO3D_STORMFRONT_RESULT__?: Readonly<{
            backend: 'webgpu';
            atmosphere: true;
            clouds: true;
            autoExposure: true;
            visibleObjectCount: number;
        }>;
        __HILO3D_STORMFRONT_TEST_API__?: Readonly<{
            settle(frames: number): Promise<void>;
            nextView(): Promise<void>;
        }>;
    }
}
