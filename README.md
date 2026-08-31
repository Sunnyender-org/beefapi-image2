# BeefAPI Image2

One natural-language skill for BeefAPI image generation and editing. The user
describes the desired result; they do not need to choose a model or provider.

## Verified capabilities

- Generate images and edit one or more reference images.
- Remove a background from one input image and return a real transparent asset.
- Understand 淘系 / 1440 / 1:1 / 3:4 / 9:16 / 2K / 4K size intent.
- Preserve explicit `1536x1024`, `1024x1536`, `1536x1536`, and `2048x1024`
  requests on `gpt-image-2` without local resizing (requires the corresponding
  channel-side dimension update).
- Deliver other requested pixel canvases through the updated Leonardo channel:
  use a supported generation, then fit with padding or explicitly requested
  cropping. No stretching; post-processing and any upscaling are disclosed.
- Stream up to six reference images instead of loading the whole multipart body
  into memory: 30 MiB per image, 180 MiB combined.
- Inspect returned image bytes and write the correct `.png`, `.jpg`, `.webp`,
  or `.gif` extension when an upstream format differs from the request.

Transparent generation uses PNG or WebP. A plain `2K` or `4K` request without
an aspect ratio defaults to a square high-resolution canvas.

AI upscaling is intentionally not exposed: the current Aurora account-pool path
completed and consumed credits but did not increase real pixel dimensions.
Canvas mask/inpaint also remains unavailable until separately verified.

## Install

Node 18+. Clone into the Codex skills directory, then set up the key:

```bash
git clone https://github.com/Sunnyender-org/beefapi-image2.git ~/.codex/skills/beefapi-image2
```

If the agent's BeefAPI key can already see `gpt-image-2` (usually a
`gpt-plus` / `gpt-pro` token), no extra setup is required.

Otherwise give the agent a gpt-group token:

```bash
node ~/.codex/skills/beefapi-image2/scripts/beefapi-image2.mjs setup --api-key sk-...
```

Update with `git -C ~/.codex/skills/beefapi-image2 pull`.

Optional one-file installer (same skill, plus a `beefapi-image2` command):

```bash
curl -fsSLO https://raw.githubusercontent.com/Sunnyender-org/beefapi-image2/main/install/beefapi-codex-image2.sh
bash beefapi-codex-image2.sh
```

## Use

```bash
node ~/.codex/skills/beefapi-image2/scripts/beefapi-image2.mjs generate \
  --prompt "淘系主图，1440 方图，白底产品摄影" \
  --out taobao-square.png

node ~/.codex/skills/beefapi-image2/scripts/beefapi-image2.mjs generate \
  --prompt "透明底商品素材" \
  --background transparent \
  --output-format png \
  --out product-cutout.png

node ~/.codex/skills/beefapi-image2/scripts/beefapi-image2.mjs edit \
  --image product.png \
  --prompt "给商品抠图并输出透明素材" \
  --out product-cutout.png

```

Or, after the installer: `beefapi-image2 generate --prompt "..."`.

Default 1K square stays on Image2. 淘系 / 1440 / 2K / 4K select the verified
high-resolution route. Background removal is selected from edit intent.
Advanced CLI controls are documented in `references/cli.md`; ordinary users
should continue to describe the result in natural language.

Legacy credentials that still reference the retired `api.beefapi.com` host are
automatically migrated in memory to `https://beefapi.com/v1`. `doctor` reports
the effective API base URL without printing the API key, and network failures
identify the failed host and underlying DNS or connection cause.

## Test

```bash
node --test --test-concurrency=1 tests/*.test.mjs
```

## License

AGPL-3.0-or-later. Keep existing copyright notices.
