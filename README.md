# BeefAPI Image2

Codex / Claude Code skill for BeefAPI image generation.

Speak in natural language. The CLI picks `gpt-image-2` or
`gpt-image-2-firefly`, maps 淘系 / 1440 / 1:1 / 3:4 / 9:16 onto native
pixels, and can resize to 1440. You still need a BeefAPI API key.

## Install

Node 18+. Clone into the Codex skills directory, then set up the key:

```bash
git clone https://github.com/Sunnyender-org/beefapi-image2.git ~/.codex/skills/beefapi-image2
```

If the agent's BeefAPI key can already see `gpt-image-2` (usually a
`gpt-plus` / `gpt-pro` token), no extra setup is required.

If that key is Claude / Kimi / Grok and cannot draw, create a gpt-group
token in BeefAPI and run:

```bash
node ~/.codex/skills/beefapi-image2/scripts/beefapi-image2.mjs setup
```

Do not paste the key into chat.

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
```

Or, after the installer: `beefapi-image2 generate --prompt "..."`.

Default 1K square stays on `gpt-image-2`. 淘系 / 1440 / 2K / 4K select
firefly. `--model` overrides. See `references/cli.md`.

## Test

```bash
node --test --test-concurrency=1 tests/*.test.mjs
```

## License

AGPL-3.0-or-later. Keep existing copyright notices.
