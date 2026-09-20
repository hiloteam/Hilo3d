import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { createExampleCatalog } from '../examples/shared/catalog';
import { collectMarkdownFiles, recipeDirectory, recipeDocuments } from './documentation-manifest';
import { isExternalReference, markdownAnchors, markdownReferences } from './documentation-content';

const root = resolve(import.meta.dirname, '..');
const update = process.argv.includes('--write');
const recipePattern = /<!-- recipe: ([^\n]+) -->\n\s*```ts\n[\s\S]*?```\n\s*<!-- \/recipe -->/gu;
const problems: string[] = [];
for (const document of recipeDocuments) {
    const path = resolve(root, document);
    let contents = await readFile(path, 'utf8');
    const matches = [...contents.matchAll(recipePattern)];
    if (matches.length === 0) throw new Error(`No recipe markers found in ${document}`);
    for (const match of matches.reverse()) {
        const source = match[1] ?? '';
        if (
            !source.startsWith(`${recipeDirectory}/`) ||
            !source.endsWith('.ts') ||
            source.includes('..')
        ) {
            throw new Error(`Invalid recipe source: ${source}`);
        }
        const code = (await readFile(resolve(root, source), 'utf8')).trimEnd();
        const replacement = `<!-- recipe: ${source} -->\n\n\`\`\`ts\n${code}\n\`\`\`\n\n<!-- /recipe -->`;
        if (replacement !== match[0] && !update)
            problems.push(`${document}: recipe drift for ${source}; run docs:sync`);
        contents =
            contents.slice(0, match.index) +
            replacement +
            contents.slice(match.index + match[0].length);
    }
    if (update) await writeFile(path, contents);
}
const catalogPath = resolve(root, 'documentation/EXAMPLE_CATALOG.md');
const catalogDocument = await readFile(catalogPath, 'utf8');
const htmlPaths: string[] = [];
async function collectExamplePages(directory: string, prefix = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = `${prefix}${entry.name}`;
        if (entry.isDirectory())
            await collectExamplePages(resolve(directory, entry.name), `${path}/`);
        else if (entry.isFile() && entry.name.endsWith('.html')) htmlPaths.push(path);
    }
}
await collectExamplePages(resolve(root, 'examples'));
const table = [
    '| 页面 | 处理 | 主题 | 用途 |',
    '| --- | --- | --- | --- |',
    ...createExampleCatalog(htmlPaths).map(
        entry =>
            `| [${entry.id}](../examples/${entry.path}) | ${entry.featured ? '精选' : '保留'} | ${entry.category} | ${entry.description.replaceAll('|', '\\|')} |`
    )
].join('\n');
const formattedTable = (
    await format(table, { ...(await resolveConfig(catalogPath)), parser: 'markdown' })
).trimEnd();
const catalogBlock = `<!-- catalog -->\n\n${formattedTable}\n\n<!-- /catalog -->`;
const catalogPattern = /<!-- catalog -->[\s\S]*?<!-- \/catalog -->/u;
const existingCatalogBlock = catalogPattern.exec(catalogDocument)?.[0];
if (existingCatalogBlock === undefined) throw new Error('Missing generated catalog markers');
if (update) await writeFile(catalogPath, catalogDocument.replace(catalogPattern, catalogBlock));
else if (existingCatalogBlock !== catalogBlock)
    problems.push('EXAMPLE_CATALOG.md: catalog drift; run docs:sync');
if (update) {
    console.log('Updated Markdown from checked recipe source and example catalog.');
} else {
    const packageData = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
    };
    let checked = 0;
    for (const file of await collectMarkdownFiles(root)) {
        const contents = await readFile(resolve(root, file), 'utf8');
        for (const reference of markdownReferences(contents)) {
            if (isExternalReference(reference.url)) continue;
            checked++;
            const [beforeHash = '', fragment] = reference.url.split('#');
            const target = resolve(
                root,
                dirname(file),
                decodeURIComponent(beforeHash.split('?')[0] ?? '')
            );
            const resolved = beforeHash === '' ? resolve(root, file) : target;
            if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
                problems.push(`${file}: escaping link ${reference.url}`);
                continue;
            }
            const info = await stat(resolved).catch(() => null);
            if (info === null) problems.push(`${file}: missing ${reference.url}`);
            else if (fragment && info.isFile() && /\.(?:md|txt)$/u.test(resolved)) {
                if (
                    !markdownAnchors(await readFile(resolved, 'utf8')).has(
                        decodeURIComponent(fragment)
                    )
                ) {
                    problems.push(`${file}: missing anchor ${reference.url}`);
                }
            }
        }
        // These trees intentionally contain historical/proposed commands or standalone app scripts.
        if (file.includes('/archive/') || file.startsWith('skills/')) continue;
        for (const match of contents.matchAll(/npm run ([\w:.-]+)/gu)) {
            const command = match[1] ?? '';
            if (!(command in packageData.scripts))
                problems.push(`${file}: unknown npm command ${command}`);
        }
    }
    if (problems.length > 0)
        throw new Error(`Documentation validation failed:\n${problems.join('\n')}`);
    console.log(
        `Validated ${String(checked)} source links/anchors, npm commands and recipe snippets in ${relative(root, resolve(root, 'documentation'))}.`
    );
}
