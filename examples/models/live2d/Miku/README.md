# Official Hatsune Miku sample

These files are the unmodified PRO runtime from Live2D's official
[Hatsune Miku sample](https://www.live2d.com/zh-CHS/learn/sample/hatsune-miku/), downloaded from the
official page's direct Japanese archive link on 2026-09-22. They are used in the free Live2D
integration example. These character terms are separate from the engine's code license and do not
grant commercial, advertising or promotional use.

Character and illustration: **Crypton Future Media, INC.** Modeling: **Live2D Inc.** These assets
are **not covered by Hilo3D's MIT license**.

The current [Live2D sample terms](https://www.live2d.com/en/learn/sample/model-terms/) classify Miku
as an **externally licensed character** and refer to Crypton's
[Piapro Character License](https://piapro.jp/license/pcl) and
[character guidelines](https://piapro.jp/license/character_guideline). Follow those current terms;
do not treat the archive's historical generic Live2D-original/commercial-use wording as commercial
permission. The original notice is retained byte-for-byte in
[ReadMe.upstream.txt](./ReadMe.upstream.txt). [LICENSE-URLS.json](./LICENSE-URLS.json) lists the
applicable official references.

Visible attribution for the demonstration:

> This demonstration depicts Hatsune Miku, a character of Crypton Future Media, INC., under the
> Piapro Character License. Live2D model by Live2D Inc.

## Runtime contents

- Manifest: `miku_sample_t04.model3.json`.
- One 2048×2048 texture atlas, moc3, physics3 and cdi3 metadata.
- Eight motions: `Idle` × 3, `Tap` × 2, `Flick` × 2 and `FlickUp` × 1.
- 59 parameters, including `ParamAngleX/Y/Z`, `ParamEyeBallX/Y`, `ParamEyeLOpen/ROpen`,
  `ParamMouthOpenY`, `ParamMouthForm`, `ParamBodyAngleX/Y/Z` and `ParamBreath`.
- No expression files, pose file, audio or named hit areas are supplied. Use whole-model bounds with
  `getModelBounds()` / `hitTest(x, y)`; do not invent a `Head` hit-area name.

The original model manifest and every runtime asset are unchanged. The alternative FREE model and
Editor project/artwork files were not imported. [PROVENANCE.json](./PROVENANCE.json) records the
archive SHA-256, exact original paths and per-file hashes. No audio was removed because the archive
contains none.

The examples build preserves these notices alongside the character's runtime assets. Reusing the
model or publishing another deployment requires compliance with the linked character terms.
