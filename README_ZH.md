# Hilo3d

[English](./README.md) | 简体中文

一个 TypeScript-first 的 WebGL 3D 渲染引擎，支持基于物理的渲染与 glTF。

[![npm](https://img.shields.io/npm/v/hilo3d.svg?style=flat-square)](https://www.npmjs.com/package/hilo3d)
[![CI](https://img.shields.io/github/actions/workflow/status/hiloteam/Hilo3d/npm_test.yml?style=flat-square)](https://github.com/hiloteam/Hilo3d/actions/workflows/npm_test.yml)
[![license](https://img.shields.io/npm/l/hilo3d.svg?style=flat-square)](./LICENSE)

## 安装

```sh
npm install hilo3d
```

Hilo3d 2.x 以 ESM 作为包的主入口：

```ts
import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    Mesh,
    PBRMaterial,
    PerspectiveCamera,
    Stage,
    Ticker,
    Vector3
} from 'hilo3d';

const camera = new PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    z: 4
});

const stage = new Stage({
    container: document.querySelector('#app')!,
    camera,
    width: innerWidth,
    height: innerHeight
});

const mesh = new Mesh({
    geometry: new BoxGeometry(),
    material: new PBRMaterial({
        baseColor: new Color(0.832, 0.119, 0.093)
    })
}).addTo(stage);

mesh.onUpdate = () => {
    mesh.rotationX += 1;
    mesh.rotationY += 1;
};

stage.addChild(new AmbientLight({ amount: 0.5 })).addChild(
    new DirectionalLight({
        amount: 5,
        direction: new Vector3(-1.3, -0.8, 0)
    })
);

const ticker = new Ticker(60);
ticker.addTick(stage);
ticker.start();
```

不使用打包工具时，可直接加载自包含的 UMD 产物；它会暴露 `globalThis.Hilo3d`：

```html
<script src="https://cdn.jsdelivr.net/npm/hilo3d@2/dist/Hilo3d.umd.cjs"></script>
```

包根路径只提供 ESM。`hilo3d/umd` 兼容子路径在 `import` 时解析到现代 ESM 产物，在 `require`
时解析到自包含 UMD 产物；浏览器直接使用上面的 UMD 文件。

## 文档与示例

- [API 文档](https://hilo3d.js.org/docs/)
- [完整示例库](https://hilo3d.js.org/examples/list.html)
- [glTF Viewer](https://hilo3d.js.org/examples/glTFViewer/index.html)
- [工程现代化改造记录](./ENGINEERING_MODERNIZATION.md)
- [变更记录](./CHANGELOG.md)

API 页面由 TypeDoc 直接从已检查的 TypeScript 源码生成。仓库中的
[`etc/hilo3d.api.md`](./etc/hilo3d.api.md) 固化公共声明面，供代码审查比较。

## 开发

开发环境要求 Node.js 22.22.2 或更高版本以及 npm 12.0.1；版本分别记录在 `.node-version` 和
`package.json` 中。

```sh
npm install --global npm@12.0.1
npm ci
npx playwright install chromium
npm run validate
```

常用命令：

- `npm run dev` 启动库开发环境。
- `npm run examples:dev` 启动完整示例库。
- `npm run typecheck`、`npm run lint` 和 `npm run format:check` 执行静态门禁。
- `npm run test:coverage` 在浏览器中运行单元测试，并检查完整源码范围的覆盖率。
- `npm run test:ui` 加载每个示例，并拒绝页面、控制台、请求和 WebGL 错误。
- `npm run test:visual` 比较确定性的渲染截图。
- `npm run docs:build` 生成 API 文档；`npm run site:build` 组装发布站点。
- `npm run test:package` 校验构建后和打包后的 npm 契约。
- `npm run validate` 执行 CI 与发布前共用的完整门禁。

ESM 产物以 ES2022 为目标，并将运行时依赖保持为 external；UMD 产物则自包含，供浏览器直接加载。类型声明和 source
map 均从 `src/` 生成。真实 tarball 会经过 publint、Are the Types
Wrong、Bundler 与 NodeNext 消费项目、ESM 运行时加载和 UMD 浏览器全局校验。

TypeScript、API、测试和评审规则见[贡献指南](./.github/CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)
