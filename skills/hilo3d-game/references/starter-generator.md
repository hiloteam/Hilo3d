# Starter generator

Use `scripts/create-hilo3d-game.mjs` to create a standalone strict TypeScript and Vite project. The
generated project queries published Hilo3D versions, prefers exact `2.0.0`, and otherwise uses the
highest exact `2.0.0-alpha.N`. It does not read from a Hilo3D repository checkout.

## Commands

```sh
node <skill-root>/scripts/create-hilo3d-game.mjs \
  --type 3d \
  --name crystal-runner \
  --output ./crystal-runner
```

Options:

| Option           | Required | Values                                              |
| ---------------- | -------- | --------------------------------------------------- |
| `--type`         | Yes      | `2d`, `3d`, or `hybrid`                             |
| `--name`         | Yes      | npm-compatible project name                         |
| `--output`       | Yes      | New or empty destination directory                  |
| `--hilo-version` | No       | `auto` (default), `2.0.0`, or exact `2.0.0-alpha.N` |
| `--registry`     | No       | Registry URL for automatic version lookup           |

In `auto` mode, the generator queries `https://registry.npmjs.org/`. It uses stable `2.0.0` as soon
as that version exists; before then it selects the numbered alpha with the highest numeric suffix.
It deliberately ignores 1.x, beta, and release-candidate versions. Use `--registry` for a compatible
private or mirrored registry, or `--hilo-version` to skip lookup and pin an exact known release.

The generator copies the shared starter files, selects one variant as `src/main.ts`, and omits the
unused variant sources. It refuses a non-empty destination so it cannot silently overwrite user
work. It also warns when invoked with Node.js older than 20.19.0; upgrade Node before installing
dependencies or running the generated game. Startup failures replace the loading status with a
visible error while preserving the full exception in the developer console.

After generation:

```sh
cd <output>
npm install
npm run dev
```

Useful scripts:

```sh
npm run typecheck
npm run build
npm run preview
```

## Adaptation rules

- Preserve the generated exact version until compatibility with another Hilo3D release is verified.
- Keep `src/main.ts` small while prototyping. When features become independently testable, split
  authoritative rules into `game/`, Hilo3D presentation into `hilo/`, and dense or accessible web
  surfaces into `ui/`; follow [Game architecture](game-architecture.md) for the concrete layout.
- Centralize application-owned asset URLs and semantic keys in a manifest instead of embedding paths
  across systems and views.
- Replace generated Canvas textures with local assets using `TextureLoader`, `BasicLoader`, or
  `GLTFLoader`.
- Keep URL construction relative to modules:

```ts
const url = new URL('./assets/player.png', import.meta.url).href;
```

- Do not use remote CDN imports or global `Hilo3d` variables.
- Keep one owner for the ticker, resize listener, input listeners, and Stage teardown.
