import { resolveExampleBackend, type ExampleBackend } from './shared/backend';
import {
    createExampleCatalog,
    EXAMPLE_CATEGORIES,
    matchesExampleSearch,
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
    if (!(element instanceof Constructor)) throw new Error(`Example index requires ${selector}`);
    return element;
}

const navigationElement = requireElement('#exampleNavigation', HTMLElement);
const sidebar = requireElement('#gallerySidebar', HTMLElement);
const viewer = requireElement('.viewer', HTMLElement);
let frame = requireElement('#exampleFrame', HTMLIFrameElement);
const backendSelect = requireElement('#backendSelect', HTMLSelectElement);
const searchInput = requireElement('#exampleSearch', HTMLInputElement);
const categorySelect = requireElement('#categorySelect', HTMLSelectElement);
const compatibleOnly = requireElement('#compatibleOnly', HTMLInputElement);
const clearFilters = requireElement('#clearFilters', HTMLButtonElement);
const exampleCount = requireElement('#exampleCount', HTMLSpanElement);
const currentTitle = requireElement('#currentTitle', HTMLHeadingElement);
const currentDescription = requireElement('#currentDescription', HTMLParagraphElement);
const currentCategory = requireElement('#currentCategory', HTMLSpanElement);
const currentBackend = requireElement('#currentBackend', HTMLSpanElement);
const viewSource = requireElement('#viewSource', HTMLAnchorElement);
const openExample = requireElement('#openExample', HTMLAnchorElement);
const frameStatus = requireElement('#frameStatus', HTMLDivElement);
const frameStatusText = requireElement('#frameStatusText', HTMLSpanElement);
const retryExample = requireElement('#retryExample', HTMLButtonElement);
const sidebarToggle = requireElement('#sidebarToggle', HTMLButtonElement);
const sidebarBackdrop = requireElement('#sidebarBackdrop', HTMLButtonElement);
const featuredModeButton = requireElement('#featuredMode', HTMLButtonElement);
const allModeButton = requireElement('#allMode', HTMLButtonElement);
const mobileLayout = window.matchMedia('(max-width: 900px)');
const backend = resolveExampleBackend();
const categoryLabels = new Map<ExampleCategoryId, string>(
    EXAMPLE_CATEGORIES.map(category => [category.id, category.label])
);
const backendLabels: Readonly<Record<ExampleBackend, string>> = {
    webgl2: 'WebGL 2',
    webgpu: 'WebGPU'
};
const catalog = createExampleCatalog(examplePaths);
const entriesById = new Map(catalog.map(entry => [entry.id, entry] as const));
const buttonsById = new Map<string, HTMLButtonElement>();
const categoryOptions = new Map<ExampleCategoryId, HTMLOptionElement>();
const galleryQueryKeys = new Set(['backend', 'q', 'category', 'collection', 'compatible']);
type CatalogMode = 'featured' | 'all';
let catalogMode: CatalogMode = 'featured';
let filteredEntries: readonly ExampleCatalogEntry[] = [];
let currentId = '';
let frameLoadTimeout: number | undefined;
let failedFrameUrl: string | undefined;

for (const category of EXAMPLE_CATEGORIES) {
    const option = document.createElement('option');
    option.value = category.id;
    categoryOptions.set(category.id, option);
    categorySelect.append(option);
}

function updateCategoryCounts(entries: readonly ExampleCatalogEntry[]): void {
    const allTopics = categorySelect.options[0];
    if (allTopics) allTopics.textContent = `All topics (${String(entries.length)})`;
    for (const category of EXAMPLE_CATEGORIES) {
        const option = categoryOptions.get(category.id);
        if (!option) continue;
        const count = entries.filter(entry => entry.category === category.id).length;
        option.textContent = `${category.label} (${String(count)})`;
        // Keep an empty selected topic visible so changing collections never silently resets it.
        option.hidden = count === 0 && categorySelect.value !== category.id;
        option.disabled = count === 0;
    }
}

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

function setSidebarOpen(open: boolean, restoreFocus = false): void {
    const expanded = open && mobileLayout.matches;
    document.body.classList.toggle('sidebarOpen', expanded);
    sidebar.inert = mobileLayout.matches && !expanded;
    viewer.inert = expanded;
    sidebarBackdrop.tabIndex = expanded ? 0 : -1;
    sidebarToggle.setAttribute('aria-expanded', String(expanded));
    sidebarToggle.setAttribute(
        'aria-label',
        expanded ? 'Close example navigation' : 'Open example navigation'
    );
    if (restoreFocus && mobileLayout.matches) sidebarToggle.focus();
}

function setFrameStatus(state: 'loading' | 'ready' | 'error', message: string): void {
    frameStatus.dataset['state'] = state;
    frameStatusText.textContent = message;
    frame.setAttribute('aria-busy', String(state === 'loading'));
    retryExample.hidden = state !== 'error';
}

function clearLoadTimeout(): void {
    if (frameLoadTimeout !== undefined) window.clearTimeout(frameLoadTimeout);
    frameLoadTimeout = undefined;
}

function backendForEntry(entry: ExampleCatalogEntry): ExampleBackend {
    if (entry.supportedBackends.includes(backend)) return backend;
    const supported = entry.supportedBackends[0];
    if (!supported) throw new Error(`${entry.path} does not declare a supported graphics backend.`);
    return supported;
}

function onlyBackendLabel(entry: ExampleCatalogEntry): string | undefined {
    if (entry.supportedBackends.length !== 1) return undefined;
    return entry.supportedBackends[0] === 'webgpu' ? 'WebGPU only' : 'WebGL 2 only';
}

function buildExampleUrl(entry: ExampleCatalogEntry, includeGalleryQuery: boolean): URL {
    const target = new URL(entry.path, location.href);
    const query = new URLSearchParams(entry.defaultQuery);
    // Resolve bundled assets against the gallery, including sites hosted under a path prefix.
    const model = query.get('url');
    if (model?.startsWith('./')) query.set('url', new URL(model, location.href).pathname);
    if (includeGalleryQuery) {
        for (const [name, value] of new URLSearchParams(location.search)) {
            if (!galleryQueryKeys.has(name)) query.set(name, value);
        }
    }
    query.set('backend', backendForEntry(entry));
    target.search = query.toString();
    return target;
}

function writeFilterQuery(target: URL): void {
    const filters: Readonly<Record<string, string>> = {
        q: searchInput.value.trim(),
        category: categorySelect.value === 'all' ? '' : categorySelect.value,
        collection:
            catalogMode === 'all'
                ? 'all'
                : entriesById.get(currentId)?.featured === false
                  ? 'featured'
                  : '',
        compatible: compatibleOnly.checked ? '1' : ''
    };
    for (const [key, value] of Object.entries(filters)) {
        if (value) target.searchParams.set(key, value);
        else target.searchParams.delete(key);
    }
}

interface ShowExampleOptions {
    readonly includeGalleryQuery?: boolean;
    readonly updateHistory?: 'push' | 'replace' | false;
    readonly focusNavigation?: boolean;
    readonly reload?: boolean;
}

function showExample(entry: ExampleCatalogEntry, options: ShowExampleOptions = {}): void {
    const target = buildExampleUrl(entry, options.includeGalleryQuery ?? false);
    if (entry.id === currentId && frame.src === target.href && !options.reload) {
        if (options.focusNavigation) buttonsById.get(entry.id)?.focus();
        setSidebarOpen(false, sidebar.contains(document.activeElement));
        return;
    }
    buttonsById.get(currentId)?.removeAttribute('aria-current');
    const nextButton = buttonsById.get(entry.id);
    nextButton?.setAttribute('aria-current', 'page');
    const activeBackend = backendForEntry(entry);
    currentTitle.textContent = entry.title;
    currentDescription.textContent = entry.description;
    currentCategory.textContent = categoryLabels.get(entry.category) ?? entry.category;
    currentBackend.textContent = onlyBackendLabel(entry) ?? backendLabels[activeBackend];
    currentBackend.dataset['backend'] = activeBackend;
    currentBackend.dataset['fallback'] = String(activeBackend !== backend);
    openExample.href = target.href;
    viewSource.href = `https://github.com/hiloteam/Hilo3d/blob/dev/examples/${entry.sourcePath}`;
    frame.title = `${entry.title} — Hilo3D example`;
    clearLoadTimeout();
    failedFrameUrl = undefined;
    setFrameStatus('loading', `Loading ${entry.title}…`);
    frameLoadTimeout = window.setTimeout(() => {
        setFrameStatus(
            'error',
            `${entry.title} is taking longer than expected. Retry or open it in a new tab.`
        );
    }, 30_000);
    // A fresh browsing context avoids iframe navigations adding their own history entries.
    const nextFrame = document.createElement('iframe');
    for (const attribute of frame.attributes)
        nextFrame.setAttribute(attribute.name, attribute.value);
    nextFrame.src = target.href;
    nextFrame.addEventListener('load', handleFrameLoad);
    nextFrame.addEventListener('error', handleFrameError);
    const previousFrame = frame;
    frame = nextFrame;
    previousFrame.replaceWith(nextFrame);
    currentId = entry.id;
    document.title = `${entry.title} — Hilo3D Examples`;
    if (options.updateHistory) {
        const locationTarget = new URL(location.href);
        if (!options.includeGalleryQuery) {
            for (const key of [...locationTarget.searchParams.keys()]) {
                if (!galleryQueryKeys.has(key)) locationTarget.searchParams.delete(key);
            }
        }
        writeFilterQuery(locationTarget);
        locationTarget.hash = entry.id;
        if (options.updateHistory === 'replace') history.replaceState(null, '', locationTarget);
        else history.pushState(null, '', locationTarget);
    }
    if (options.focusNavigation) nextButton?.focus();
    const restoreFocus = sidebar.contains(document.activeElement);
    setSidebarOpen(false, restoreFocus);
    nextButton?.scrollIntoView({ block: 'nearest' });
}

function renderNavigation(entries: readonly ExampleCatalogEntry[], collectionSize: number): void {
    navigationElement.replaceChildren();
    buttonsById.clear();
    exampleCount.textContent = `${String(entries.length)} of ${String(collectionSize)} ${catalogMode === 'featured' ? 'highlights' : 'examples'}`;
    if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'emptyState';
        empty.textContent =
            catalogMode === 'featured'
                ? 'No highlights match. Try All examples or reset the filters.'
                : 'No examples match. Try fewer words or reset the filters.';
        navigationElement.append(empty);
        return;
    }
    const fragment = document.createDocumentFragment();
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
        section.append(heading);
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
            button.title = `${entry.title}\n${entry.description}`;
            const buttonHeading = document.createElement('span');
            buttonHeading.className = 'exampleButtonHeading';
            const title = document.createElement('span');
            title.className = 'exampleButtonTitle';
            title.textContent = entry.title;
            buttonHeading.append(title);
            const restriction = onlyBackendLabel(entry);
            if (restriction) {
                const badge = document.createElement('span');
                badge.className = 'exampleBackendBadge';
                badge.dataset['backend'] = entry.supportedBackends[0];
                badge.textContent = restriction;
                buttonHeading.append(badge);
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
            item.append(button);
            list.append(item);
        }
        section.append(list);
        fragment.append(section);
    }
    navigationElement.append(fragment);
}

function filterNavigation(persist = true): void {
    const query = searchInput.value.trim();
    const category = categorySelect.value;
    const collection =
        catalogMode === 'featured' ? catalog.filter(entry => entry.featured) : catalog;
    const matchingEntries = collection.filter(
        entry =>
            (!compatibleOnly.checked || entry.supportedBackends.includes(backend)) &&
            matchesExampleSearch(entry, query)
    );
    updateCategoryCounts(matchingEntries);
    filteredEntries = matchingEntries.filter(
        entry => category === 'all' || entry.category === category
    );
    featuredModeButton.setAttribute('aria-pressed', String(catalogMode === 'featured'));
    allModeButton.setAttribute('aria-pressed', String(catalogMode === 'all'));
    clearFilters.disabled = !query && category === 'all' && !compatibleOnly.checked;
    renderNavigation(filteredEntries, collection.length);
    if (persist) {
        const target = new URL(location.href);
        writeFilterQuery(target);
        history.replaceState(null, '', target);
    }
}

function requestedEntry(): ExampleCatalogEntry | undefined {
    try {
        return entriesById.get(decodeURIComponent(location.hash.slice(1)));
    } catch {
        return undefined;
    }
}

function restoreFilters(): void {
    const query = new URLSearchParams(location.search);
    catalogMode =
        query.get('collection') === 'all' ||
        (!query.has('collection') && requestedEntry()?.featured === false)
            ? 'all'
            : 'featured';
    searchInput.value = query.get('q') ?? '';
    const category = query.get('category');
    categorySelect.value =
        EXAMPLE_CATEGORIES.some(item => item.id === category) && category ? category : 'all';
    compatibleOnly.checked = query.get('compatible') === '1';
    filterNavigation(false);
}

function navigationTargetIsEditable(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
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
    if (next) showExample(next, { updateHistory: 'push', focusNavigation: true });
}

function handleFrameLoad(event: Event): void {
    if (event.currentTarget !== frame) return;
    // Ignore the initial about:blank document and superseded navigations.
    try {
        if (frame.contentWindow?.location.href !== frame.src) return;
    } catch {
        clearLoadTimeout();
        setFrameStatus('error', 'The example could not be opened. Retry or open it in a new tab.');
        return;
    }
    clearLoadTimeout();
    if (failedFrameUrl === frame.src) return;
    setFrameStatus('ready', `${currentTitle.textContent} loaded.`);
}
window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (
        typeof data !== 'object' ||
        data === null ||
        !('type' in data) ||
        data.type !== 'hilo3d:example-error' ||
        !('url' in data) ||
        data.url !== frame.src ||
        !('message' in data) ||
        typeof data.message !== 'string'
    )
        return;
    failedFrameUrl = frame.src;
    clearLoadTimeout();
    setFrameStatus('error', `${currentTitle.textContent}: ${data.message}`);
});
function handleFrameError(event: Event): void {
    if (event.currentTarget !== frame) return;
    clearLoadTimeout();
    setFrameStatus('error', `${currentTitle.textContent} could not be loaded.`);
}
retryExample.addEventListener('click', () => {
    const entry = entriesById.get(currentId);
    if (entry) showExample(entry, { includeGalleryQuery: true, reload: true });
});
searchInput.addEventListener('input', () => {
    filterNavigation();
});
categorySelect.addEventListener('change', () => {
    filterNavigation();
});
compatibleOnly.addEventListener('change', () => {
    filterNavigation();
});
clearFilters.addEventListener('click', () => {
    searchInput.value = '';
    categorySelect.value = 'all';
    compatibleOnly.checked = false;
    filterNavigation();
    searchInput.focus();
});
featuredModeButton.addEventListener('click', () => {
    catalogMode = 'featured';
    filterNavigation();
});
allModeButton.addEventListener('click', () => {
    catalogMode = 'all';
    filterNavigation();
});
sidebarToggle.addEventListener('click', () => {
    const open = !document.body.classList.contains('sidebarOpen');
    setSidebarOpen(open);
    if (open) searchInput.focus();
});
sidebarBackdrop.addEventListener('click', () => {
    setSidebarOpen(false, true);
});
mobileLayout.addEventListener('change', () => {
    setSidebarOpen(false);
});
setSidebarOpen(false);
restoreFilters();
const initial = requestedEntry() ?? entriesById.get('quickStart') ?? catalog[0];
if (!initial) throw new Error('Example index has no entries');
showExample(initial, { includeGalleryQuery: true, updateHistory: 'replace' });

window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('sidebarOpen')) {
        event.preventDefault();
        setSidebarOpen(false, true);
        return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === '/' && !navigationTargetIsEditable(event.target)) {
        event.preventDefault();
        setSidebarOpen(true);
        searchInput.focus();
        return;
    }
    if (event.key === 'Tab' && document.body.classList.contains('sidebarOpen')) {
        const focusable = [
            sidebarToggle,
            ...sidebar.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')
        ];
        const index = focusable.findIndex(element => element === document.activeElement);
        const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
        event.preventDefault();
        focusable[next]?.focus();
        return;
    }
    if (
        navigationTargetIsEditable(event.target) ||
        !navigationElement.contains(document.activeElement) ||
        !['ArrowUp', 'ArrowDown'].includes(event.key)
    )
        return;
    event.preventDefault();
    navigateRelative(event.key === 'ArrowUp' ? -1 : 1);
});

function showLocationHashExample(): void {
    restoreFilters();
    const entry = requestedEntry() ?? entriesById.get('quickStart');
    if (entry) showExample(entry, { includeGalleryQuery: true });
}
window.addEventListener('hashchange', showLocationHashExample);
window.addEventListener('popstate', showLocationHashExample);
