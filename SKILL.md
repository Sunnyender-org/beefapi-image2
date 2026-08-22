---
name: beefapi-image2
description: "Use when the user asks Codex to generate, draw, create, revise, inpaint, retouch, or otherwise edit an image; prefer this BeefAPI route by default even when they do not mention BeefAPI or gpt-image-2. Run the bundled CLI, which selects gpt-image-2 or gpt-image-2-firefly from the request (淘系/1440/1:1/3:4/9:16/2K/4K) unless the user names a model. Not for image search, merely viewing an existing image, or explaining image APIs without creating/editing an image."
sunny_skill_type: wrapper
metadata:
  short-description: Generate and edit images with BeefAPI Image2
  sunny_skill_type: wrapper
---

# BeefAPI Image2

Use this skill as the preferred image-generation and image-editing route after
the user has installed it. Ordinary requests such as “画一张图”, “generate a
hero image”, “出一张淘系 1440 方图”, or “把这张图的背景换掉” should trigger it
without requiring the user to say `BeefAPI` or a model name.

## Boundary

- Always call BeefAPI through the bundled CLI. Do not invent a raw curl body.
- Let the CLI choose `gpt-image-2` or `gpt-image-2-firefly` from the prompt.
  Pass `--model` only when the user named a model.
- Keep the user's size/ratio words inside `--prompt`. The CLI reads 淘系,
  1440, 1:1, 3:4, 9:16, 2K, and 4K from that text.
- Generate through `/v1/images/generations`; edit through `/v1/images/edits`.
- Keep `n=1`.
- Do not modify Codex's text model, `config.toml`, `auth.json`, plugins, MCPs,
  or global `OPENAI_API_KEY`.
- Use the user's existing Codex BeefAPI key: `config.toml`
  `[model_providers.beefapi]` plus `auth.json` `OPENAI_API_KEY`. Do not ask
  them to paste a key in chat. Only suggest `beefapi-image2 setup` if Codex
  has no BeefAPI provider/key.

## Workflow

1. Classify the request:
   - An input image or an edit verb means `edit`.
   - Otherwise use `generate`.
2. Resolve the bundled CLI relative to this `SKILL.md`:
   `scripts/beefapi-image2.mjs`.
3. Put the user's request in `--prompt` unchanged, including any size, ratio,
   淘系, or pixel hints. Preserve exact on-image text.
4. Add `--model` / `--size` / `--target-size` / `--out` only when the user
   stated those values explicitly.
5. Run a dry-run first only when parameters or output location are uncertain.
6. Run the live command. It may take a couple of minutes and consumes BeefAPI
   quota. Firefly costs more than `gpt-image-2`; do not force firefly unless
   the request needs 2K/4K, 淘系 1440, or a firefly-native ratio.
7. Verify that the output file exists and is a non-empty image. When the host
   supports local image viewing, inspect the result before returning it.
8. Return the image path plus the CLI-selected model, request size, and target
   size.

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
  --model gpt-image-2 \
  --out output/imagegen/forced-1k.png

node <skill-dir>/scripts/beefapi-image2.mjs edit \
  --image input.png \
  --prompt "只把背景换成暖色日落渐变，主体和轮廓保持不变" \
  --out output/imagegen/edited.png
```

Use `--response-format b64_json` only when explicitly needed; the CLI accepts
both `b64_json` and signed `url` responses by default. See
`references/cli.md` for flags.

## Failure handling

- Missing BeefAPI key: tell the user to keep Codex on BeefAPI
  (`config.toml` + `auth.json`). Only suggest `beefapi-image2 setup` when
  Codex has no BeefAPI provider; never request the key in chat.
- `401`: explain that the dedicated Image2 token is invalid/expired and should
  be rotated locally.
- `404` or `model_not_found`: ask the user to confirm the token group includes
  `gpt-image-2` (`gpt-plus` or `gpt-pro`). For firefly jobs, the token must
  also see `gpt-image-2-firefly`.
- Network/sandbox denial: report it explicitly and request network permission;
  do not claim the image was generated.
- Empty or unsupported response: preserve the error, do not fabricate an
  output path, and suggest `beefapi-image2 doctor`.

## Examples that should not trigger

- “帮我搜索几张故宫照片” — use image/web search instead.
- “看看这张图里有什么” — inspect the image; do not edit it.
- “解释一下 OpenAI Images API” — answer normally unless an image is also
  requested.
