import { resolveExampleBackend, type ExampleBackend } from './shared/backend';
import {
    createExampleCatalog,
    EXAMPLE_CATEGORIES,
    type ExampleCatalogEntry,
    type ExampleCategoryId
} from './shared/catalog';
import examplePaths from 'virtual:hilo3d-example-manifest';

type HTMLElementConstructor<ElementType extends HTMLElement> = new () => ElementType;

function requireElement<ElementType extends HTMLElement>(
    selector: string,
    Constructor: HTMLElementConstructor<ElementType>
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof Constructor)) {
        throw new Error(`Example index requires ${selector}`);
    }
    return element;
}

const navigationElement = requireElement('#exampleNavigation', HTMLElement);
const frame = requireElement('#exampleFrame', HTMLIFrameElement);
const backendSelect = requireElement('#backendSelect', HTMLSelectElement);
const searchInput = requireElement('#exampleSearch', HTMLInputElement);
const exampleCount = requireElement('#exampleCount', HTMLSpanElement);
const currentTitle = requireElement('#currentTitle', HTMLHeadingElement);
const currentDescription = requireElement('#currentDescription', HTMLParagraphElement);
const currentCategory = requireElement('#currentCategory', HTMLSpanElement);
const currentBackend = requireElement('#currentBackend', HTMLSpanElement);
const viewSource = requireElement('#viewSource', HTMLAnchorElement);
const openExample = requireElement('#openExample', HTMLAnchorElement);
const frameStatus = requireElement('#frameStatus', HTMLDivElement);
const frameStatusText = requireElement('#frameStatusText', HTMLSpanElement);
const sidebarToggle = requireElement('#sidebarToggle', HTMLButtonElement);
const sidebarBackdrop = requireElement('#sidebarBackdrop', HTMLButtonElement);
const featuredModeButton = requireElement('#featuredMode', HTMLButtonElement);
const allModeButton = requireElement('#allMode', HTMLButtonElement);
const backend = resolveExampleBackend();

const categoryLabels = new Map<ExampleCategoryId, string>(
    EXAMPLE_CATEGORIES.map(category => [category.id, category.label])
);
const backendLabels: Readonly<Record<ExampleBackend, string>> = Object.freeze({
    webgl2: 'WebGL 2',
    webgpu: 'WebGPU'
});
const catalog = createExampleCatalog(examplePaths);
const entriesById = new Map(catalog.map(entry => [entry.id, entry] as const));
const buttonsById = new Map<string, HTMLButtonElement>();

type CatalogMode = 'featured' | 'all';

let catalogMode: CatalogMode = 'featured';
let filteredEntries: readonly ExampleCatalogEntry[] = catalog.filter(entry => entry.featured);
let currentId = '';
let frameLoadTimeout: number | undefined;

backendSelect.value = backend;
backendSelect.addEventListener('change', () => {
    const nextBackend = backendSelect.value;
    if (nextBackend !== 'webgl2' && nextBackend !== 'webgpu') {
        throw new TypeError(`Unsupported example backend "${nextBackend}".`);
    }
    const target = new URL(location.href);
    target.searchParams.set('backend', nextBackend);
    location.assign(target);
});

function setSidebarOpen(open: boolean): void {
    document.body.classList.toggle('sidebarOpen', open);
    sidebarToggle.setAttribute('aria-expanded', String(open));
    sidebarToggle.setAttribute(
        'aria-label',
        open ? 'Close example navigation' : 'Open example navigation'
    );
}

function setFrameStatus(state: 'loading' | 'ready' | 'error', message: string): void {
    frameStatus.dataset['state'] = state;
    frameStatusText.textContent = message;
}

function backendForEntry(entry: ExampleCatalogEntry): ExampleBackend {
    if (entry.supportedBackends.includes(backend)) return backend;
    if (entry.supportedBackends.includes('webgpu')) return 'webgpu';
    if (entry.supportedBackends.includes('webgl2')) return 'webgl2';
    throw new Error(`${entry.path} does not declare a supported graphics backend.`);
}

function onlyBackendLabel(entry: ExampleCatalogEntry): string | undefined {
    if (entry.supportedBackends.length !== 1) return undefined;
    return entry.supportedBackends[0] === 'webgpu' ? 'WebGPU only' : 'WebGL 2 only';
}

function buildExampleUrl(entry: ExampleCatalogEntry, includeGalleryQuery: boolean): URL {
    const target = new URL(entry.path, location.href);
    const query = new URLSearchParams(entry.defaultQuery);
    if (includeGalleryQuery) {
        for (const [name, value] of new URLSearchParams(location.search)) {
            if (name !== 'backend') query.set(name, value);
        }
    }
    query.set('backend', backendForEntry(entry));
    target.search = query.toString();
    return target;
}

function updateLocationHash(entry: ExampleCatalogEntry, replace: boolean): void {
    const target = new URL(location.href);
    target.hash = entry.id;
    if (replace) {
        history.replaceState(null, '', target);
    } else {
        history.pushState(null, '', target);
    }
}

interface ShowExampleOptions {
    readonly includeGalleryQuery?: boolean;
    readonly updateHistory?: 'push' | 'replace' | false;
    readonly focusNavigation?: boolean;
}

function showExample(entry: ExampleCatalogEntry, options: ShowExampleOptions = {}): void {
    if (entry.id === currentId) {
        if (options.focusNavigation) buttonsById.get(entry.id)?.focus();
        return;
    }

    const previousButton = buttonsById.get(currentId);
    previousButton?.removeAttribute('aria-current');
    const nextButton = buttonsById.get(entry.id);
    nextButton?.setAttribute('aria-current', 'page');

    const target = buildExampleUrl(entry, options.includeGalleryQuery ?? false);
    const activeBackend = backendForEntry(entry);
    const backendRestriction = onlyBackendLabel(entry);
    currentTitle.textContent = entry.title;
    currentDescription.textContent = entry.description;
    currentCategory.textContent = categoryLabels.get(entry.category) ?? entry.category;
    currentBackend.textContent = backendRestriction ?? backendLabels[activeBackend];
    currentBackend.dataset['backend'] = activeBackend;
    currentBackend.dataset['fallback'] = String(activeBackend !== backend);
    openExample.href = target.href;
    viewSource.href = `https://github.com/hiloteam/Hilo3d/blob/dev/examples/${entry.sourcePath}`;
    frame.title = `${entry.title} — Hilo3D example`;

    if (frameLoadTimeout !== undefined) window.clearTimeout(frameLoadTimeout);
    setFrameStatus('loading', `Loading ${entry.title}…`);
    frameLoadTimeout = window.setTimeout(() => {
        setFrameStatus('error', `${entry.title} is taking longer than expected to load.`);
    }, 15_000);
    frame.src = target.href;
    currentId = entry.id;

    if (options.updateHistory) {
        updateLocationHash(entry, options.updateHistory === 'replace');
    }
    if (options.focusNavigation) nextButton?.focus();
    setSidebarOpen(false);
}

function renderNavigation(entries: readonly ExampleCatalogEntry[]): void {
    navigationElement.replaceChildren();
    buttonsById.clear();
    exampleCount.textContent = `${String(entries.length)} of ${String(catalog.length)}`;

    if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'emptyState';
        empty.textContent = 'No examples match this search.';
        navigationElement.appendChild(empty);
        return;
    }

    for (const category of EXAMPLE_CATEGORIES) {
        const categoryEntries = entries.filter(entry => entry.category === category.id);
        if (categoryEntries.length === 0) continue;

        const section = document.createElement('section');
        section.className = 'categorySection';
        const heading = document.createElement('h2');
        heading.className = 'categoryHeading';
        const headingLabel = document.createElement('span');
        headingLabel.textContent = category.label;
        const headingCount = document.createElement('span');
        headingCount.className = 'categoryCount';
        headingCount.textContent = String(categoryEntries.length);
        heading.append(headingLabel, headingCount);
        section.appendChild(heading);

        const list = document.createElement('ul');
        list.className = 'categoryList';
        for (const entry of categoryEntries) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.className = 'exampleButton';
            button.type = 'button';
            button.dataset['exampleId'] = entry.id;
            button.dataset['examplePath'] = entry.path;
            button.dataset['backendCompatible'] = String(entry.supportedBackends.includes(backend));
            button.title = entry.description;
            const buttonHeading = document.createElement('span');
            buttonHeading.className = 'exampleButtonHeading';
            const title = document.createElement('span');
            title.className = 'exampleButtonTitle';
            title.textContent = entry.title;
            buttonHeading.appendChild(title);
            const backendRestriction = onlyBackendLabel(entry);
            if (backendRestriction) {
                const badge = document.createElement('span');
                badge.className = 'exampleBackendBadge';
                badge.dataset['backend'] = entry.supportedBackends[0];
                badge.textContent = backendRestriction;
                buttonHeading.appendChild(badge);
            }
            const description = document.createElement('span');
            description.className = 'exampleButtonDescription';
            description.textContent = entry.description;
            button.append(buttonHeading, description);
            if (entry.id === currentId) button.setAttribute('aria-current', 'page');
            button.addEventListener('click', () => {
                showExample(entry, { updateHistory: 'push' });
            });
            buttonsById.set(entry.id, button);
            item.appendChild(button);
            list.appendChild(item);
        }
        section.appendChild(list);
        navigationElement.appendChild(section);
    }
}

function entriesForCurrentMode(): readonly ExampleCatalogEntry[] {
    return catalogMode === 'featured' ? catalog.filter(entry => entry.featured) : catalog;
}

function filterNavigation(): void {
    const query = searchInput.value.trim().toLowerCase();
    filteredEntries = query
        ? catalog.filter(entry => entry.searchText.includes(query))
        : entriesForCurrentMode();
    renderNavigation(filteredEntries);
}

function setCatalogMode(mode: CatalogMode): void {
    catalogMode = mode;
    featuredModeButton.setAttribute('aria-pressed', String(mode === 'featured'));
    allModeButton.setAttribute('aria-pressed', String(mode === 'all'));
    filterNavigation();
}

function navigationTargetIsEditable(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
    );
}

function navigateRelative(direction: -1 | 1): void {
    if (filteredEntries.length === 0) return;
    const currentIndex = filteredEntries.findIndex(entry => entry.id === currentId);
    const nextIndex =
        currentIndex < 0
            ? direction > 0
                ? 0
                : filteredEntries.length - 1
            : (currentIndex + direction + filteredEntries.length) % filteredEntries.length;
    const next = filteredEntries[nextIndex];
    if (next) {
        showExample(next, {
            updateHistory: 'push',
            focusNavigation: true
        });
    }
}

frame.addEventListener('load', () => {
    if (frameLoadTimeout !== undefined) {
        window.clearTimeout(frameLoadTimeout);
        frameLoadTimeout = undefined;
    }
    setFrameStatus('ready', `${currentTitle.textContent} loaded.`);
});
frame.addEventListener('error', () => {
    if (frameLoadTimeout !== undefined) {
        window.clearTimeout(frameLoadTimeout);
        frameLoadTimeout = undefined;
    }
    setFrameStatus('error', `${currentTitle.textContent} could not be loaded.`);
});

searchInput.addEventListener('input', filterNavigation);
featuredModeButton.addEventListener('click', () => {
    setCatalogMode('featured');
});
allModeButton.addEventListener('click', () => {
    setCatalogMode('all');
});
sidebarToggle.addEventListener('click', () => {
    setSidebarOpen(!document.body.classList.contains('sidebarOpen'));
});
sidebarBackdrop.addEventListener('click', () => {
    setSidebarOpen(false);
});

const requestedId = decodeURIComponent(location.hash.slice(1));
const requestedEntry = entriesById.get(requestedId);
if (requestedEntry && !requestedEntry.featured) catalogMode = 'all';
setCatalogMode(catalogMode);
const initial = requestedEntry ?? catalog.find(entry => entry.id === 'quickStart') ?? catalog[0];
if (!initial) throw new Error('Example index has no entries');
showExample(initial, {
    includeGalleryQuery: true,
    updateHistory: 'replace'
});

window.addEventListener('keydown', event => {
    if (event.key === '/' && !navigationTargetIsEditable(event.target)) {
        event.preventDefault();
        searchInput.focus();
        return;
    }
    if (navigationTargetIsEditable(event.target) || !['ArrowUp', 'ArrowDown'].includes(event.key)) {
        return;
    }
    event.preventDefault();
    navigateRelative(event.key === 'ArrowUp' ? -1 : 1);
});

function showLocationHashExample(): void {
    const entry = entriesById.get(decodeURIComponent(location.hash.slice(1)));
    if (entry) showExample(entry);
}

window.addEventListener('hashchange', showLocationHashExample);
window.addEventListener('popstate', showLocationHashExample);
