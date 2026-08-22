# BeefAPI Image2 CLI

The installer exposes `beefapi-image2` when its user-local bin directory is on
`PATH`. A Codex agent should prefer the bundled script path so it also works
before the user opens a new terminal.

Size and model mapping live in `scripts/resolve-image-request.mjs`. Do not
re-implement that table in this file or in `SKILL.md`.

## Setup and health

```bash
beefapi-image2 setup
beefapi-image2 doctor
beefapi-image2 doctor --offline
```

Generate and edit first look for a Codex BeefAPI key
(`[model_providers.beefapi]` + `auth.json` `OPENAI_API_KEY`). `setup` is only
needed when Codex is not already on BeefAPI. It stores a dedicated override
outside the skill tree, validates `/v1/models` for `gpt-image-2`, and does not
create an image.
`--offline` verifies package, state, and credential permissions without a
network request. `doctor` warns when `gpt-image-2-firefly` is missing; 淘系
and 2K/4K jobs need that model.

## Generate

```bash
beefapi-image2 generate \
  --prompt "editorial product photo of a ceramic mug" \
  --out output/imagegen/mug.png

beefapi-image2 generate \
  --prompt "淘系主图，1440 方图，白底，logo 200px" \
  --out output/imagegen/taobao.png
```

Useful options:

- `--prompt-file <path>`: read a UTF-8 prompt from a file.
- `--model gpt-image-2|gpt-image-2-firefly`: override auto selection.
- `--size WxH|auto`: send this size upstream. `1440x1440` is mapped to a
  firefly native size plus a 1440 target, not sent to `gpt-image-2` as-is.
- `--target-size WxH`: final canvas after generation. Default for 淘系/1440
  is 1440-wide 1:1, 3:4, or 9:16.
- `--resolution 1k|2k|4k`.
- `--quality low|medium|high|auto`.
- `--background transparent|opaque|auto`.
- `--output-format png|jpeg|webp`.
- `--response-format b64_json|url`.
- `--no-resize`: keep native pixels even when a target size was inferred.
- `--force`: overwrite an existing output.
- `--dry-run`: print the resolved model/size/target without credentials or a
  paid request.

`--n` is accepted only as `--n 1`; larger values fail locally.

Auto selection:

- Default: `gpt-image-2` at `1024x1024`.
- 淘系 / 1440 / 1:1·3:4·9:16 at 1440-wide: `gpt-image-2-firefly` 2K native,
  then local resize to 1440 when `sips` or ImageMagick is available.
- 2K/4K or firefly-only ratios (16:9, 9:16, 3:4, 4:3, 3:2, 2:3, 5:4, 4:5,
  21:9): `gpt-image-2-firefly`.
- `--model` always wins.

## Edit

```bash
beefapi-image2 edit \
  --image input.png \
  --mask mask.png \
  --input-fidelity high \
  --prompt "remove only the object inside the mask" \
  --out output/imagegen/edited.png
```

Repeat `--image` for multiple references. Input files must be non-empty images
and no larger than 32 MiB each. Model/size selection matches generate.

## Remove

```bash
beefapi-image2 uninstall
beefapi-image2 uninstall --purge-credentials
```

Uninstall refuses to delete a locally modified managed skill unless
`--force` is provided. If the installer replaced a pre-existing directory only
after explicit confirmation, uninstall restores its recorded byte-identical
backup.
