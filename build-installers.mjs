#!/usr/bin/env node

/*
 * Copyright (C) 2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillEntries = ["SKILL.md", "agents", "evals", "references", "scripts"];
const templatePath = path.join(here, "installer.mjs");
const publicDir = path.join(here, "install");
const bashPath = path.join(publicDir, "beefapi-codex-image2.sh");
const powershellPath = path.join(publicDir, "beefapi-codex-image2.ps1");
const checksumsPath = path.join(publicDir, "beefapi-codex-image2.sha256");
const checkOnly = process.argv.includes("--check");

async function collectFiles(root, prefix = "") {
  const files = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )) {
    const absolute = path.join(root, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await collectFiles(absolute, relative)));
    else if (entry.isFile())
      files.push({ relative, data: await readFile(absolute) });
    else throw new Error(`unsupported skill entry: ${relative}`);
  }
  return files;
}

function hashSkill(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update("file");
    hash.update("\0");
    hash.update(file.relative);
    hash.update("\0");
    hash.update(file.data);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function wrapBase64(value, width = 76) {
  return value.match(new RegExp(`.{1,${width}}`, "g")).join("\n");
}

function buildBash(bundleBase64) {
  return `#!/usr/bin/env bash
# BeefAPI Codex Image2 standalone installer. Contains no API key.
set -eu
umask 077

if ! command -v node >/dev/null 2>&1; then
  echo "[BeefAPI Image2] Node 18+ is required: https://nodejs.org/" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d "\${TMPDIR:-/tmp}/beefapi-image2.XXXXXX")"
INSTALLER="$TMP_DIR/install.mjs"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT HUP INT TERM

node -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>require("fs").writeFileSync(process.argv[1],Buffer.from(s.replace(/\\s/g,""),"base64"),{mode:0o700}));' "$INSTALLER" <<'BEEFAPI_IMAGE2_BUNDLE'
${wrapBase64(bundleBase64)}
BEEFAPI_IMAGE2_BUNDLE

node "$INSTALLER" "$@"
`;
}

function buildPowerShell(bundleBase64) {
  return `# BeefAPI Codex Image2 standalone installer. Contains no API key.
$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '[BeefAPI Image2] Node 18+ is required: https://nodejs.org/'
}

$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('beefapi-image2-' + [Guid]::NewGuid().ToString('N'))
$installer = Join-Path $tempDir 'install.mjs'
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
  $bundle = @'
${wrapBase64(bundleBase64)}
'@ -replace '\\s', ''
  [IO.File]::WriteAllBytes($installer, [Convert]::FromBase64String($bundle))
  & node $installer @args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
`;
}

async function writeOrCheck(filePath, contents) {
  if (!checkOnly) {
    await writeFile(filePath, contents, "utf8");
    return;
  }
  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch {
    throw new Error(`generated installer missing: ${filePath}`);
  }
  if (existing !== contents)
    throw new Error(`generated installer is stale: ${filePath}`);
}

async function collectSkillFiles() {
  const files = [];
  for (const name of skillEntries) {
    const absolute = path.join(here, name);
    const info = await stat(absolute);
    if (info.isDirectory()) files.push(...(await collectFiles(absolute, name)));
    else if (info.isFile()) files.push({ relative: name, data: await readFile(absolute) });
    else throw new Error(`unsupported skill entry: ${name}`);
  }
  return files;
}

const files = await collectSkillFiles();
const payload = Object.fromEntries(
  files.map((file) => [file.relative, file.data.toString("base64")]),
);
const skillHash = hashSkill(files);
const template = await readFile(templatePath, "utf8");
const bundle = template
  .replace("__BEEFAPI_IMAGE2_PAYLOAD__", JSON.stringify(payload))
  .replace("__BEEFAPI_IMAGE2_SKILL_HASH__", skillHash);
if (bundle.includes("__BEEFAPI_IMAGE2_"))
  throw new Error("installer placeholders remain");

const bundleBase64 = Buffer.from(bundle, "utf8").toString("base64");
const bash = buildBash(bundleBase64);
const powershell = buildPowerShell(bundleBase64);
const digest = (contents) =>
  createHash("sha256").update(contents).digest("hex");
const checksums = [
  `${digest(bash)}  ${path.basename(bashPath)}`,
  `${digest(powershell)}  ${path.basename(powershellPath)}`,
  "",
].join("\n");

await mkdir(publicDir, { recursive: true });
await writeOrCheck(bashPath, bash);
await writeOrCheck(powershellPath, powershell);
await writeOrCheck(checksumsPath, checksums);

console.log(
  `${checkOnly ? "checked" : "built"} BeefAPI Image2 installers (${files.length} skill files, sha256 ${skillHash})`,
);
