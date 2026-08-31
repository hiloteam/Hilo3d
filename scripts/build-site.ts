import { access, cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const siteDirectory = resolve(projectRoot, 'site');

await rm(siteDirectory, { force: true, recursive: true });
await cp(resolve(projectRoot, 'website'), siteDirectory, { recursive: true });
await cp(resolve(projectRoot, 'docs'), resolve(siteDirectory, 'docs'), { recursive: true });
await cp(resolve(projectRoot, 'dist-examples/examples'), resolve(siteDirectory, 'examples'), {
    recursive: true
});
await cp(resolve(projectRoot, 'dist-examples/assets'), resolve(siteDirectory, 'assets'), {
    recursive: true
});
await cp(resolve(projectRoot, 'CNAME'), resolve(siteDirectory, 'CNAME'));

await Promise.all([
    access(resolve(siteDirectory, 'docs/index.html')),
    access(resolve(siteDirectory, 'examples/index.html')),
    access(resolve(siteDirectory, 'assets')),
    access(resolve(siteDirectory, 'CNAME')),
    access(resolve(siteDirectory, 'index.html')),
    access(resolve(siteDirectory, 'styles.css')),
    access(resolve(siteDirectory, 'og.png')),
    access(resolve(siteDirectory, 'assets/hero-renderer.png')),
    access(resolve(siteDirectory, 'assets/hilo3d-logo.png')),
    access(resolve(siteDirectory, 'assets/showcase-taobao-life.mp4')),
    access(resolve(siteDirectory, 'assets/showcase-duidui.mp4')),
    access(resolve(siteDirectory, 'assets/showcase-tiantian-planet.mp4'))
]);
