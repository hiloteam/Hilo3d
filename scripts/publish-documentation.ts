import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { collectMarkdownFiles, recipeDirectory } from './documentation-manifest';
import {
    documentationChannel,
    isExternalReference,
    markdownReferences
} from './documentation-content';

interface DocumentationBuild {
    readonly packageVersion: string;
    readonly commit: string;
    readonly releaseTag: string | null;
    readonly modified: boolean;
    readonly channel: 'release-source' | 'development';
}

function slash(path: string): string {
    return path.split(sep).join('/');
}

/** Publish source Markdown beside TypeDoc, retaining an explicit source-build identity. */
export async function publishDocumentation(root: string, site: string): Promise<void> {
    const git = (...args: string[]): string =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
        version: string;
    };
    const commit = git('rev-parse', 'HEAD');
    const tags = git('tag', '--points-at', 'HEAD').split('\n');
    const releaseTag = tags.find(tag => tag === version || tag === `v${version}`) ?? null;
    const modified = git('status', '--porcelain', '--untracked-files=all').length > 0;
    const build: DocumentationBuild = {
        packageVersion: version,
        commit,
        releaseTag,
        modified,
        channel: documentationChannel(releaseTag, modified)
    };
    const label = `${build.channel}; package version ${version}; source ${commit}${modified ? ' (local modifications; remote source links show the base commit)' : ''}`;
    const files = await collectMarkdownFiles(root);
    const published = new Set(files);
    await mkdir(resolve(site, 'documentation'), { recursive: true });
    await writeFile(
        resolve(site, 'documentation/build.json'),
        `${JSON.stringify(build, null, 2)}\n`
    );
    await cp(resolve(root, recipeDirectory), resolve(site, recipeDirectory), { recursive: true });

    const publications = await Promise.all(
        files.map(async file => ({
            file,
            output: file,
            contents: await readFile(resolve(root, file), 'utf8')
        }))
    );
    const sourceByContents = new Map(publications.map(item => [item.contents, item.file]));
    // TypeDoc flattens linked Markdown into media/. Relocate its source-relative links too.
    const mediaDirectory = resolve(site, 'docs/media');
    for (const entry of await readdir(mediaDirectory)) {
        if (!entry.endsWith('.md') && entry !== 'llms.txt') continue;
        const contents = await readFile(resolve(mediaDirectory, entry), 'utf8');
        const file = sourceByContents.get(contents);
        if (file === undefined) throw new Error(`Unmapped TypeDoc Markdown asset: ${entry}`);
        publications.push({ file, output: `docs/media/${entry}`, contents });
    }
    for (const publication of publications) {
        const { file, output } = publication;
        let { contents } = publication;
        for (const link of markdownReferences(contents).reverse()) {
            if (isExternalReference(link.url) || link.url.startsWith('#')) continue;
            const suffixIndex = link.url.search(/[?#]/u);
            const sourcePath = suffixIndex < 0 ? link.url : link.url.slice(0, suffixIndex);
            const suffix = suffixIndex < 0 ? '' : link.url.slice(suffixIndex);
            const target = resolve(root, dirname(file), decodeURIComponent(sourcePath));
            if (!target.startsWith(`${root}${sep}`))
                throw new Error(`Documentation link escapes repository: ${file} -> ${link.url}`);
            let destination = slash(relative(root, target));
            const targetInfo = await stat(target);
            if (targetInfo.isDirectory() && published.has(`${destination}/README.md`))
                destination += '/README.md';
            if (destination.startsWith('website/'))
                destination = destination.slice('website/'.length);
            let local =
                published.has(destination) ||
                (!destination.endsWith('.md') &&
                    (await stat(resolve(site, destination)).catch(() => null))?.isFile() === true);
            if (!local && destination.startsWith('documentation/') && targetInfo.isFile()) {
                await mkdir(dirname(resolve(site, destination)), { recursive: true });
                await cp(target, resolve(site, destination));
                local = true;
            }
            const url = local
                ? `${slash(relative(dirname(resolve(site, output)), resolve(site, destination)))}${suffix}`
                : `https://github.com/hiloteam/Hilo3d/${targetInfo.isDirectory() ? 'tree' : 'blob'}/${commit}/${destination.split('/').map(encodeURIComponent).join('/')}${suffix}`;
            contents =
                contents.slice(0, link.start) + url + contents.slice(link.start + link.length);
        }
        if (file === 'llms.txt') {
            contents = contents.replace(
                '<!-- build-provenance -->',
                `Build: ${label}. [Build provenance](${slash(relative(dirname(resolve(site, output)), resolve(site, 'documentation/build.json')))}).`
            );
        } else {
            const notice = `> Documentation build: ${label}. Match installed declarations before using an API.\n\n`;
            const frontmatter = /^---\n[\s\S]*?\n---\n/u.exec(contents)?.[0];
            contents =
                frontmatter === undefined
                    ? notice + contents
                    : `${frontmatter}\n${notice}${contents.slice(frontmatter.length).trimStart()}`;
        }
        // README's decorative HTML uses the repository website/ prefix.
        if (file === 'README.md' || file === 'README_ZH.md')
            contents = contents.replaceAll('./website/assets/', './assets/');
        const outputPath = resolve(site, output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, contents);
    }
}
