type CatalogBackend = 'webgl2' | 'webgpu';

export const EXAMPLE_CATEGORIES = [
    {
        id: 'getting-started',
        label: 'Getting started',
        description: 'Small examples for learning the basic Hilo3D workflow.'
    },
    {
        id: '2d',
        label: '2D games',
        description: 'Sprites, atlas animation, Canvas text, batching, layers, and camera stacks.'
    },
    {
        id: 'geometry',
        label: 'Geometry',
        description: 'Mesh construction, attributes, helpers, and instancing.'
    },
    {
        id: 'materials',
        label: 'Materials & shaders',
        description: 'Material models, custom shaders, transparency, and environments.'
    },
    {
        id: 'lighting',
        label: 'Lighting & shadows',
        description: 'Lights, shadows, and image-based lighting.'
    },
    {
        id: 'textures',
        label: 'Textures & media',
        description: 'Texture formats, image data, video, HDR, and color spaces.'
    },
    {
        id: 'animation',
        label: 'Animation',
        description: 'Animation clips, tweening, morphing, and dynamic scenes.'
    },
    {
        id: 'particles',
        label: 'Particles',
        description: 'Emitters, noise, topology, interaction, and GPU-resident simulation.'
    },
    {
        id: 'rendering',
        label: 'Render targets & passes',
        description: 'Render targets, post-processing, buffers, and render pipelines.'
    },
    {
        id: 'post-processing',
        label: 'Post-processing',
        description:
            'Bloom, temporal antialiasing, ambient occlusion, reflections, and indirect light.'
    },
    {
        id: 'compute',
        label: 'Compute & GPU rendering',
        description: 'WebGPU compute, indirect rendering, and path tracing.'
    },
    {
        id: 'interaction',
        label: 'Interaction',
        description: 'Picking, ray casting, camera helpers, pointer input, and XR.'
    },
    {
        id: 'loaders',
        label: 'Loaders & tools',
        description: 'Asset loaders, cloning, progress reporting, and the glTF viewer.'
    },
    {
        id: 'physics',
        label: 'Physics',
        description: 'Physics integration and simulation examples.'
    },
    {
        id: 'advanced',
        label: 'Diagnostics & internals',
        description: 'Diagnostics, resource management, math, and lower-level APIs.'
    }
] as const;

export type ExampleCategoryId = (typeof EXAMPLE_CATEGORIES)[number]['id'];

export interface ExampleCatalogEntry {
    readonly id: string;
    readonly path: string;
    readonly title: string;
    readonly description: string;
    readonly category: ExampleCategoryId;
    readonly sourcePath: string;
    readonly supportedBackends: readonly CatalogBackend[];
    readonly defaultQuery: Readonly<Record<string, string>>;
    readonly featured: boolean;
    readonly searchText: string;
}

const CATEGORY_ORDER = new Map(
    EXAMPLE_CATEGORIES.map((category, index) => [category.id, index] as const)
);
const BOTH_BACKENDS = ['webgl2', 'webgpu'] as const;

interface ExampleDefinition {
    readonly title: string;
    readonly description: string;
    readonly category: ExampleCategoryId;
    readonly featured?: boolean;
    readonly backend?: CatalogBackend;
}

/** Reviewed metadata for every example; HTML discovery remains the page source of truth. */
const EXAMPLE_DEFINITIONS: Readonly<Record<string, ExampleDefinition>> = {
    'asset_streaming.html': {
        title: 'Texture Residency Lab',
        description:
            'Stream KTX2/Basis textures with coarse-first detail, worker decoding, bounded residency and hidden-set eviction.',
        category: 'loaders'
    },
    '2d_sorting_town.html': {
        title: 'Maple Afternoon — Y Sorting',
        description:
            'Guide an A* courier through an ImageGen-authored pixel town while foot-Y ordering keeps buildings, trees, and the walker correctly layered.',
        category: '2d',
        featured: true
    },
    '2d_sprite_animation.html': {
        title: 'Luminous Garden — Sprite Animation',
        description:
            'Explore a painted celestial garden with an eight-frame moth, frame scrubbing, tint, scale, reflections, and three-camera 2D/3D composition.',
        category: '2d',
        featured: true
    },
    '2d_sprite_batch.html': {
        title: 'Stardust Atelier — Sprite Batching',
        description:
            'Shape 512–8,192 atlas sprites into a spiral galaxy, flowing ribbon, or orbital rings, with live population, speed, and spread controls.',
        category: '2d'
    },
    '2d_text.html': {
        title: 'Letters to the Moon — Dynamic Text',
        description:
            'Rasterize styled multiline Canvas text only when content changes, then render and click it as Sprite UI.',
        category: '2d'
    },
    '2d_text_layout.html': {
        title: 'The Field Journal — Text Layout',
        description:
            'Wrap measured Chinese and Latin text responsively with max lines, ellipsis, letter spacing, and paragraph spacing.',
        category: '2d'
    },
    '2d_ui_button.html': {
        title: 'The Travel Bureau — Nine-Slice UI',
        description:
            'Resize atlas-backed nine-slice panels and four-state buttons, inspect the source grid and cut lines, and unlock new destinations.',
        category: '2d',
        featured: true
    },
    'MultiSampledRenderbuffers.html': {
        title: 'Multisample Antialiasing',
        description: 'Render geometric edges with the portable multisampled forward pipeline.',
        category: 'rendering'
    },
    'animation.html': {
        title: 'Animation Blending',
        description: 'Blend animation clips and inspect layered motion on a procedural character.',
        category: 'animation',
        featured: true
    },
    'areaLight.html': {
        title: 'Area Lights',
        description: 'Illuminate a PBR surface with a rectangular area light.',
        category: 'lighting'
    },
    'bloom.html': {
        title: 'Bloom',
        description:
            'Compare engine HDR Bloom against the same raw scene in a WebGPU nocturne driven by 32,768 compute-simulated fireflies around an eclipse shrine.',
        category: 'post-processing',
        featured: true,
        backend: 'webgpu'
    },
    'cameraHelper.html': {
        title: 'Camera Frustum Helper',
        description: 'Inspect a second camera and its frustum with the public CameraHelper.',
        category: 'interaction'
    },
    'canvas_texture.html': {
        title: 'Canvas Texture Dashboard',
        description: 'Turn a live Canvas 2D dashboard into a continuously updated Hilo3D texture.',
        category: 'textures',
        featured: true
    },
    'canvas_texture_animation.html': {
        title: 'Canvas Texture Animation',
        description: 'Stream a procedural Canvas 2D aquarium into a portable animated texture.',
        category: 'textures'
    },
    'cascaded_shadows.html': {
        title: 'Little Sunshine — Toy Shadow Garden',
        description:
            'Explore a rounded plastic toy town with a windmill, lighthouse and miniature train. Compare single-map and four-cascade shadows at the same shadow-texel budget.',
        category: 'lighting',
        featured: true
    },
    'clustered_forward_plus_lumen.html': {
        title: 'Lumen — A Clustered Forward+ Light Sculpture',
        description:
            'Illuminate rounded resin sculptures and sixteen gallery fins with up to 192 lights, four sweeping moving heads, three palettes, and GPU clustered shading.',
        category: 'lighting',
        featured: true,
        backend: 'webgpu'
    },
    'clustered_forward_plus_sponza.html': {
        title: 'Sponza Clustered Forward+ Lighting Lab',
        description:
            'Explore Khronos Sponza under 192 animated local lights, GPU Scene culling, clustered shading, HDR bloom, and a cinematic camera tour.',
        category: 'lighting',
        backend: 'webgpu'
    },
    'compressed_texture.html': {
        title: 'Compressed Textures',
        description:
            'Display local KTX textures supported by the active device and report unsupported formats.',
        category: 'textures'
    },
    'compute_eclipse_shrine.html': {
        title: 'Eclipse Shrine — WebGPU Compute Installation',
        description:
            'Orbit a cinematic eclipse built from 65,536 compute-simulated bodies, three indirect spectral layers, PBR relics, HDR bloom, and interactive gravity.',
        category: 'compute',
        backend: 'webgpu'
    },
    'compute_gpu_driven.html': {
        title: 'WebGPU Compute & GPU-Driven Rendering',
        description:
            'See Forward+, Gaussian splats, and a curl-noise Hilo3D GPU particle wordmark stay on the public Render Graph.',
        category: 'compute',
        backend: 'webgpu'
    },
    'compute_particles.html': {
        title: 'Luminous Tides — Interactive Particle Landscape',
        description:
            'Drive 65,536 GPU bodies through aurora, stars, cyber dunes, meteor-wake force fields, boundary collisions, and indirect glow rendering.',
        category: 'compute',
        featured: true,
        backend: 'webgpu'
    },
    'compute_raytracing.html': {
        title: 'Hilo3D Crystal Compute Path Tracer',
        description:
            'Progressively path trace a refractive Hilo3D crystal wordmark, glass sphere, champagne-metal cube, soft shadows, and cinematic HDR bloom.',
        category: 'compute',
        backend: 'webgpu'
    },
    'custom_anim_state.html': {
        title: 'Custom Animation Tracks',
        description:
            'Animate a texture atlas through typed custom animation state and UV transforms.',
        category: 'animation'
    },
    'depthTexture.html': {
        title: 'Depth Texture',
        description: 'Sample a render-target depth attachment and display its depth values.',
        category: 'rendering'
    },
    'drawBuffers.html': {
        title: 'Multiple Render Targets',
        description:
            'Write several fragment outputs in one pass and inspect each color attachment.',
        category: 'rendering'
    },
    'dynamic_global_illumination_atelier.html': {
        title: 'Atelier — Dynamic Global Illumination, Day & Night',
        description:
            'Explore a warm original room by day and lamplight, with DDGI color bounce, an opening door, wall-color changes, and a movable reading lamp.',
        category: 'lighting',
        featured: true,
        backend: 'webgpu'
    },
    'fog.html': {
        title: 'Distance Fog',
        description: 'Observe distance-based fog blending across textured objects.',
        category: 'materials'
    },
    'frustum_test.html': {
        title: 'Frustum Culling',
        description:
            'Orbit a field of 700 meshes to inspect camera-frustum visibility and draw counts.',
        category: 'advanced'
    },
    'geometry_color.html': {
        title: 'Vertex Colors',
        description: 'Interpolate per-vertex RGB colors across a plane.',
        category: 'geometry'
    },
    'geometry_custom.html': {
        title: 'Custom & Interleaved Geometry',
        description: 'Compare separate attribute arrays with interleaved position and UV buffers.',
        category: 'geometry'
    },
    'geometry_dynamic.html': {
        title: 'Dynamic Vertex Deformation',
        description: 'Animate a box vertex and update its normals and vertex buffer in place.',
        category: 'geometry'
    },
    'geometry_dynamic2.html': {
        title: 'Dynamic Buffer Replacement',
        description: 'Swap vertex, index, and normal buffers between four shapes on the same mesh.',
        category: 'geometry'
    },
    'geometry_instanced.html': {
        title: 'Geometry Instanced',
        description:
            'Render a deterministic wave of shared spheres through portable instanced batches.',
        category: 'geometry',
        featured: true
    },
    'geometry_merge.html': {
        title: 'Geometry Merging',
        description: 'Bake transformed boxes, spheres, and planes into a single geometry.',
        category: 'geometry'
    },
    'geometry_primitives.html': {
        title: 'Geometry Primitives',
        description:
            'Compare built-in box and sphere meshes with a custom line-mode ring in one polished scene.',
        category: 'geometry',
        featured: true
    },
    'glTFViewer/index.html': {
        title: 'glTF Viewer',
        description: 'Load glTF 2.0 models from a URL, files, or a dropped folder.',
        category: 'loaders',
        featured: true
    },
    'gltf_light.html': {
        title: 'glTF Punctual Lights',
        description:
            'Load KHR_lights_punctual lighting alongside a procedural PBR comparison scene.',
        category: 'lighting'
    },
    'gltf_material_extensions.html': {
        title: 'Khronos Layered Material Gallery',
        description:
            'Inspect four curated Khronos glTF assets with anisotropy, clearcoat, iridescence, transmission and thickness-aware volume.',
        category: 'materials',
        featured: true
    },
    'ground_truth_ambient_occlusion.html': {
        title: 'The Silent Dragon — Ground-truth Ambient Occlusion',
        description:
            'Read scales, claws, coils, layered stone contacts, and a deep architectural niche through portable temporal GTAO.',
        category: 'post-processing'
    },
    'gtao_acceptance_lab.html': {
        title: 'GTAO Acceptance Lab',
        description:
            'Validate contact scale, thin geometry, depth edges, normal detail, material response, and temporal rejection in a deterministic dual-backend GTAO fixture.',
        category: 'advanced'
    },
    'lifegame.html': {
        title: 'Game of Life — Ping-pong Targets',
        description: 'Paint live cells and evolve them with two alternating render targets.',
        category: 'rendering'
    },
    'live2d.html': {
        title: 'Miku — Live2D Character',
        description:
            'Animate the official Miku sample with eight motions, pointer follow, physics, and close-up views through the shared WebGL 2 and WebGPU renderer.',
        category: 'animation'
    },
    'loader/glTF_clone.html': {
        title: 'glTF Cloning',
        description:
            'Clone a loaded glTF scene while retaining its geometry and material references.',
        category: 'loaders'
    },
    'loader/glTF_loader.html': {
        title: 'glTF Loading',
        description: 'Load and compare animated glTF assets with scene helpers.',
        category: 'loaders'
    },
    'loader/loader_progress.html': {
        title: 'Loading Progress',
        description: 'Track glTF asset loading progress before interacting with the loaded scene.',
        category: 'loaders'
    },
    'loader/shader/shader_loader.html': {
        title: 'Shader File Loading',
        description: 'Load external GLSL vertex and fragment files into a ShaderMaterial.',
        category: 'loaders'
    },
    'mesh_picker.html': {
        title: 'GPU Mesh Picking',
        description: 'Pick visible parts of a glTF model through the GPU-backed MeshPicker.',
        category: 'interaction',
        featured: true
    },
    'mouse_event.html': {
        title: 'Mesh Pointer Events',
        description: 'Interact with layered meshes through engine pointer events and hit testing.',
        category: 'interaction'
    },
    'normal_map.html': {
        title: 'Normal Mapping',
        description:
            'Compare surface detail under a moving point light using a tangent-space normal map.',
        category: 'materials'
    },
    'particle_collision_theatre.html': {
        title: 'Collision Theatre — Falling Light',
        description:
            'Release a shower of light onto four polished surfaces. Real particle collisions scatter sparks within a quiet architectural frame.',
        category: 'particles'
    },
    'particle_elemental_forge.html': {
        title: 'Elemental Forge — Molten Light',
        description:
            'Molten light rises through a brass instrument: eight emission shapes, fine embers, cold mineral dust, and a calibrated circular plinth.',
        category: 'particles',
        featured: true
    },
    'particle_gpu_nebula.html': {
        title: 'Event Horizon — WebGPU Particle Nebula',
        description:
            'A copper accretion disk surrounds a dark core, with glacial dust, WebGPU simulation and resident event routing, plus portable stateless stars.',
        category: 'particles',
        featured: true,
        backend: 'webgpu'
    },
    'particle_noise_fields.html': {
        title: 'Turbulence Atlas — Mineral Currents',
        description:
            'Fine grains and soft mist flow through four mineral currents, with coherent particle velocities, vector and curl noise, and gradual dissolution.',
        category: 'particles'
    },
    'particle_orbital_weave.html': {
        title: 'Orbital Weave — A Choreography of Light',
        description:
            'Two comets shed granular wakes while three luminous ribbon and trail systems follow independent inclinations, directions, and periods.',
        category: 'particles'
    },
    'pbr.html': {
        title: 'PBR Model Basics',
        description: 'Load one glTF model with PBR materials and the shared HDR environment.',
        category: 'materials'
    },
    'pbr2.html': {
        title: 'PBR Material Lab',
        description:
            'Read metallic and roughness response across a controlled 30-sample HDR material studio.',
        category: 'materials',
        featured: true
    },
    'pbr_layered_materials.html': {
        title: 'Layered PBR Studio',
        description:
            'Toggle anisotropy, clearcoat, transmission and volume across a cinematic engine-owned HDR material studio.',
        category: 'materials',
        featured: true
    },
    'physics/rapier2d_marble.html': {
        title: 'Marble works — 2D Physics Machine',
        description:
            'Guide 30 marbles through motorized splitters, collision pins and five sensor scoring lanes in a layered mechanical cabinet with automatic recirculation.',
        category: 'physics'
    },
    'physics/rapier3d.html': {
        title: 'Impulse garden — Rigid Body Studies',
        description:
            'Start a 29-domino chain reaction, launch a CCD projectile into a stacked tower, and apply impulses to compound bodies in a porcelain-and-brass physics garden.',
        category: 'physics',
        featured: true
    },
    'physics/rapier_bridge.html': {
        title: 'Suspension atelier — Loads & Constraints',
        description:
            'Load a miniature suspension bridge and watch segmented decking, dynamic cable links and spring hangers distribute weight through real constraints.',
        category: 'physics'
    },
    'physics/rapier_character.html': {
        title: 'Clockwork courier — Character Controller',
        description:
            'Guide a porcelain courier through a miniature obstacle course using collision-constrained character motion, stair assistance, jumping and visible scene queries.',
        category: 'physics',
        featured: true
    },
    'physics/rapier_joints.html': {
        title: 'Kinetic engine — Coupled Mechanisms',
        description:
            'Drive a machined flywheel, connecting rod and prismatic slider, then disturb a spring-coupled double pendulum to trace motion through a complete mechanism.',
        category: 'physics'
    },
    'physics/rapier_materials.html': {
        title: 'Material atelier — Restitution & Friction',
        description:
            'Release four matched samples in calibrated bounce instruments and compare four independent friction ramps with live rebound and travel measurements.',
        category: 'physics'
    },
    'pointLight.html': {
        title: 'Point Light',
        description:
            'Orbit three colored point lights around a reflective sculpture with dynamic shadows.',
        category: 'lighting'
    },
    'post_process.html': {
        title: 'Post-process Kernels',
        description:
            'Switch convolution kernels over the same rendered scene and compare their output.',
        category: 'post-processing'
    },
    'quickStart.html': {
        title: 'Quick Start',
        description: 'Create a stage, camera, lights, and an animated PBR mesh.',
        category: 'getting-started',
        featured: true
    },
    'raycast.html': {
        title: 'Raycast Hit Points',
        description: 'Move the pointer over rotating meshes to see projected intersection points.',
        category: 'interaction'
    },
    'raycast_node.html': {
        title: 'Raycast Scene Nodes',
        description: 'Click a stack of planes to remove intersected nodes in depth order.',
        category: 'interaction'
    },
    'renderTarget.html': {
        title: 'Render to Texture',
        description:
            'Render a box into an offscreen target and use its color attachment as a texture.',
        category: 'rendering'
    },
    'resourceManagerTest.html': {
        title: 'Resource Lifetime Diagnostics',
        description: 'Replace meshes and inspect tracked, active, and pending GPU resources.',
        category: 'advanced'
    },
    'sRGB.html': {
        title: 'sRGB Color Space',
        description: 'Compare linear and sRGB interpretation of the same source image.',
        category: 'textures'
    },
    'screen_space_global_illumination_chapel.html': {
        title: 'Prismatic Vespers — Screen-space Global Illumination',
        description:
            'Enter a procedural brutalist chapel where portable stochastic SSGI transports cyan, vermilion, violet, and warm emissive radiance across pale stone.',
        category: 'post-processing',
        featured: true
    },
    'screen_space_reflections_palace.html': {
        title: 'Afterimage — Screen-space Reflections',
        description:
            'Stage the Khronos Car Concept in a seamless smoked-lacquer studio with hierarchical ray tracing, confidence filtering, and temporal reflection resolve.',
        category: 'post-processing',
        backend: 'webgpu'
    },
    'scriptable_pipeline.html': {
        title: 'Scriptable Pipeline',
        description:
            'Shape a sculptural gallery with portable highlight extraction, separable bloom, and depth-aware spectral finishing. Compare the result and inspect color, bloom, depth, and contours.',
        category: 'post-processing',
        featured: true
    },
    'shaderToy.html': {
        title: 'ShaderToy',
        description: 'Run an interactive fragment shader with pointer and time inputs.',
        category: 'materials'
    },
    'shader_material.html': {
        title: 'Custom Shader Material',
        description: 'Bind a custom GLSL shader to registered uniform blocks and texture samplers.',
        category: 'materials'
    },
    'shadow.html': {
        title: 'Directional & Spot Shadows',
        description: 'Compare shadow-casting objects under directional and spot lights.',
        category: 'lighting'
    },
    'shadow_residency_sanctum.html': {
        title: 'Umbra Sanctum — Shadow Page Residency',
        description:
            'Enter a procedural moonlit nave where moving GPU Scene casters, fair page circulation, camera-layer isolation, CSM cadence, volumetric shafts, SSR, GTAO, and bloom exercise submission-aware shadow residency.',
        category: 'lighting',
        backend: 'webgpu'
    },
    'snow.html': {
        title: 'Instanced Snow',
        description:
            'Animate 10,000 billboards with per-instance attributes in a portable vertex shader.',
        category: 'particles'
    },
    'sphericalHarmonics.html': {
        title: 'Spherical Harmonics',
        description: 'Use nine environment irradiance coefficients to light a grid of PBR spheres.',
        category: 'lighting'
    },
    'spotLight.html': {
        title: 'Spotlight & Shadows',
        description:
            'Inspect a directional light cone and its shadows on a loaded model and floor.',
        category: 'lighting'
    },
    'stencilTest.html': {
        title: 'Stencil Masking',
        description:
            'Use a stencil mask to control where overlapping textured geometry is visible.',
        category: 'rendering'
    },
    'stormfront_observatory.html': {
        title: 'Tempest Reliquary — Physical Atmosphere',
        description:
            'Unseal a gilded Khronos dragon beneath a Rayleigh–Mie–ozone storm sky with GPU histogram exposure, temporal half-resolution clouds, cloud shadows, aerial perspective, and froxel light shafts.',
        category: 'lighting',
        featured: true,
        backend: 'webgpu'
    },
    'temporal_aa_observatory.html': {
        title: 'Temporal Observatory — Signals in Deep Time',
        description:
            'Stress fused motion vectors, visibility-aware history, logarithmic depth rejection, and fixed-scale TAAU in a kinetic WebGPU constellation.',
        category: 'post-processing',
        backend: 'webgpu'
    },
    'textureLod.html': {
        title: 'Explicit Texture LOD',
        description: 'Choose mip levels explicitly while sampling an environment texture.',
        category: 'textures'
    },
    'texture_data.html': {
        title: 'Raw Data Texture',
        description: 'Construct a small texture directly from a typed pixel array.',
        category: 'textures'
    },
    'texture_image_release.html': {
        title: 'Texture Image Release',
        description:
            'Release decoded images after upload and periodically replace the source texture.',
        category: 'advanced'
    },
    'transparent.html': {
        title: 'Transparent Materials',
        description: 'Compare alpha blending and render order across overlapping colored boxes.',
        category: 'materials'
    },
    'uniformBufferObject.html': {
        title: 'Uniform Buffer Objects',
        description: 'Update custom std140 parameters shared by a portable shader.',
        category: 'advanced'
    },
    'update_sub_texture.html': {
        title: 'Partial Texture Updates',
        description: 'Upload changing image regions without replacing the full texture.',
        category: 'textures'
    },
    'uv_map.html': {
        title: 'UV Mapping',
        description: 'Visualize texture coordinates on a plane and an animated glTF model.',
        category: 'materials'
    },
    'video.html': {
        title: 'Video Texture',
        description: 'Play a local video on a PBR surface using the shared texture upload path.',
        category: 'textures'
    },
    'volumetric_neon_reliquary.html': {
        title: 'Neon Reliquary — Froxel Volumetric Lighting',
        description:
            'Enter Khronos Sponza as a neon reliquary where temporal froxels, local fog volumes, clustered spotlights, and depth-aware visibility turn light into architecture.',
        category: 'lighting',
        backend: 'webgpu'
    },
    'webgl_support.html': {
        title: 'Graphics Backend Support',
        description: 'Inspect the explicitly selected backend and its active rendering context.',
        category: 'advanced'
    },
    'webxr.html': {
        title: 'WebXR Session',
        description: 'Enter an immersive WebXR session on a supported device using WebGL 2.',
        category: 'interaction',
        backend: 'webgl2'
    },
    'wireframe.html': {
        title: 'Wireframe Rendering',
        description: 'Inspect a loaded glTF model as a triangle wireframe.',
        category: 'geometry'
    }
};

const CATEGORY_SEARCH_TERMS: Readonly<Record<ExampleCategoryId, string>> = {
    'getting-started': '入门 开始 基础',
    '2d': '二维 精灵 文本 排序 图集 动画 按钮',
    geometry: '几何 顶点 网格 实例化',
    materials: '材质 着色器 法线 透明',
    lighting: '灯光 光照 阴影 环境 天空 大气',
    textures: '纹理 贴图 视频 图像',
    animation: '动画 混合 状态',
    particles: '粒子 发射 噪声 轨迹 碰撞',
    rendering: '渲染 缓冲 深度 离屏',
    'post-processing': '后处理 泛光 反射 遮蔽 抗锯齿 全局光照',
    compute: '计算 GPU 粒子 光线追踪 路径追踪',
    interaction: '交互 拾取 射线 相机 输入',
    loaders: '加载 模型 工具 查看器',
    physics: '物理 刚体 关节 碰撞 角色 桥梁',
    advanced: '诊断 资源 生命周期 底层 测试'
};

function createEntry(path: string): ExampleCatalogEntry {
    const definition = EXAMPLE_DEFINITIONS[path];
    if (!definition) throw new Error(`Missing example catalog metadata: ${path}`);
    const { title, description, category } = definition;
    const id = path.slice(0, -'.html'.length);
    const supportedBackends = definition.backend ? [definition.backend] : BOTH_BACKENDS;
    const sourcePath = path === 'glTFViewer/index.html' ? 'glTFViewer/app/index.ts' : `${id}.ts`;
    const defaultQuery =
        path === 'glTFViewer/index.html'
            ? Object.freeze({ url: './models/Tmall/Tmall.gltf' })
            : Object.freeze({});
    const categoryLabel = EXAMPLE_CATEGORIES.find(item => item.id === category)?.label ?? category;
    return Object.freeze({
        id,
        path,
        title,
        description,
        category,
        sourcePath,
        supportedBackends: Object.freeze(supportedBackends),
        defaultQuery,
        featured: definition.featured ?? false,
        searchText:
            `${title} ${description} ${path} ${category} ${categoryLabel} ${CATEGORY_SEARCH_TERMS[category]}`.toLowerCase()
    });
}

export function createExampleCatalog(paths: readonly string[]): readonly ExampleCatalogEntry[] {
    const pages = paths.filter(path => path !== 'index.html' && path !== 'list.html');
    const discovered = new Set(pages);
    if (discovered.size !== pages.length) throw new Error('Duplicate example paths');
    for (const path of Object.keys(EXAMPLE_DEFINITIONS)) {
        if (!discovered.has(path)) throw new Error(`Catalog references missing example: ${path}`);
    }
    return Object.freeze(
        pages.map(createEntry).sort((left, right) => {
            const categoryDifference =
                (CATEGORY_ORDER.get(left.category) ?? 0) -
                (CATEGORY_ORDER.get(right.category) ?? 0);
            return (
                categoryDifference ||
                left.title.localeCompare(right.title, 'en', { sensitivity: 'base' })
            );
        })
    );
}

export function examplesForBackend(
    catalog: readonly ExampleCatalogEntry[],
    backend: CatalogBackend
): readonly ExampleCatalogEntry[] {
    return catalog.filter(entry => entry.supportedBackends.includes(backend));
}

/** Search words may appear in any order, across title, purpose, path, and category. */
export function matchesExampleSearch(entry: ExampleCatalogEntry, query: string): boolean {
    return query
        .trim()
        .toLowerCase()
        .split(/\s+/u)
        .every(word => entry.searchText.includes(word));
}
