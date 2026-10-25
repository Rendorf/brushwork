# Brushwork

A free, offline painting app in the spirit of ibis Paint. It runs in the browser on iPad (Apple Pencil pressure), Android tablets and phones, and desktop. It can be installed to the home screen as an app. Everything is stored on the device. There are no accounts, no server and no paywall.

*Brushwork* is a working name.

## What works now (Phase 1: painting core)

- **GPU painting engine** (WebGL2):
  - Pressure-sensitive brushes, with a stabilizer (smooth or lazy rope) and fade-in/out.
  - Dab controls: spacing, hardness, angle, follow direction, scatter, size/flow/color jitter, paper grain and wet edges.
  - Build-up or marker-style strokes.
- **31 brush presets:** pens, pencils, airbrushes, watercolor, flat and oil brushes, smudge, blur, stamp brushes and erasers. Every setting can be tweaked and reset for each brush.
- **Layers:**
  - Organize: unlimited folders, drag to reorder.
  - Properties: opacity, 28 blend modes (incl. Add/Color Dodge "glow"), clipping, alpha lock, lock, reference layer, background paper color or transparency.
  - Actions: duplicate, merge down, flatten.
- **Tools:**
  - **Painting:** brush, eraser, smudge, blur.
  - **Bucket fill:** samples the canvas, the layer or the reference layer; tolerance, gap closing, expand, anti-alias.
  - **Lasso fill / lasso erase.**
  - **Selection:** rectangle, ellipse, lasso or magic wand, combined as new/add/subtract/intersect; then invert, expand, shrink, feather, crop.
  - **Transform:** move, scale, rotate, flip, fit.
  - **Eyedropper and hand.**
- **Edit and canvas operations:** copy/cut/paste as a new layer, fill and clear. Rotate or flip the canvas, canvas size, image size.
- **Color picker:** HSV wheel, HSB/RGB sliders, hex input, recent colors and palettes.
- **Undo/redo** for every operation, with a memory budget you can set.
- **Gestures:** two-finger pan, pinch and rotate; two-finger tap undoes and three-finger tap redoes; long-press picks a color; palm rejection once a pen is used. Desktop keyboard shortcuts are listed in Menu → Keyboard shortcuts.
- **Gallery:** canvas presets (Square, social, A4/B5/A5 at 350 dpi…), autosave, thumbnails, rename, duplicate, delete.
- **Import/export:**
  - PNG (with or without background), JPEG, layered PSD, and a lossless `.brushwork` project file.
  - Import images, PSD files or project files.
- **Installable PWA** that works fully offline.

## Phase 2: drawing aids

- **Rulers:** straight, circle, ellipse and radial rulers that strokes snap to. Strokes that start right next to a ruler land on it; otherwise they run parallel or concentric to it.
- **Perspective guides:** 1-, 2- and 3-point. A stroke picks the vanishing direction closest to how you start moving.
- **Symmetry:** mirror, kaleidoscope and rotation with 2–24 segments. Works with brush, eraser, smudge and blur.
- **Grid** with an adjustable size. Ruler and symmetry have quick on/off switches in the top bar, and all guides are saved with the artwork.
- **Shape tool:** line, rectangle, ellipse, polygon and star, drawn as an outline with the current brush, filled, or both.
- **Gradient tool:** linear, radial, conic and reflected. A gradient editor offers presets, color stops that can follow the current color, opacity and reverse.
- **Transform:** besides free transform, **Distort** (move four corners for true perspective) and **Mesh** (2×2 to 5×5 smooth warp). A selection moves with the pixels.
- **Reference window:** floating, movable and resizable. It shows your reference pictures (stored on the device) or a live view of the canvas, with pinch/scroll zoom and color picking.
- **Custom brushes:** make a brush from any image, duplicate and tweak brushes, rename/delete, choose any tip shape, export/import `.bwbrush` files, and import Photoshop `.abr` brushes.

## Phase 3: filters

44 GPU filters with live preview on the active layer. Every filter can be limited by a selection, faded with an effect-amount slider, respects alpha lock, and applies as one undo step. Your last settings for each filter are remembered, and recent filters are listed first. Open them from the tool grid, Menu → Filters, or the F key; Enter applies and Esc cancels.

- **Adjust:** brightness/contrast, hue/saturation/lightness (with colorize), color balance, levels, tone curve (per channel), gradient map, replace color, temperature/tint, invert, grayscale, sepia, posterize, threshold.
- **Blur:** gaussian, motion, radial (spin), zoom, lens (bokeh), sharpen.
- **Light & shadow:** glow (bloom), outer glow, drop shadow, outline, emboss, vignette.
- **Artistic:** extract line art (from photos or paintings), halftone (dots, lines or squares, mono or colored), mosaic, noise, chromatic aberration, painting (smoothing), anime-style background, frosted glass.
- **Distort:** wave, swirl, ripple, bulge/pinch. Filters with a center point let you tap the canvas to place it.
- **Generate:** clouds, stripes, polka dots, checkerboard, grid lines, and manga speed lines (focus and parallel).

## Phase 4: text and comics

- **Text layers** stay editable (tap a text with the Text tool, T):
  - Horizontal or vertical (tategaki) text. In vertical text, long-vowel marks and brackets are turned sideways, and small kana and punctuation are nudged into place.
  - Settings: font, size, color, bold/italic, alignment, letter and line spacing, outline and rotation.
  - Each editing session is one undo step. Rasterize a text layer to paint on it.
- **Fonts:**
  - 8 bundled open-license fonts, with Latin Extended (ə, ş, ğ…) and Cyrillic where available: Inter, Comic Neue, Bangers, Patrick Hand, Permanent Marker, Caveat, Pacifico, Merriweather.
  - Device fonts, including Japanese Gothic/Mincho stacks.
  - Import your own TTF/OTF/WOFF files.
- **Speech balloons (W):** speech, rounded, thought (cloud), shout (spiky) and narration boxes. Drag to draw; move it, drag the tail tip or resize before it is placed. Outline width and fill/line colors can be set, and text can be added inside automatically.
- **Frame divider (N):** create a frame layer, then drag across panels to cut them with an adjustable gap. Shift snaps the angle, and nearly straight cuts snap automatically. Tap a panel to select it and draw only inside. Border width and white or transparent gaps are adjustable.
- **Screentones:**
  - **Screentone layers:** turn on in layer properties. Gray paint is shown as dots, lines, cross-hatch or noise at a chosen LPI and angle. It is non-destructive: the layer keeps the gray paint.
  - **Flat screentone:** a fill filter (Filters → Generate).
- **Materials:** 16 seamless patterns drawn by the app, including Japanese seigaiha, asanoha and ichimatsu, plus bricks, honeycomb, scales, plaid, sakura and wood. Add your own pictures to "My materials". Tile any of them on a new layer or into a selection in any color and scale, or place a picture and transform it.
- **Comic & manga page templates:** B5 and A4 manga pages, 4-koma, US comic book, splash page and Webtoon. Each comes with print size, 3 mm bleed, trim and safe-area guides, and a starting panel layout.

## Run it

```bash
npm install
npm run dev
```

Open the printed URL. To try it on an iPad on the same Wi‑Fi, open the "Network" URL that Vite prints. Drawing works over plain http. Installing it as an app and using it offline need HTTPS, so host the `dist/` folder (see below).

```bash
npm run build      # production build in dist/
npm run preview    # serve the build locally
npm test           # unit tests (Vitest)
npm run test:e2e   # browser tests in Chromium and WebKit (Playwright)
```

Run `npx playwright install chromium webkit` once before the browser tests.

## Hosting for free

`dist/` is a static site. Any free static host works: GitHub Pages, Cloudflare Pages or Netlify. Once it's on HTTPS, open the site in Safari on iPad and tap Share → Add to Home Screen to install it.

## Project layout

```
src/engine/         painting engine (no React)
  gl/               WebGL2 helpers (programs, surfaces)
  shaders/          GLSL: blend modes, compositing, brush dabs, view
  brush/            stroke math, stabilizer, presets, procedural tips/grains, GPU brush
  tools/            brush, fill, lasso, selection, transform, eyedropper, hand
  compositor.ts     tiled layer-tree compositing with clipping and folders
  history.ts        tile-based pixel undo + command undo
  editor.ts         the engine facade used by the UI
  input.ts          pointer, pen, touch gestures and wheel
  io/               PSD/PNG/JPEG export, project files
src/storage/        IndexedDB gallery and autosave
src/store/          persisted settings (zustand)
src/ui/             React interface
```

## Roadmap

- **Phase 5, time-lapse and extras:** record and export painting videos, and frame animation with onion skin.

ibis Paint's name and its own brush, material and font libraries are not used. Brushwork ships its own presets, generated textures and open-license assets.
