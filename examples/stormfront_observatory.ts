import * as Hilo3d from '../src/Hilo3d';

const TAU = Math.PI * 2;
const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const subjectVisible = search.get('subject') !== 'none';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function requireElement<T extends HTMLElement>(selector: string, type: new () => T): T {
    const element = document.querySelector(selector);
    if (!(element instanceof type)) throw new Error(`Tempest Reliquary is missing ${selector}`);
    return element;
}

function createCylinderGeometry(segments = 72): Hilo3d.Geometry {
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

function createTorusGeometry(majorSegments = 96, minorSegments = 14): Hilo3d.Geometry {
    const row = minorSegments + 1;
    const positions = new Float32Array((majorSegments + 1) * row * 3);
    const normals = new Float32Array(positions.length);
    const indices = new Uint16Array(majorSegments * minorSegments * 6);
    let vertex = 0;
    for (let major = 0; major <= majorSegments; major += 1) {
        const majorAngle = (major / majorSegments) * TAU;
        for (let minor = 0; minor <= minorSegments; minor += 1) {
            const minorAngle = (minor / minorSegments) * TAU;
            const radial = 1 + Math.cos(minorAngle) * 0.045;
            positions[vertex] = Math.cos(majorAngle) * radial;
            positions[vertex + 1] = Math.sin(majorAngle) * radial;
            positions[vertex + 2] = Math.sin(minorAngle) * 0.045;
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

function directionToTarget(
    position: readonly [number, number, number],
    target: readonly [number, number, number]
): Hilo3d.Vector3 {
    return new Hilo3d.Vector3(
        target[0] - position[0],
        target[1] - position[1],
        target[2] - position[2]
    ).normalize();
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
    const controlsToggle = requireElement('#controlsToggle', HTMLButtonElement);
    const consoleClose = requireElement('#consoleClose', HTMLButtonElement);
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
    weather.cloudDensity = 1.1;
    weather.storminess = Number(stormControl.value);
    weather.windSpeed = Number(windControl.value);
    weather.windDirection.set(0.82, 0, 0.57).normalize();

    const boxGeometry = new Hilo3d.BoxGeometry();
    const cylinderGeometry = createCylinderGeometry();
    const torusGeometry = createTorusGeometry();
    const sphereGeometry = new Hilo3d.SphereGeometry({
        radius: 1,
        widthSegments: 40,
        heightSegments: 24
    });
    const planeGeometry = new Hilo3d.PlaneGeometry({ width: 1, height: 1 });

    const obsidian = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.008, 0.012, 0.014),
        metallic: 0.52,
        roughness: 0.23
    });
    const basalt = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.014, 0.02, 0.022),
        metallic: 0.08,
        roughness: 0.74
    });
    const blackGold = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.16, 0.052, 0.01),
        metallic: 0.78,
        roughness: 0.3
    });
    const stormHeart = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.32, 0.055, 0.004),
        metallic: 0.08,
        roughness: 0.17,
        emission: new Hilo3d.Color(8.5, 0.72, 0.035)
    });
    const lightningGlass = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.006, 0.12, 0.16),
        metallic: 0.2,
        roughness: 0.19,
        emission: new Hilo3d.Color(0.06, 1.15, 2.4)
    });
    const stormMoon = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.006, 0.042, 0.064),
        metallic: 0.14,
        roughness: 0.62,
        emission: new Hilo3d.Color(0.035, 0.62, 1.18)
    });

    loadingProgress.style.width = '24%';
    loadingTitle.textContent = 'Recovering the amber guardian';
    loadingDetail.textContent =
        'Streaming the Stanford dragon from the Khronos glTF sample archive.';
    const dragonBuckets: Hilo3d.GPUSceneBucket[] = [];
    const loader = new Hilo3d.GLTFLoader();
    const model = await loader.load({
        src: new URL('./models/KhronosPBR/DragonAttenuation.glb', import.meta.url).href,
        ignoreTextureError: false
    });
    await model.ready;
    if (model.resourceErrors.length > 0) {
        throw new AggregateError(
            model.resourceErrors,
            'The dragon reliquary has resource failures.'
        );
    }
    const namedDragon = model.node.getChildByName('Dragon');
    const dragonMesh =
        namedDragon instanceof Hilo3d.Mesh ? namedDragon : model.meshes[model.meshes.length - 1];
    if (dragonMesh === undefined) {
        throw new Error('DragonAttenuation does not expose the expected Dragon mesh.');
    }
    if (dragonMesh.geometry === null) {
        throw new Error('DragonAttenuation does not expose the expected Dragon mesh.');
    }
    for (const mesh of model.meshes) mesh.visible = mesh === dragonMesh;
    dragonMesh.frustumTest = true;
    const dragonBounds = dragonMesh.getBounds();
    if (dragonBounds === undefined || dragonBounds.height <= 0) {
        throw new RangeError('DragonAttenuation does not expose usable bounds.');
    }
    const dragonGlaze = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.43, 0.13, 0.009),
        metallic: 0.54,
        roughness: 0.41,
        emission: new Hilo3d.Color(0.018, 0.0025, 0.0001)
    });
    dragonMesh.material = dragonGlaze;
    const dragonScale = 10.6 / dragonBounds.height;
    model.node.setScale(dragonScale);
    model.node.setPosition(
        -dragonBounds.x * dragonScale,
        2.55 - dragonBounds.yMin * dragonScale,
        -dragonBounds.z * dragonScale
    );
    model.node.rotationY = -10;
    dragonBuckets.push({ geometry: dragonMesh.geometry, material: dragonGlaze });

    const buckets: readonly Hilo3d.GPUSceneBucket[] = Object.freeze([
        ...dragonBuckets,
        { geometry: boxGeometry, material: obsidian },
        { geometry: boxGeometry, material: basalt },
        { geometry: boxGeometry, material: blackGold },
        { geometry: cylinderGeometry, material: obsidian },
        { geometry: cylinderGeometry, material: basalt },
        { geometry: cylinderGeometry, material: blackGold },
        { geometry: torusGeometry, material: blackGold },
        { geometry: torusGeometry, material: stormHeart },
        { geometry: sphereGeometry, material: stormHeart },
        { geometry: sphereGeometry, material: lightningGlass },
        { geometry: sphereGeometry, material: stormMoon },
        { geometry: planeGeometry, material: obsidian }
    ]);
    const width = testMode ? 960 : innerWidth;
    const height = testMode ? 600 : innerHeight;
    const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
        buckets,
        maxObjects: testMode ? 384 : 256,
        maxLights: testMode ? 32 : 48,
        maxLightIndices: testMode ? 131_072 : 196_608,
        maxLightsPerCluster: testMode ? 48 : 64,
        tileSize: testMode ? 40 : 28,
        zSlices: testMode ? 16 : 24,
        maxViewportWidth: testMode ? 960 : 2560,
        maxViewportHeight: testMode ? 600 : 1440,
        hiZ: true,
        toneMapping: 'filmic',
        bloomStrength: 0.3,
        exposure: 0.48,
        autoExposure: {
            minimumEV: -3.4,
            maximumEV: 0.3,
            compensation: -0.95,
            keyValue: 0.125,
            speedUp: 1.1,
            speedDown: 2.5
        },
        temporalAA: {
            renderScale: testMode ? 0.5 : 0.86,
            historyWeight: 0.92,
            depthThreshold: 0.024,
            varianceGamma: 1.1,
            sharpness: 0.14
        },
        groundTruthAmbientOcclusion: {
            resolutionScale: testMode ? 0.25 : 0.5,
            radius: 2.4,
            directionCount: testMode ? 4 : 6,
            stepCount: testMode ? 3 : 5,
            power: 1.24
        },
        atmosphere: {
            quality,
            state: weather,
            debugView,
            atmosphere: {
                sunIlluminance: 4.6,
                sunColor: new Hilo3d.Color(1, 0.93, 0.82),
                rayleighScaleHeight: 7_600,
                mieScaleHeight: 720,
                mieAnisotropy: 0.87,
                aerialPerspectiveDistance: 135_000,
                groundAlbedo: new Hilo3d.Color(0.028, 0.038, 0.04)
            },
            clouds: {
                baseHeight: 1_050,
                thickness: 10_600,
                weatherScale: 148_000,
                detailScale: 2_200,
                anisotropy: 0.8,
                silverLining: 1.7,
                ambientStrength: 0.52,
                historyWeight: 0.98,
                shadowDistance: 82_000
            }
        },
        volumetricLighting: {
            quality: testMode ? 'low' : 'high',
            resolutionScale: testMode ? 0.25 : 0.44,
            shadowSteps: testMode ? 1 : 3,
            density: 0.0036,
            baseHeight: -1,
            heightFalloff: 0.08,
            maxDistance: 92,
            albedo: new Hilo3d.Color(0.58, 0.7, 0.73),
            anisotropy: 0.58,
            ambientStrength: 0.045,
            historyWeight: 0.92,
            depthThreshold: 0.032,
            localVolumes: [
                {
                    shape: 'box',
                    center: new Hilo3d.Vector3(0, 6.5, 0),
                    halfExtents: new Hilo3d.Vector3(24, 10, 20),
                    density: 0.0021,
                    edgeFalloff: 0.32,
                    albedo: new Hilo3d.Color(0.46, 0.62, 0.66)
                },
                ...(testMode
                    ? []
                    : [
                          {
                              shape: 'sphere' as const,
                              center: new Hilo3d.Vector3(0, 6.6, 0),
                              radius: 7,
                              density: 0.0048,
                              edgeFalloff: 0.5,
                              albedo: new Hilo3d.Color(0.94, 0.39, 0.08)
                          }
                      ])
            ]
        }
    });

    loadingProgress.style.width = '58%';
    loadingTitle.textContent = 'Teaching the storm to remember';
    loadingDetail.textContent =
        'Allocating atmosphere LUTs, cloud history, and froxel light volumes.';
    const camera = new Hilo3d.PerspectiveCamera({
        aspect: width / Math.max(height, 1),
        fov: 36,
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
        pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.4),
        antialias: false,
        alpha: false,
        clearColor: new Hilo3d.Color(0.002, 0.004, 0.005),
        renderingProfile: 'high-end',
        renderPipeline: factory
    });

    const sceneMeshes: Hilo3d.Mesh[] = [];
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
        sceneMeshes.push(mesh);
        return mesh;
    };

    model.node.addTo(stage);
    addMesh(planeGeometry, obsidian, [0, -0.72, 0], [80, 80, 1], [-90, 0, 0]);
    addMesh(cylinderGeometry, basalt, [0, -0.1, 0], [12.8, 1.1, 12.8]);
    addMesh(cylinderGeometry, obsidian, [0, 0.68, 0], [10.6, 0.68, 10.6]);
    addMesh(cylinderGeometry, blackGold, [0, 1.12, 0], [9.5, 0.16, 9.5]);
    addMesh(cylinderGeometry, obsidian, [0, 1.62, 0], [8.2, 0.86, 8.2]);
    addMesh(cylinderGeometry, obsidian, [0, 2.18, 0], [7.1, 0.3, 7.1]);
    addMesh(torusGeometry, blackGold, [0, 2.38, 0], [7.15, 7.15, 1], [90, 0, 0]);
    addMesh(torusGeometry, stormHeart, [0, 2.58, 0], [6.58, 6.58, 1], [90, 0, 0]);
    addMesh(sphereGeometry, stormMoon, [0, 7.35, -5.4], [6.35, 6.35, 0.72]);
    addMesh(torusGeometry, blackGold, [0, 7.35, -4.54], [6.78, 6.78, 0.82]);

    const motes: Hilo3d.Mesh[] = [];
    for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * TAU + 0.18;
        const radius = 6.45 + (index % 3) * 0.34;
        const mote = addMesh(
            sphereGeometry,
            index % 4 === 0 ? lightningGlass : stormHeart,
            [Math.cos(angle) * radius, 2.62 + (index % 2) * 0.06, Math.sin(angle) * radius],
            [
                index % 4 === 0 ? 0.07 : 0.055,
                index % 4 === 0 ? 0.07 : 0.055,
                index % 4 === 0 ? 0.07 : 0.055
            ]
        );
        motes.push(mote);
    }

    if (!subjectVisible) {
        model.node.visible = false;
        for (const mesh of sceneMeshes) mesh.visible = false;
    }
    new Hilo3d.AmbientLight({ color: new Hilo3d.Color(0.1, 0.17, 0.23), amount: 0.46 }).addTo(
        stage
    );
    const sunLight = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.52, 0.23),
        amount: 4.8,
        direction: new Hilo3d.Vector3(-0.6, -0.15, 0.78)
    }).addTo(stage);
    if (subjectVisible) {
        new Hilo3d.PointLight({
            color: new Hilo3d.Color(1, 0.18, 0.018),
            amount: 11,
            range: 14,
            x: 0,
            y: 6.5,
            z: 0
        }).addTo(stage);
        new Hilo3d.SpotLight({
            x: -10,
            y: 14,
            z: 12,
            color: new Hilo3d.Color(1, 0.27, 0.045),
            direction: directionToTarget([-10, 14, 12], [0, 6.8, 0]),
            amount: 23,
            range: 38,
            cutoff: 0.88,
            outerCutoff: 0.74
        }).addTo(stage);
        for (let index = 0; index < 6; index += 1) {
            const angle = (index / 6) * TAU;
            new Hilo3d.PointLight({
                color: new Hilo3d.Color(1, 0.21, 0.025),
                amount: 1.7,
                range: 7,
                x: Math.cos(angle) * 6.55,
                y: 2.72,
                z: Math.sin(angle) * 6.55
            }).addTo(stage);
        }
    }

    const target = subjectVisible
        ? new Hilo3d.Vector3(0, 7.55, 0)
        : new Hilo3d.Vector3(15, 18, -30);
    const controls = new Hilo3d.OrbitControls(stage, {
        camera,
        target,
        enablePan: false,
        minDistance: 14,
        maxDistance: subjectVisible ? 42 : 120,
        minPolarAngle: subjectVisible ? Math.PI * 0.24 : Math.PI * 0.08,
        maxPolarAngle: subjectVisible ? Math.PI * 0.67 : Math.PI * 0.76,
        rotateSpeed: 0.45,
        zoomSpeed: 0.72
    });
    const views: readonly Hilo3d.Vector3[] = subjectVisible
        ? [
              new Hilo3d.Vector3(6.2, 7, 24.5),
              new Hilo3d.Vector3(-17.5, 8.4, 18.8),
              new Hilo3d.Vector3(4.2, 13.8, 23.5)
          ]
        : [
              new Hilo3d.Vector3(0, 3, 18),
              new Hilo3d.Vector3(-26, 7, 8),
              new Hilo3d.Vector3(22, 10, 16)
          ];
    let viewIndex = 0;
    const initialView = views[0];
    if (initialView === undefined) throw new Error('Tempest Reliquary requires an initial view');
    controls.setView(initialView, target);

    const setSolarTime = (hour: number): void => {
        const daylight = Math.max(0, Math.sin(((hour - 5.4) / 15.2) * Math.PI));
        const elevation = 0.018 + daylight * 0.35;
        const azimuth = ((hour - 12.1) / 15.2) * Math.PI;
        weather.sunDirection
            .set(
                Math.cos(azimuth) * Math.cos(elevation),
                Math.sin(elevation),
                Math.sin(azimuth) * Math.cos(elevation)
            )
            .normalize();
        sunLight.direction.copy(weather.sunDirection).negate();
        sunLight.amount = 1.1 + daylight * 4.4;
        const hours = Math.floor(hour);
        const minutes = Math.floor((hour - hours) * 60);
        const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        timeOutput.value = formatted;
        utcReadout.textContent = formatted;
    };
    const syncWeather = (): void => {
        const coverage = Number(cloudControl.value);
        const wind = Number(windControl.value);
        const storm = Number(stormControl.value);
        weather.cloudCoverage = coverage;
        weather.windSpeed = wind;
        weather.storminess = storm;
        weather.cloudDensity = 0.48 + storm * 0.42;
        cloudOutput.value = `${String(Math.round(coverage * 100))}%`;
        windOutput.value = `${String(Math.round(wind))} m/s`;
        stormOutput.value = storm.toFixed(2);
        cloudReadout.textContent = cloudOutput.value;
        windReadout.textContent = `${String(Math.round(wind))} m/s`;
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
    const setConsoleOpen = (open: boolean): void => {
        document.body.dataset['consoleOpen'] = String(open);
        controlsToggle.setAttribute('aria-expanded', String(open));
    };
    controlsToggle.addEventListener('click', () => {
        setConsoleOpen(document.body.dataset['consoleOpen'] !== 'true');
    });
    consoleClose.addEventListener('click', () => {
        setConsoleOpen(false);
    });
    window.addEventListener('keydown', event => {
        if (event.key.toLowerCase() === 'v') nextView();
        if (event.key === 'Escape') setConsoleOpen(false);
    });

    let elapsed = 0;
    const animate: Hilo3d.Tickable = {
        tick(deltaMilliseconds: number): void {
            if (!reducedMotion) elapsed += Math.min(deltaMilliseconds, 50) * 0.001;
            weather.timeSeconds = elapsed;
            model.node.rotationY = -10 + Math.sin(elapsed * 0.16) * 1.1;
            for (let index = 0; index < motes.length; index += 1) {
                const mote = motes[index];
                if (mote !== undefined) mote.y = 2.62 + Math.sin(elapsed * 0.8 + index) * 0.05;
            }
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
    loadingProgress.style.width = '84%';
    loadingTitle.textContent = 'Waiting for the eye to adapt';
    loadingDetail.textContent =
        'Resolving blue-noise clouds, cloud shadows, and the amber key light.';
    await stepFrames(testMode ? 5 : 12);
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
        stage.resize(innerWidth, innerHeight, Math.min(devicePixelRatio, 1.4));
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
