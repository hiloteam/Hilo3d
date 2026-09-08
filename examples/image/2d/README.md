# 2D Studio art

`luminous-garden.png` was generated with the built-in ImageGen tool for the 2D Studio examples. The
original output is copied into this directory without bitmap edits. It is used as an engine Sprite
background and as a postcard illustration, not as a UI screenshot.

`astral-guild-ui.png` and `rose-reliquary-ui.png` are additional built-in ImageGen outputs. Both
selected PNGs contain real alpha; they are copied without bitmap edits. `ornateUi2d.ts` records each
state frame's measured bounds. Nine-slice source insets are 154 px left/right and 140 px top/bottom,
displayed at 1/7 scale for buttons and 2/7 for panels. Large panels sample uniform edge strips and a
flat center while retaining the complete generated corners. The full-frame button skins remain
intact.

The existing moon-moth, star-seeds, and sorting-town assets are reused. Other paper panels use the
Canvas vector atlas in `studio2d.ts`. The batch example uses the purpose-built transparent
light-mote atlas in `stardustAtlas.ts` (256 × 256, 16 frames), with glow, points, four-point stars,
oval lights, and filaments.

Color artwork uses `SRGB8_ALPHA8` storage and straight-alpha blending. Canvas-backed Text2D labels
also select sRGB storage before their first upload. These choices preserve authored colors when the
shared renderer composites into its linear target.

## Astral Guild prompt

```text
Use case: stylized-concept
Asset type: production NINE-SLICE game UI sprite atlas, exactly four rectangular button/panel skins in a precise 2-column 2-row grid, landscape 1536x1024 canvas.
Primary request: An exquisite stylized fantasy game interface skin called ASTRAL GUILD. Deep petrol emerald enameled inset surfaces, raised antique champagne-gold double borders, beautifully sculpted small botanical filigree and faceted jade corner fittings. Rich hand-painted 2D game UI craftsmanship, sharp silhouettes, tactile metal highlights and tiny engraved details. Premium art nouveau magical observatory UI, aesthetically sophisticated, NOT generic web rounded rectangles.
LAYOUT REQUIREMENT: Canvas 1536x1024 with four identical 700x400 frames. Each quadrant 768x512 contains exactly ONE horizontally rectangular frame centered at (384,256), (1152,256), (384,768), (1152,768). Each frame aligned identically with equal dimensions, no rotation, strictly straight-on orthographic 2D. Genuine transparent background outside each frame, including rounded/cut corner cutouts. No backdrop or shadow behind the objects.
STATE GRID: top-left normal (deep emerald interior, champagne brass trim); top-right hovered (brighter jade interior, luminous rich gold trim); bottom-left pressed (darkest teal inset interior, darker burnished brass rim); bottom-right disabled (desaturated blue-gray interior, aged pewter trim). All four share EXACTLY the same silhouette, layout, geometric proportions and corner shapes.
NINE SLICE REQUIREMENTS CRITICAL: all ornate leaf scrolls, jade gems and other decorative ornaments must be completely confined to the four 80x80 CORNER REGIONS of each 700x400 skin. The four long edge strips between corners must be dead straight and uniform: uninterrupted parallel border lines of constant thickness, NO decorations at edge midpoints, NO middle clasp, NO centered badges. Interior is an even, low-contrast dark enamel plane, very subtle texture only. It will stretch arbitrarily wide or tall so it must NOT have any center emblem, radial lighting, vignette, text, illustration, or changing edge thickness. Corners can have a gently stepped/chamfered silhouette and delicate plant-gold curls, but do not cross the 80px inset lines. Make the design look ornamental and game-like through CORNERS and sophisticated materials, while keeping it mathematically suitable for nine-slicing.
Constraints: transparent background, no text, no letters, no logos, no watermarks, no grid lines, no labels, no scene, no UI mockup, four actual isolated reusable assets.
```

## Rose Reliquary prompt

```text
Use case: stylized-concept. Asset type: actual game UI sprite atlas with a GENUINELY TRANSPARENT alpha background. Generate a new 1536x1024 image with four isolated ornate rectangular interface skins in a 2x2 grid. No checkerboard image, no backdrop, no shadows outside the skins.
Style: ROSE RELIQUARY, an exquisite magical atelier skin. Deep purple / burgundy enamel, copper-rose-gold double trim, sculpted metallic rose petals and oval ruby cabochons confined entirely to the four corners. Premium hand-painted fantasy game UI craftsmanship, polished ornamental metal, refined elegant strong silhouettes.
Each frame approximately 700x350, centered in its 768x512 quadrant. EXACTLY four equally sized aligned horizontal rectangles. No rotation, strict flat orthographic front view. State order: top-left normal deep plum with rose gold; top-right hovered brighter ruby velvet with luminous copper; bottom-left pressed dark aubergine with burnished rose gold; bottom-right disabled slate-lavender with gray pewter. All four frames have matching geometry and corner shapes.
Critical nine-slice design: all corner ornaments fit inside the first/last 140 pixels horizontally and vertically of each skin. Continuous straight uniform-thickness double-line border strips between these corners. NO centered decorations, NO clasps or center badges on edges. Interior is an even low-contrast dark velvet-enamel plane, no center emblem or vignette. Corner silhouette may be gently stepped but no protruding parts outside the rectangular bounds.
Text: none. No lettering, symbols, grid lines, watermark, UI mockup, scene or backdrop. Deliver four usable transparent sprites.
```

## Yui Hirasawa walk-cycle prompt

`sorting-town-yui.png` is the requested Yui Hirasawa character replacement. The selected 1254 × 1254
PNG has real alpha and sixteen direction/walk frames. Runtime frame anchors use measured per-frame
sole positions, including fractional grid origins, to keep the character's ground contact stable
without modifying the source image.

```text
Use case: illustration-story
Asset type: production pixel-art character WALK-CYCLE SPRITE SHEET for a top-down 2D game. Exactly 4 columns x 4 rows on a 1024x1024 canvas, sixteen 256x256 equal cells, genuinely transparent alpha outside the characters. No painted background, no checkerboard, no floor plane, no separate shadow, no text.
Subject: Yui Hirasawa from K-On!, recognizable charming chibi pixel-art interpretation. Chestnut-brown shoulder-length bob with bangs and her signature yellow hair clips, warm brown eyes, cheerful relaxed expression. Japanese school uniform: white short-sleeved blouse, red ribbon at the collar, navy pleated skirt, dark socks and brown loafers. No hat, no bag, no guitar or other props obscuring the silhouette.
Style: exceptional hand-placed-looking crisp pixel art matching a cozy 16-bit top-down RPG village, readable bold silhouette, tasteful clusters of pixels, warm detailed hair highlights and restrained soft palette shading. Not blurry, not vector, not photorealistic, no anti-aliased painted edges.
Layout absolutely critical: each cell contains the SAME full-body character, SAME scale, SAME floor anchor, both feet fully inside the cell, every character centered on cell X=128, ground line at local Y=232, head top around local Y=30. Keep at least 20 px transparent gutter around every cell, no character crosses a cell boundary. No variation in height or body proportions between frames.
Direction rows EXACTLY: ROW 1 faces DOWN toward viewer; ROW 2 faces LEFT in profile; ROW 3 faces RIGHT in profile; ROW 4 faces UP showing the back of the head. Each row has four successive WALK poses: left foot forward, passing/neutral, right foot forward, passing/neutral. Feet alternate convincingly; arms swing opposite the legs, skirt and hair move subtly. Up-facing row must really show the back with no face. Left and right rows must be consistent views of the same character. Clear separation and aligned baselines.
Deliver a single finished usable 4x4 game sprite atlas. Real transparent background.
```

## ImageGen prompt

```text
Use case: stylized-concept
Asset type: production background painting for an interactive 2D engine showcase named "The Luminous Garden".
Primary request: Create a polished, breathtaking hand-painted environment plate, landscape 16:9, approximately 2048x1152. A hidden botanical observatory suspended above a sea of mist at blue hour. An enormous circular antique brass astronomical arch frames a luminous pale apricot moon in the upper center, fine engraved concentric celestial rings, flowering midnight-blue magnolia and jade fern foliage frame the lower corners and the outer edges. Tiny amber lanterns among the leaves, elegant teal stone stairs lead to an EMPTY broad smooth dark teal reflecting pool/platform in the lower center. Clouds part into apricot sunset at the distant horizon. Refined storybook art direction, soft painterly texture, Art Nouveau botanical detail, exceptional nuanced lighting and depth, dark petrol/teal shadows, misty jade middle distance and warm champagne highlights.
Composition: decorative detail concentrated at outer 20 percent edges, main center has generous uncluttered atmospheric negative space for a separate animated moth sprite, no characters or insects in the painting. Symmetric overall architectural balance but naturally asymmetric plants, no busy details in central area. Beautiful strong silhouettes, art-directed premium indie game environment. Keep the pool surface mostly flat, no central statue.
Constraints: no text, no letters, no typography, no logos, no watermark, no UI, no interface screenshot, no checkerboard. Deliver one finished background artwork.
```
