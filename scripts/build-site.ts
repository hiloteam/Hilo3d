import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const siteDirectory = resolve(projectRoot, 'site');

await rm(siteDirectory, { force: true, recursive: true });
await mkdir(siteDirectory, { recursive: true });
await cp(resolve(projectRoot, 'docs'), resolve(siteDirectory, 'docs'), { recursive: true });
await cp(resolve(projectRoot, 'dist-examples/examples'), resolve(siteDirectory, 'examples'), {
    recursive: true
});
await cp(resolve(projectRoot, 'dist-examples/assets'), resolve(siteDirectory, 'assets'), {
    recursive: true
});
await cp(resolve(projectRoot, 'CNAME'), resolve(siteDirectory, 'CNAME'));

await writeFile(
    resolve(siteDirectory, 'index.html'),
    [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '    <meta charset="utf-8">',
        '    <meta name="viewport" content="width=device-width, initial-scale=1">',
        '    <meta http-equiv="refresh" content="0; url=./docs/">',
        '    <title>Hilo3d</title>',
        '</head>',
        '<body><a href="./docs/">Open the Hilo3d API documentation</a></body>',
        '</html>',
        ''
    ].join('\n'),
    'utf8'
);

await Promise.all([
    access(resolve(siteDirectory, 'docs/index.html')),
    access(resolve(siteDirectory, 'examples/list.html')),
    access(resolve(siteDirectory, 'assets')),
    access(resolve(siteDirectory, 'CNAME'))
]);
