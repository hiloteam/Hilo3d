import { opendir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { extractSiteReferences, type SiteFileType } from './site-link-references';

const projectRoot = resolve(import.meta.dirname, '..');
const siteDirectory = resolve(projectRoot, 'site');
const externalReferencePattern = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

interface SiteFile {
    path: string;
    type: SiteFileType;
}

interface LinkIssue {
    reference: string;
    source: string;
    type: 'absolute' | 'escape' | 'invalid' | 'missing';
}

async function collectSiteFiles(directory: string): Promise<SiteFile[]> {
    const files: SiteFile[] = [];
    const entries = await opendir(directory);

    for await (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectSiteFiles(path)));
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
            files.push({ path, type: 'html' });
        } else if (entry.isFile() && entry.name.endsWith('.css')) {
            files.push({ path, type: 'css' });
        } else if (entry.isFile() && entry.name.endsWith('.gltf')) {
            files.push({ path, type: 'gltf' });
        }
    }

    return files;
}

async function resolveTarget(reference: string, sourcePath: string): Promise<string> {
    const pathWithQuery = reference.split('#', 1)[0] ?? '';
    const encodedPath = pathWithQuery.split('?', 1)[0] ?? '';
    const decodedPath = decodeURIComponent(encodedPath);
    let target = decodedPath.startsWith('/')
        ? resolve(siteDirectory, `.${decodedPath}`)
        : resolve(dirname(sourcePath), decodedPath || '.');

    const targetStats = await stat(target).catch(() => null);
    if (target === siteDirectory || targetStats?.isDirectory()) {
        target = resolve(target, 'index.html');
    }

    return target;
}

const siteFiles = await collectSiteFiles(siteDirectory);
const issues: LinkIssue[] = [];
let checkedReferences = 0;

for (const file of siteFiles) {
    const contents = await readFile(file.path, 'utf8');
    for (const reference of extractSiteReferences(file.type, contents)) {
        if (!reference || reference.startsWith('#') || externalReferencePattern.test(reference)) {
            continue;
        }

        checkedReferences += 1;
        const source = relative(siteDirectory, file.path);
        if (reference.startsWith('/')) {
            issues.push({ reference, source, type: 'absolute' });
            continue;
        }

        let target: string;
        try {
            target = await resolveTarget(reference, file.path);
        } catch {
            issues.push({ reference, source, type: 'invalid' });
            continue;
        }

        if (target !== siteDirectory && !target.startsWith(`${siteDirectory}${sep}`)) {
            issues.push({ reference, source, type: 'escape' });
            continue;
        }

        const targetStats = await stat(target).catch(() => null);
        if (!targetStats?.isFile()) {
            issues.push({ reference, source, type: 'missing' });
        }
    }
}

if (issues.length > 0) {
    const details = issues
        .map(issue => `- ${issue.type}: ${issue.source} -> ${issue.reference}`)
        .join('\n');
    throw new Error(
        `Site link validation failed with ${String(issues.length)} issue(s):\n${details}`
    );
}

console.log(
    `Validated ${String(checkedReferences)} internal references across ${String(siteFiles.length)} HTML/CSS/glTF files.`
);
