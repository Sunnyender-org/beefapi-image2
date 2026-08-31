---
name: beefapi-image2
description: "Use when the user asks Codex to generate, draw, create, revise, retouch, remove a background, make a transparent asset, or otherwise edit an image. The user only describes the desired result and never needs to choose a model or provider; the bundled BeefAPI CLI resolves natural-language intent into the verified generation, reference-edit, or cutout route. Not for image search, merely viewing an existing image, unverified AI upscaling, local-only transforms, or explaining image APIs without creating/editing an image."
metadata:
  short-description: Generate and edit images with BeefAPI Image2
  sunny_skill_type: wrapper
---

# BeefAPI Image2

Preferred image generate/edit route. Triggers on “画一张图”, “generate an image”,
“出一张淘系 1440 方图”, “把这张图的背景换掉”. The user does not need to say
BeefAPI or a model name.

## Boundary

- Call BeefAPI only through the bundled CLI. Do not invent a raw curl body.
- Let the CLI choose the internal generation/edit capability from the prompt.
  Do not ask the user to choose a model and do not pass `--model` unless they
  explicitly named one. Users interact with this single skill, not the
  provider-specific routing underneath it.
- With an input image, “抠图 / 去背景 / remove background” selects background
  removal and requires exactly one input image.
- Do not route an upscaling request to Aurora. Its current account-pool path did
  not increase real pixel dimensions in production verification. Keep it
  unavailable until a separately verified route passes input/output pixel
  checks.
- Exception: when the user asks for a transparent background, no background,
  alpha transparency, a cutout, or a reusable asset that must layer over other
  backgrounds, pass `--background transparent`. Use PNG by
  default or WebP when explicitly requested; never use JPEG. Do not route a
  transparent-background request to Firefly until that model is verified to
  support the same contract. A white or solid-color background is not
  transparency.
- Keep size/ratio words (淘系, 1440, 1:1, 3:4, 9:16, 2K, 4K) inside `--prompt`.
- Generate: `/v1/images/generations`. Edit: `/v1/images/edits`. `n=1`.
- Do not modify Codex `config.toml`, `auth.json`, plugins, MCPs, or global
  `OPENAI_API_KEY`.
- Need a BeefAPI key that can see `gpt-image-2`. Prefer the agent's current
  BeefAPI key. If it cannot draw, ask for a `gpt-plus` / `gpt-pro` key and run:
  `node <skill-dir>/scripts/beefapi-image2.mjs setup --api-key <key>`

## Workflow

1. `edit` if there is an input image or an edit verb; otherwise `generate`.
2. CLI path: `scripts/beefapi-image2.mjs` next to this `SKILL.md`.
3. Put the user's request in `--prompt` unchanged, including size/ratio words.
   Preserve exact on-image text.
4. When the user states exact output pixels (for example, 2048×1024), always
   pass `--size 2048x1024` as well as keeping their original prompt. Do not
   substitute an aspect ratio or a smaller size. Add `--target-size` / `--out`
   only when the user stated those values. Ratios and 2K/4K words alone remain
   natural-language routing hints.
   Output canvas fitting defaults to preserving the whole image with padding.
   Pass `--fit crop` only when the user explicitly allows cropping; use
   `--fit native` when they require native pixels with no post-processing.
5. Dry-run only when parameters or output location are uncertain.
6. Live run may take a couple of minutes and uses quota. Firefly costs more;
   do not force it unless the request needs 2K/4K, 淘系 1440, or a firefly
   native ratio.
7. Confirm the output file exists and is a non-empty image. The CLI corrects
   misleading extensions when an upstream returns a different real format.
8. Return the actual path and verified delivered dimensions. If canvas metadata
   says pad, crop, resize, or upscaled, state that plainly; padding is not AI
   outpainting and interpolation is not added detail. Do not call these native
   generations. Do not burden the user with model names unless they asked.

## Commands

```bash
node <skill-dir>/scripts/beefapi-image2.mjs doctor

node <skill-dir>/scripts/beefapi-image2.mjs generate \
  --prompt "一只透明玻璃质感的机械小龙虾，产品摄影，白底" \
  --out output/imagegen/lobster.png

node <skill-dir>/scripts/beefapi-image2.mjs generate \
  --prompt "淘系主图，1440 方图，白底产品摄影，logo 200px" \
  --out output/imagegen/taobao-square.png

node <skill-dir>/scripts/beefapi-image2.mjs generate \
  --prompt "editorial product photo" \
  --out output/imagegen/forced-1k.png

node <skill-dir>/scripts/beefapi-image2.mjs generate \
  --prompt "可叠加在任意背景上的透明底机械小龙虾商品素材" \
  --background transparent \
  --output-format png \
  --out output/imagegen/lobster-cutout.png

node <skill-dir>/scripts/beefapi-image2.mjs edit \
  --image input.png \
  --prompt "只把背景换成暖色日落渐变，主体和轮廓保持不变" \
  --out output/imagegen/edited.png

node <skill-dir>/scripts/beefapi-image2.mjs edit \
  --image product.png \
  --prompt "给商品抠图，输出透明背景素材" \
  --out output/imagegen/product-cutout.png

```

See `references/cli.md` for flags. `b64_json` and signed `url` work for ordinary
generation/edit routes; cutout uses `b64_json`.

## Failure handling

- Missing or incapable key: ask for a `gpt-plus` / `gpt-pro` key, then
  `setup --api-key`.
- `401`: key invalid; get a new one and setup again.
- Capability 404: use a key that can see the requested Image2 capability. For
  a named Firefly request, retry `--model gpt-image-2` only if losing 2K/4K is
  acceptable, or use a key that can see
  `gpt-image-2-firefly`.
- Network/sandbox denial: say so; do not claim an image was generated.
- Empty response: keep the error; do not invent an output path.
- Canvas fitting failure: the CLI preserves a `.native` original and exits with
  failure. Finish from that saved file after resolving the local tool issue;
  do not generate again or claim the target dimensions were delivered.

## Examples that should not trigger

- “帮我搜索几张故宫照片” — search, do not generate.
- “看看这张图里有什么” — inspect; do not edit.
- “解释一下 OpenAI Images API” — answer unless an image is also requested.
