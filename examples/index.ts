import { EXAMPLE_CATALOG, EXAMPLE_CATEGORIES } from './shared/catalog';

const root = document.querySelector<HTMLElement>('#catalog');
if (!root) throw new Error('Example catalog requires #catalog.');
for (const category of EXAMPLE_CATEGORIES) {
    const entries = EXAMPLE_CATALOG.filter(entry => entry.category === category.id);
    if (entries.length === 0) continue;
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = category.label;
    section.append(heading);
    for (const entry of entries) {
        const link = document.createElement('a');
        link.href = entry.path;
        link.innerHTML = `<strong>${entry.title}</strong><span>${entry.description}</span>`;
        section.append(link);
    }
    root.append(section);
}
