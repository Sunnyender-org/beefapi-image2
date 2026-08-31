# BeefAPI Image2 CLI

The installer exposes `beefapi-image2` when its user-local bin directory is on
`PATH`. A Codex agent should prefer the bundled script path so it also works
before the user opens a new terminal.

Size and model mapping live in `scripts/resolve-image-request.mjs`. Do not
re-implement that table in this file or in `SKILL.md`.

## Setup and health

```bash
beefapi-image2 setup --api-key <key>
beefapi-image2 doctor
beefapi-image2 doctor --offline
```

Need a BeefAPI key that can see `gpt-image-2`. Generate/edit reuse a Codex
BeefAPI key (`[model_providers.beefapi]` + `auth.json`) when it can. If it
cannot, run `setup --api-key` with a `gpt-plus` / `gpt-pro` key. Setup stores
a dedicated override, checks `/v1/models`, and does not create an image.
`--offline` verifies package, state, and credential permissions without a
network request. `doctor` reports the optional high-resolution, Nano, and
cutout capabilities visible to the token.

## Natural-language capability selection

The user should invoke one `beefapi-image2` skill and describe the desired
result. Do not ask them to choose a model. With `edit --image`:

- 抠图 / 去背景 / remove background → transparent background removal.

The CLI uses the real internal capability IDs so BeefAPI routing, upstream
credits, and billing remain accurate. Those IDs are an advanced implementation
detail, not a user decision.

## Generate

```bash
beefapi-image2 generate \
  --prompt "editorial product photo of a ceramic mug" \
  --out output/imagegen/mug.png

beefapi-image2 generate \
  --prompt "淘系主图，1440 方图，白底，logo 200px" \
  --out output/imagegen/taobao.png

beefapi-image2 generate \
  --prompt "transparent product cutout" \
  --background transparent \
  --output-format png \
  --out output/imagegen/product-cutout.png
```

Useful options:

- `--prompt-file <path>`: read a UTF-8 prompt from a file.
- `--model`: advanced override. Accepted values are `gpt-image-2`,
  `gpt-image-2-firefly`, `nano-banana-2`, `nano-banana-pro`, and `remove-bg`.
- `--size WxH|auto`: an explicit pixel canvas selects `gpt-image-2` unless
  another model was named. The Leonardo channel uses native dimensions when
  supported; otherwise it fits a suitable native generation to the requested
  canvas. Requires the channel-side canvas update. Arbitrary output dimensions
  do not imply arbitrary native generation support.
  Canvas limits: 8192 per edge, 16,777,216 total pixels.
- `--target-size WxH`: final canvas after generation. Default for 淘系/1440
  is 1440-wide 1:1, 3:4, or 9:16.
- `--resolution 1k|2k|4k`.
- `--quality low|medium|high|auto`.
- `--background transparent|opaque|auto`.
- `--output-format png|jpeg|webp`.
- `--response-format b64_json|url`.
- `--no-resize`: keep native pixels even when a target size was inferred.
- `--fit pad|crop|native`: default `pad` keeps all content and adds centered
  white padding (transparent for alpha images). `crop` explicitly permits
  centered cropping. Both scale uniformly. `native` forbids fitting and errors
  on unsupported native dimensions. Upscaling is disclosed, not presented as
  increased image detail.
- `--force`: overwrite an existing output.
- `--dry-run`: print the resolved model/size/target without credentials or a
  paid request.

`--n` is accepted only as `--n 1`; larger values fail locally.
Transparent output is a `gpt-image-2` preview capability: use PNG (default) or
WebP, never JPEG. The Skill fixes transparent-background requests to
`gpt-image-2`; do not rely on Firefly for that contract.

Auto selection:

- Default: `gpt-image-2` at `1024x1024`.
- 淘系 / 1440 / 1:1·3:4·9:16 at 1440-wide: `gpt-image-2-firefly` 2K native,
  then local fitting when `sips` or ImageMagick is available. An explicit
  `--size 1440x1440` instead uses the `gpt-image-2` server-side canvas route.

Generate/edit pass fitting preferences in `extra_fields.image_canvas.fit` on
the GPT route. Responses can include `metadata.image_canvas`: source_size,
delivered_size, operation, fit, padding and upscaled. The CLI prints this
metadata and checks actual image headers before reporting an exact canvas.
Other channels may reject unsupported sizes; there is no blind regeneration
retry. If local fitting fails after generation, the original is saved as
`.native.*`, the CLI exits nonzero, and no second paid generation is sent.
- 2K/4K or firefly-only ratios (16:9, 9:16, 3:4, 4:3, 3:2, 2:3, 5:4, 4:5,
  21:9): `gpt-image-2-firefly`. A 2K/4K request without a ratio defaults to
  `1:1`.
- `--model` always wins.

Nano Banana 2/Pro use their Leonardo-native 1K/2K/4K pixel tables when the
user explicitly asks for either Nano capability. Ordinary 2K/4K intent keeps
the existing Firefly route.

## Edit

```bash
beefapi-image2 edit \
  --image input.png \
  --mask mask.png \
  --input-fidelity high \
  --prompt "remove only the object inside the mask" \
  --out output/imagegen/edited.png
```

Repeat `--image` for multiple references. GPT Image2/Nano edits accept up to
six PNG/JPEG/WebP references, at most 30 MiB each and 180 MiB combined. Model
and size selection matches generate. Leonardo cutout and the current
Leonardo Image2 route reject masks.

### Background removal

Background removal requires exactly one input image. Natural-language intent
is enough; advanced controls are:

- `--size auto|preview|full|50mp`
- `--channels rgba|alpha`
- `--foreground-type auto|person|product|car|animal|graphic|transportation|other`
- `--crop true|false`, `--semitransparency true|false`
- `--shadow-opacity 0..100`, `--shadow-type none|drop|3d|car`
- `--type-level none|1|2|latest`
- `--bg-color`, `--crop-margin`, `--position`, `--roi`, `--scale`

The Leonardo cutout route supports `b64_json`; do not request `url`.

## Actual output format

Some upstreams may return JPEG bytes even when the request asked for PNG. The
CLI checks the image signature before writing. If the bytes do not match the
requested extension, it writes the correct `.jpg`, `.png`, `.webp`, or `.gif`
path and reports that actual path instead of creating a misleading file.

## Remove

```bash
beefapi-image2 uninstall
beefapi-image2 uninstall --purge-credentials
```

Uninstall refuses to delete a locally modified managed skill unless
`--force` is provided. If the installer replaced a pre-existing directory only
after explicit confirmation, uninstall restores its recorded byte-identical
backup.
