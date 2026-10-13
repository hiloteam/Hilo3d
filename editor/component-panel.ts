import {
    defaultAudioComponent,
    defaultParticleComponent,
    defaultPhysicsComponent,
    validateNodeComponents,
    type NodeComponents
} from './components';
import { validateProject, type ProjectDocument } from './project';
import type { SceneNode } from './scene';
import './component-panel.css';

export interface ComponentPanelOptions {
    getProject(): ProjectDocument;
    getSelectedNode(): string | null;
    onCommit(project: ProjectDocument, label: string): void;
    onNotify(message: string, error?: boolean): void;
    canEdit?(): boolean;
}

function escape(value: string): string {
    return value.replace(
        /[&<>"']/gu,
        character =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
            character
    );
}
function field(
    name: string,
    label: string,
    value: number | string | boolean,
    options?: { min?: number; max?: number; step?: number; choices?: readonly string[] }
): string {
    const id = `component-${name.replaceAll('.', '-')}`;
    if (options?.choices)
        return `<label for="${id}">${label}<select id="${id}" data-component-field="${name}" aria-label="${label}">${options.choices.map(choice => `<option value="${escape(choice)}" ${choice === value ? 'selected' : ''}>${escape(choice)}</option>`).join('')}</select></label>`;
    if (typeof value === 'boolean')
        return `<label class="component-check" for="${id}"><input id="${id}" data-component-field="${name}" type="checkbox" ${value ? 'checked' : ''}/>${label}</label>`;
    const type = typeof value === 'number' ? 'number' : 'color';
    return `<label for="${id}">${label}<input id="${id}" data-component-field="${name}" aria-label="${label}" type="${type}" value="${escape(String(value))}" ${typeof value === 'number' ? `step="${String(options?.step ?? 0.1)}" ${options?.min !== undefined ? `min="${String(options.min)}"` : ''} ${options?.max !== undefined ? `max="${String(options.max)}"` : ''}` : ''}/></label>`;
}
function vector(
    name: string,
    label: string,
    value: { x: number; y: number; z: number },
    min: number,
    max: number
): string {
    return `<div class="component-vector"><span>${label}</span>${(['x', 'y', 'z'] as const).map(axis => field(`${name}.${axis}`, `${label} ${axis.toUpperCase()}`, value[axis], { min, max })).join('')}</div>`;
}
function section(name: keyof NodeComponents, title: string, body: string): string {
    return `<details class="component-section" open><summary>${title}</summary><div class="component-fields">${body}</div><button type="button" data-component-remove="${name}">Remove ${title.toLowerCase()}</button></details>`;
}
function physicsFields(component: NonNullable<NodeComponents['physics']>): string {
    return `${
        field('physics.body', 'Body type', component.body, {
            choices: ['static', 'dynamic', 'kinematic']
        }) +
        field('physics.shape', 'Collider', component.shape, {
            choices: ['box', 'sphere', 'capsule']
        }) +
        (component.shape === 'box'
            ? vector('physics.size', 'Collider size (m)', component.size, 0.001, 10000)
            : field('physics.radius', 'Radius (m)', component.radius, { min: 0.001, max: 10000 })) +
        (component.shape === 'capsule'
            ? field('physics.halfHeight', 'Half segment height (m)', component.halfHeight, {
                  min: 0.001,
                  max: 10000
              })
            : '') +
        field('physics.mass', 'Mass (kg)', component.mass, { min: 0.001, max: 100000 }) +
        field('physics.friction', 'Friction', component.friction, { min: 0, max: 10 }) +
        field('physics.restitution', 'Restitution', component.restitution, { min: 0, max: 1 }) +
        field('physics.sensor', 'Sensor (overlap only)', component.sensor)
    }<p class="component-hint">Dimensions follow object scale. Dynamic bodies own movement; use kinematic bodies with transform scripts or animation. Physics parents need unit scale.</p>`;
}
function particleFields(component: NonNullable<NodeComponents['particles']>): string {
    return `${
        field('particles.shape', 'Emitter shape', component.shape, {
            choices: ['point', 'box', 'sphere']
        }) +
        (component.shape === 'box'
            ? vector('particles.extent', 'Emitter half extent (m)', component.extent, 0.001, 1000)
            : component.shape === 'sphere'
              ? field('particles.extent.x', 'Emitter radius (m)', component.extent.x, {
                    min: 0.001,
                    max: 1000
                })
              : '') +
        field('particles.seed', 'Random seed', component.seed, {
            min: 0,
            max: 4294967295,
            step: 1
        }) +
        field('particles.maxParticles', 'Particle capacity', component.maxParticles, {
            min: 1,
            max: 4096,
            step: 1
        }) +
        field('particles.rate', 'Emission / second', component.rate, { min: 0, max: 1000 }) +
        field('particles.lifetime', 'Lifetime (s)', component.lifetime, { min: 0.01, max: 60 }) +
        field('particles.speed', 'Speed (m/s)', component.speed, { min: 0, max: 1000 }) +
        field('particles.size', 'Particle size (m)', component.size, { min: 0.001, max: 100 }) +
        field('particles.color', 'Particle color', component.color) +
        vector('particles.gravity', 'Local gravity (m/s²)', component.gravity, -1000, 1000) +
        field('particles.loop', 'Loop emission', component.loop) +
        field('particles.duration', 'Emission duration (s)', component.duration, {
            min: 0.01,
            max: 3600
        })
    }<p class="component-hint">Play to preview. Particles follow this object; gravity uses its local axes. Seeded playback is repeatable, with at most 32,768 particles per scene.</p>`;
}
function audioFields(
    component: NonNullable<NodeComponents['audio']>,
    project: ProjectDocument
): string {
    return `<label>Audio source<select data-component-field="audio.asset" aria-label="Audio source">${Object.values(
        project.assets
    )
        .filter(asset => asset.kind === 'audio')
        .map(
            asset =>
                `<option value="${asset.id}" ${asset.id === component.asset ? 'selected' : ''}>${escape(asset.name)}</option>`
        )
        .join('')}</select></label>${field(
        'audio.autoplay',
        'Play on start',
        component.autoplay
    )}${field('audio.loop', 'Loop audio', component.loop)}${field(
        'audio.volume',
        'Volume',
        component.volume,
        { min: 0, max: 1, step: 0.05 }
    )}${field('audio.spatial', 'Spatial audio', component.spatial)}${field(
        'audio.refDistance',
        'Reference distance (m)',
        component.refDistance,
        {
            min: 0.01,
            max: 10000
        }
    )}${field('audio.maxDistance', 'Maximum distance (m)', component.maxDistance, {
        min: 0.01,
        max: 100000
    })}<p class="component-hint">Import PCM WAV in Assets. Sound starts after Play; Pause and Stop also control sound. Mono WAV gives the clearest spatial positioning.</p>`;
}

/** Transactional component authoring, shared by inspector selection and undo/redo refreshes. */
export class ComponentPanel {
    private host: HTMLElement | null = null;
    private destroyed = false;
    constructor(private readonly options: ComponentPanelOptions) {}

    render(host: HTMLElement): void {
        if (this.destroyed) return;
        if (this.host !== host) {
            this.detach();
            this.host = host;
            host.addEventListener('click', this.click);
            host.addEventListener('change', this.change);
        }
        const project = this.options.getProject();
        const id = this.options.getSelectedNode();
        const node = id ? project.scenes[project.activeSceneId]?.nodes[id] : undefined;
        host.classList.add('component-panel');
        if (!node) {
            host.innerHTML =
                '<p class="component-hint">Select an object to add physics, particles or sound.</p>';
            return;
        }
        const disabled = !this.editable(project, node);
        const components = node.components ?? {};
        host.innerHTML = `<h3>Runtime components</h3><fieldset ${disabled ? 'disabled' : ''}><div class="component-add">${components.physics ? '' : '<button type="button" data-component-add="physics">+ Physics</button>'}${components.particles ? '' : '<button type="button" data-component-add="particles">+ Particles</button>'}${components.audio ? '' : '<button type="button" data-component-add="audio">+ Audio</button>'}</div>${components.physics ? section('physics', 'Physics', physicsFields(components.physics)) : ''}${components.particles ? section('particles', 'Particles', particleFields(components.particles)) : ''}${components.audio ? section('audio', 'Audio', audioFields(components.audio, project)) : ''}</fieldset>${disabled ? '<p class="component-hint">Stop playback and unlock this hierarchy to edit components.</p>' : ''}`;
    }

    destroy(): void {
        this.destroyed = true;
        this.detach();
        this.host = null;
    }

    private editable(project: ProjectDocument, node: SceneNode): boolean {
        if (this.options.canEdit?.() === false) return false;
        let current: SceneNode | undefined = node;
        while (current) {
            if (current.locked) return false;
            current = current.parent
                ? project.scenes[project.activeSceneId]?.nodes[current.parent]
                : undefined;
        }
        return true;
    }
    private mutate(
        edit: (components: NodeComponents, project: ProjectDocument) => void,
        label: string
    ): void {
        try {
            const next = structuredClone(this.options.getProject());
            const id = this.options.getSelectedNode();
            const node = id ? next.scenes[next.activeSceneId]?.nodes[id] : undefined;
            if (!node || !this.editable(next, node))
                throw new Error('This object cannot be edited now');
            const components = node.components ?? {};
            edit(components, next);
            if (Object.keys(components).length)
                node.components = validateNodeComponents(components);
            else Reflect.deleteProperty(node, 'components');
            this.options.onCommit(validateProject(next), label);
        } catch (error) {
            this.options.onNotify(error instanceof Error ? error.message : String(error), true);
        }
        if (this.host) this.render(this.host);
    }
    private detach(): void {
        this.host?.removeEventListener('click', this.click);
        this.host?.removeEventListener('change', this.change);
    }
    private readonly click = (event: MouseEvent): void => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest<HTMLElement>(
            '[data-component-add], [data-component-remove]'
        );
        if (!button) return;
        const add = button.dataset['componentAdd'];
        const remove = button.dataset['componentRemove'];
        this.mutate(
            (components, project) => {
                if (add === 'physics') components.physics = defaultPhysicsComponent();
                else if (add === 'particles') components.particles = defaultParticleComponent();
                else if (add === 'audio') {
                    const asset = Object.values(project.assets).find(item => item.kind === 'audio');
                    if (!asset)
                        throw new Error(
                            'Import a PCM WAV audio file in Assets before adding sound'
                        );
                    components.audio = defaultAudioComponent(asset.id);
                } else if (remove === 'physics' || remove === 'particles' || remove === 'audio')
                    Reflect.deleteProperty(components, remove);
            },
            add ? `Added ${add} component` : `Removed ${remove ?? ''} component`
        );
    };
    private readonly change = (event: Event): void => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLSelectElement)) return;
        const path = input.dataset['componentField'];
        if (!path) return;
        this.mutate(components => {
            let record: Record<string, unknown> = { ...components };
            const parts = path.split('.');
            const leaf = parts.pop();
            for (const part of parts) {
                const next = record[part];
                if (typeof next !== 'object' || next === null || Array.isArray(next))
                    throw new Error('Component field is unavailable');
                record = next as Record<string, unknown>;
            }
            if (!leaf || !Object.hasOwn(record, leaf)) throw new Error('Unknown component field');
            record[leaf] =
                input instanceof HTMLInputElement && input.type === 'checkbox'
                    ? input.checked
                    : typeof record[leaf] === 'number'
                      ? input.value.trim()
                          ? Number(input.value)
                          : Number.NaN
                      : input.value;
            const particles = components.particles;
            if (
                particles?.shape === 'sphere' &&
                (path === 'particles.shape' || path === 'particles.extent.x')
            )
                particles.extent.y = particles.extent.z = particles.extent.x;
        }, 'Updated runtime component');
    };
}
