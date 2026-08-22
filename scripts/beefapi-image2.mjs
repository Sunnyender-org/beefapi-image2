#!/usr/bin/env node

/*
 * BeefAPI Codex Image2 helper.
 * Copyright (C) 2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  DEFAULT_MODEL,
  MODEL_FIREFLY,
  MODEL_GPT_IMAGE_2,
  resolveImageRequest,
} from "./resolve-image-request.mjs";

const VERSION = "0.3.0";
const PRODUCT = "beefapi-codex-image2";
const MODEL = DEFAULT_MODEL;
const DEFAULT_BASE_URL = "https://beefapi.com/v1";
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;
const MANAGED_MARKER = ".beefapi-image2-managed.json";

function fail(message, code = 1) {
  console.error(`[BeefAPI Image2] ${message}`);
  process.exitCode = code;
  throw new Error("__BEEFAPI_IMAGE2_HANDLED__");
}

function info(message) {
  console.log(`[BeefAPI Image2] ${message}`);
}

function paths() {
  const home = os.homedir();
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  const configDir =
    process.env.BEEFAPI_IMAGE2_CONFIG_DIR ||
    (process.platform === "win32"
      ? path.join(
          process.env.APPDATA || path.join(home, "AppData", "Roaming"),
          "BeefAPI",
        )
      : path.join(
          process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
          "beefapi",
        ));
  const binDir =
    process.env.BEEFAPI_IMAGE2_BIN_DIR ||
    (process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
          "BeefAPI",
          "bin",
        )
      : path.join(home, ".local", "bin"));
  return {
    home,
    codexHome,
    configDir,
    credentials: path.join(configDir, "image2.credentials.json"),
    state: path.join(configDir, "image2.install-state.json"),
    skillDir: path.join(codexHome, "skills", "beefapi-image2"),
    backupRoot: path.join(codexHome, "skills", ".beefapi-image2-backups"),
    wrapper:
      process.platform === "win32"
        ? path.join(binDir, "beefapi-image2.cmd")
        : path.join(binDir, "beefapi-image2"),
  };
}

function normalizeBaseUrl(raw) {
  const candidate = String(raw || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    fail("Invalid API base URL.");
  }
  if (parsed.username || parsed.password) {
    fail("API base URL must not contain credentials.");
  }
  const local = new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    fail(
      "API base URL must use HTTPS (HTTP is allowed only for localhost tests).",
    );
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/v1";
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function parseArgs(argv) {
  const result = { _: [], image: [] };
  const booleans = new Set([
    "api-key-stdin",
    "dry-run",
    "force",
    "no-resize",
    "offline",
    "purge-credentials",
    "skip-check",
    "help",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    const key = token.slice(2, equal >= 0 ? equal : undefined);
    if (booleans.has(key)) {
      result[key] = true;
      continue;
    }
    const value = equal >= 0 ? token.slice(equal + 1) : argv[++index];
    if (value === undefined || value.startsWith("--")) {
      fail(`Option --${key} requires a value.`);
    }
    if (key === "image") result.image.push(value);
    else result[key] = value;
  }
  return result;
}

function atomicWrite(filePath, contents, mode = 0o600) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tempPath, contents, { mode });
    if (process.platform !== "win32") chmodSync(tempPath, mode);
    renameSync(tempPath, filePath);
    if (process.platform !== "win32") chmodSync(filePath, mode);
  } finally {
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function hardenWindowsAcl(filePath) {
  if (process.platform !== "win32") return;
  const script = [
    '$ErrorActionPreference = "Stop"',
    "$p = $env:BEEFAPI_IMAGE2_ACL_PATH",
    "$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    'icacls.exe $p /inheritance:r /grant:r "*$sid`:(F)" /remove:g "*S-1-1-0" "*S-1-5-11" "*S-1-5-32-545" | Out-Null',
    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, BEEFAPI_IMAGE2_ACL_PATH: filePath },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    fail("Could not restrict the Windows credential-file ACL.");
  }
}

function windowsAclIsPrivate(filePath) {
  if (process.platform !== "win32") return true;
  const script = [
    '$ErrorActionPreference = "Stop"',
    "$p = $env:BEEFAPI_IMAGE2_ACL_PATH",
    '$bad = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545")',
    "$rules = (Get-Acl -LiteralPath $p).Access",
    "$found = $false",
    "foreach ($rule in $rules) {",
    '  if ($rule.AccessControlType -ne "Allow") { continue }',
    "  try { $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { continue }",
    "  if ($bad -contains $sid) { $found = $true }",
    "}",
    "if ($found) { exit 2 }",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, BEEFAPI_IMAGE2_ACL_PATH: filePath },
      encoding: "utf8",
    },
  );
  return result.status === 0;
}

function permissionsArePrivate(filePath) {
  if (process.platform === "win32") return windowsAclIsPrivate(filePath);
  const stat = statSync(filePath);
  if ((stat.mode & 0o077) !== 0) return false;
  if (typeof process.getuid === "function" && stat.uid !== process.getuid())
    return false;
  return true;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    fail(`${label} is missing or invalid: ${filePath}`);
  }
}

async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function readSecret(promptText) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    process.stdout.write(`${promptText}\n`);
    return readAllStdin();
  }
  process.stdout.write(promptText);
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          reject(new Error("Setup cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

function unquoteToml(raw) {
  const value = String(raw).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function parseTomlTables(text) {
  const root = {};
  const tables = {};
  let current = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = header[1].trim();
      tables[current] ||= {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9._-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    if (current) tables[current][kv[1]] = unquoteToml(kv[2]);
    else root[kv[1]] = unquoteToml(kv[2]);
  }
  return { root, tables };
}

function isBeefApiProvider(id, table = {}) {
  const name = String(table.name || id || "").toLowerCase();
  if (name.includes("beefapi")) return true;
  try {
    const host = new URL(String(table.base_url || "")).hostname.toLowerCase();
    return host === "beefapi.com" || host.endsWith(".beefapi.com");
  } catch {
    return false;
  }
}

function readAuthJson(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function keyFromEnvName(name, auth) {
  if (!name) return "";
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  const fromAuth = auth[name];
  return typeof fromAuth === "string" ? fromAuth.trim() : "";
}

function credentialFromDisk() {
  const filePath = paths().credentials;
  const parsed = readJson(filePath, "Credential file");
  if (!parsed.api_key || typeof parsed.api_key !== "string") {
    fail(`Credential file has no API key: ${filePath}`);
  }
  return {
    apiKey: parsed.api_key,
    baseUrl: normalizeBaseUrl(
      process.env.BEEFAPI_IMAGE2_BASE_URL ||
        parsed.base_url ||
        DEFAULT_BASE_URL,
    ),
    model: MODEL,
    filePath,
    source: "file",
  };
}

function credentialFromCodex() {
  const p = paths();
  const configPath = path.join(p.codexHome, "config.toml");
  if (!existsSync(configPath)) return null;
  const { root, tables } = parseTomlTables(readFileSync(configPath, "utf8"));
  const providers = Object.entries(tables)
    .filter(([id]) => id.startsWith("model_providers."))
    .map(([id, table]) => ({
      id: id.slice("model_providers.".length),
      table,
    }));
  const preferred = String(root.model_provider || "").trim();
  const match =
    providers.find(
      (item) => item.id === preferred && isBeefApiProvider(item.id, item.table),
    ) || providers.find((item) => isBeefApiProvider(item.id, item.table));
  if (!match) return null;
  const auth = readAuthJson(path.join(p.codexHome, "auth.json"));
  const envKey =
    typeof match.table.env_key === "string" && match.table.env_key
      ? match.table.env_key
      : "OPENAI_API_KEY";
  const apiKey =
    keyFromEnvName(envKey, auth) || keyFromEnvName("OPENAI_API_KEY", auth);
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(
      process.env.BEEFAPI_IMAGE2_BASE_URL ||
        match.table.base_url ||
        DEFAULT_BASE_URL,
    ),
    model: MODEL,
    filePath: path.join(p.codexHome, "auth.json"),
    source: "codex",
    provider: match.id,
  };
}

function resolveCredential() {
  const envKey = process.env.BEEFAPI_IMAGE2_API_KEY?.trim();
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: normalizeBaseUrl(
        process.env.BEEFAPI_IMAGE2_BASE_URL || DEFAULT_BASE_URL,
      ),
      model: MODEL,
      filePath: "env:BEEFAPI_IMAGE2_API_KEY",
      source: "env",
    };
  }
  if (existsSync(paths().credentials)) return credentialFromDisk();
  const fromCodex = credentialFromCodex();
  if (fromCodex) return fromCodex;
  fail(
    "No BeefAPI key found. Codex needs [model_providers.beefapi] in config.toml plus OPENAI_API_KEY in auth.json, or run beefapi-image2 setup.",
  );
}

function redact(value, secret) {
  if (!secret) return value;
  return String(value).split(secret).join("[redacted]");
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") fail(`Request timed out: ${url}`);
    fail(`Network request failed: ${error?.message || error}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function apiJson(url, options, apiKey) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    fail(`API returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message =
      parsed?.error?.message ||
      parsed?.message ||
      response.statusText ||
      "request failed";
    fail(
      `API error ${response.status}: ${redact(String(message).slice(0, 500), apiKey)}`,
    );
  }
  return parsed;
}

async function listModels({ apiKey, baseUrl }) {
  const catalog = await apiJson(
    `${baseUrl}/models`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": `${PRODUCT}/${VERSION}`,
      },
    },
    apiKey,
  );
  return Array.isArray(catalog?.data)
    ? catalog.data.map((item) => item?.id).filter(Boolean)
    : [];
}

async function checkModel({ apiKey, baseUrl }) {
  const models = await listModels({ apiKey, baseUrl });
  if (!models.includes(MODEL_GPT_IMAGE_2)) {
    fail(
      `The token cannot access ${MODEL_GPT_IMAGE_2}. Use a gpt-plus or gpt-pro token.`,
    );
  }
  return models;
}

function requireModelAccess(models, model) {
  if (models.includes(model)) return;
  if (model === MODEL_FIREFLY) {
    fail(
      `The token cannot access ${MODEL_FIREFLY}. Use a gpt-plus or gpt-pro token that includes firefly, or pass --model gpt-image-2.`,
    );
  }
  fail(`The token cannot access ${model}.`);
}

async function commandSetup(options) {
  const envKey = process.env.BEEFAPI_IMAGE2_API_KEY?.trim();
  const apiKey =
    envKey ||
    (options["api-key-stdin"]
      ? await readAllStdin()
      : await readSecret("BeefAPI Image2 API Key（输入不会显示）: "));
  if (!apiKey || apiKey === "sk-xxx" || apiKey === "sk-your-key-here") {
    fail("A real BeefAPI API key is required.");
  }
  if (/\s/.test(apiKey)) fail("API key must not contain whitespace.");
  const baseUrl = normalizeBaseUrl(
    process.env.BEEFAPI_IMAGE2_BASE_URL || DEFAULT_BASE_URL,
  );
  if (!options["skip-check"] && process.env.BEEFAPI_IMAGE2_SKIP_CHECK !== "1") {
    info(`Checking ${MODEL} access without generating an image…`);
    await checkModel({ apiKey, baseUrl });
  }
  const filePath = paths().credentials;
  atomicWrite(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        base_url: baseUrl,
        model: MODEL,
        api_key: apiKey,
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  hardenWindowsAcl(filePath);
  if (!permissionsArePrivate(filePath)) {
    rmSync(filePath, { force: true });
    fail("Credential file permissions are not private; setup was rolled back.");
  }
  info(`Credential saved with user-only permissions: ${filePath}`);
  info("No image was generated and no quota was consumed by setup.");
}

function listSkillFiles(root, prefix = "") {
  const entries = [];
  for (const name of readdirSync(root).sort()) {
    if (name === MANAGED_MARKER) continue;
    const absolute = path.join(root, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      entries.push({ relative, type: "symlink", data: readFileSync(absolute) });
    } else if (stat.isDirectory()) {
      entries.push(...listSkillFiles(absolute, relative));
    } else if (stat.isFile()) {
      entries.push({ relative, type: "file", data: readFileSync(absolute) });
    }
  }
  return entries;
}

function hashSkill(root) {
  const hash = createHash("sha256");
  for (const entry of listSkillFiles(root)) {
    hash.update(entry.type);
    hash.update("\0");
    hash.update(entry.relative);
    hash.update("\0");
    hash.update(entry.data);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function commandDoctor(options) {
  const p = paths();
  const checks = [];
  const add = (ok, label, optional = false) =>
    checks.push({ ok, label, optional });

  add(
    Number(process.versions.node.split(".")[0]) >= 18,
    `Node ${process.versions.node} (need 18+)`,
  );
  add(
    existsSync(path.join(p.skillDir, "SKILL.md")),
    `Skill installed: ${p.skillDir}`,
  );

  if (existsSync(path.join(p.skillDir, MANAGED_MARKER))) {
    try {
      const marker = JSON.parse(
        readFileSync(path.join(p.skillDir, MANAGED_MARKER), "utf8"),
      );
      add(marker.product === PRODUCT, "Skill ownership marker");
      add(
        marker.skill_hash === hashSkill(p.skillDir),
        "Managed skill checksum",
      );
    } catch {
      add(false, "Managed skill checksum");
    }
  } else {
    add(false, "Installer ownership marker", true);
  }

  add(existsSync(p.state), `Install state: ${p.state}`, true);
  add(
    existsSync(p.credentials),
    `Dedicated credential file: ${p.credentials}`,
    true,
  );
  if (existsSync(p.credentials)) {
    add(
      permissionsArePrivate(p.credentials),
      "Credential permissions are user-only",
    );
  }

  let credential;
  try {
    credential = resolveCredential();
    add(
      Boolean(credential.apiKey),
      `BeefAPI key from ${credential.source} (not printed)`,
    );
  } catch (error) {
    if (error.message !== "__BEEFAPI_IMAGE2_HANDLED__") throw error;
    add(false, "BeefAPI key from Codex auth.json or Image2 setup");
  }

  if (!options.offline && credential) {
    try {
      const models = await checkModel(credential);
      add(true, `${MODEL_GPT_IMAGE_2} is visible to this token`);
      add(
        models.includes(MODEL_FIREFLY),
        `${MODEL_FIREFLY} is visible to this token`,
        true,
      );
    } catch (error) {
      if (error.message !== "__BEEFAPI_IMAGE2_HANDLED__") throw error;
      add(false, `${MODEL_GPT_IMAGE_2} is visible to this token`);
    }
  }

  for (const check of checks) {
    const tag = check.ok ? "PASS" : check.optional ? "WARN" : "FAIL";
    console.log(`${tag}  ${check.label}`);
  }
  if (checks.some((check) => !check.ok && !check.optional)) {
    process.exitCode = 1;
    return;
  }
  info(
    options.offline
      ? "Offline doctor passed."
      : "Doctor passed; no image was generated.",
  );
}

function readPrompt(options) {
  if (options.prompt && options["prompt-file"]) {
    fail("Use --prompt or --prompt-file, not both.");
  }
  const prompt = options["prompt-file"]
    ? readFileSync(path.resolve(options["prompt-file"]), "utf8").trim()
    : String(options.prompt || "").trim();
  if (!prompt) fail("Missing prompt. Use --prompt or --prompt-file.");
  return prompt;
}

function planImageRequest(options, prompt) {
  const n = Number(options.n || 1);
  if (!Number.isInteger(n) || n !== 1)
    fail("BeefAPI Image2 currently requires --n 1.");
  if (
    options["response-format"] &&
    !["b64_json", "url"].includes(options["response-format"])
  ) {
    fail("response-format must be b64_json or url.");
  }
  try {
    return resolveImageRequest({
      prompt,
      model: options.model,
      size: options.size,
      targetSize: options["target-size"],
      resolution: options.resolution,
      quality: options.quality,
      background: options.background,
      outputFormat: options["output-format"],
      noResize: Boolean(options["no-resize"]),
    });
  } catch (error) {
    fail(error.message);
  }
}

function defaultOutput(format) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "");
  return path.resolve(
    "output",
    "imagegen",
    `beefapi-image2-${timestamp}.${format}`,
  );
}

function outputPath(options, format) {
  const requested = options.out
    ? path.resolve(options.out)
    : defaultOutput(format);
  if (existsSync(requested) && !options.force) {
    fail(`Output already exists: ${requested} (use --force to overwrite)`);
  }
  return requested;
}

function payloadPreview(endpoint, payload, extra = {}) {
  console.log(
    JSON.stringify(
      {
        endpoint,
        ...payload,
        ...extra,
      },
      null,
      2,
    ),
  );
}

async function imageBytes(item, baseUrl) {
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (!item?.url) fail("Image response contains neither b64_json nor url.");
  if (item.url.startsWith("data:")) {
    const match = item.url.match(/^data:[^,]*;base64,(.+)$/s);
    if (!match) fail("Unsupported image data URL.");
    return Buffer.from(match[1], "base64");
  }
  let target;
  try {
    target = new URL(item.url, `${baseUrl}/`).toString();
  } catch {
    fail("Image API returned an invalid download URL.");
  }
  const response = await fetchWithTimeout(target, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
      "User-Agent": `${PRODUCT}/${VERSION}`,
    },
  });
  if (!response.ok) fail(`Image download failed (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function writeImage(filePath, bytes, force = false) {
  if (!bytes.length) fail("Image response was empty.");
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, bytes, { flag: force ? "w" : "wx" });
  info(`Wrote ${filePath}`);
}

function commandExists(bin) {
  const result = spawnSync(bin, ["-h"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") return false;
  return true;
}

function resizeWithLocalTool(bytes, targetSize, format) {
  const parsed = String(targetSize).match(/^(\d+)x(\d+)$/);
  if (!parsed) return { bytes, resized: false };
  const width = parsed[1];
  const height = parsed[2];
  const ext = format === "jpeg" ? "jpg" : format;
  const tempDir = path.join(os.tmpdir(), `beefapi-image2-resize-${process.pid}`);
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const source = path.join(tempDir, `in.${ext}`);
  const dest = path.join(tempDir, `out.${ext}`);
  writeFileSync(source, bytes);
  const attempts = [];
  if (process.platform === "darwin") {
    attempts.push({
      bin: "sips",
      args: ["-z", height, width, source, "--out", dest],
    });
  }
  attempts.push(
    { bin: "magick", args: [source, "-resize", `${width}x${height}!`, dest] },
    { bin: "convert", args: [source, "-resize", `${width}x${height}!`, dest] },
  );
  try {
    for (const attempt of attempts) {
      if (!commandExists(attempt.bin)) continue;
      const result = spawnSync(attempt.bin, attempt.args, { encoding: "utf8" });
      if (result.status === 0 && existsSync(dest) && statSync(dest).size > 0) {
        return { bytes: readFileSync(dest), resized: true, tool: attempt.bin };
      }
    }
    return { bytes, resized: false };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function describePlan(plan, extra = {}) {
  return {
    model: plan.model,
    size: plan.size,
    target_size: plan.targetSize,
    resize: plan.resize,
    reason: plan.reason,
    selected_by: plan.selectedBy,
    warning: plan.warning,
    ...extra,
  };
}

async function callImageApi(endpoint, body, credential, multipart = false) {
  const headers = {
    Authorization: `Bearer ${credential.apiKey}`,
    Accept: "application/json",
    "User-Agent": `${PRODUCT}/${VERSION}`,
  };
  if (!multipart) headers["Content-Type"] = "application/json";
  return apiJson(
    `${credential.baseUrl}${endpoint}`,
    {
      method: "POST",
      headers,
      body: multipart ? body : JSON.stringify(body),
    },
    credential.apiKey,
  );
}

async function commandGenerate(options) {
  const prompt = readPrompt(options);
  const plan = planImageRequest(options, prompt);
  const out = outputPath(options, plan.outputFormat);
  const payload = {
    model: plan.model,
    prompt: plan.prompt,
    n: 1,
    size: plan.size,
    quality: plan.quality,
    response_format: options["response-format"],
    background: plan.background,
    output_format: plan.outputFormat,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  if (options["dry-run"]) {
    payloadPreview(
      "/v1/images/generations",
      payload,
      describePlan(plan, { output: out }),
    );
    return;
  }
  const credential = resolveCredential();
  const models = await listModels(credential);
  requireModelAccess(models, plan.model);
  info(
    `Generating one ${plan.model} image at ${plan.size}${plan.targetSize ? ` (target ${plan.targetSize})` : ""} via ${credential.source}; this consumes BeefAPI quota and may take a couple of minutes…`,
  );
  if (plan.warning) info(plan.warning);
  const result = await callImageApi("/images/generations", payload, credential);
  if (!Array.isArray(result?.data) || !result.data.length)
    fail("Image API returned no images.");
  let bytes = await imageBytes(result.data[0], credential.baseUrl);
  if (plan.resize) {
    const resized = resizeWithLocalTool(bytes, plan.targetSize, plan.outputFormat);
    if (resized.resized) {
      bytes = resized.bytes;
      info(`Resized to ${plan.targetSize} with ${resized.tool}.`);
    } else {
      info(
        `Native output is ${plan.size}; could not locally resize to ${plan.targetSize}. Install ImageMagick, or on macOS use sips.`,
      );
    }
  }
  writeImage(out, bytes, options.force);
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    }[ext] || "application/octet-stream"
  );
}

function checkedInput(filePath, label) {
  const absolute = path.resolve(filePath);
  if (!existsSync(absolute)) fail(`${label} not found: ${absolute}`);
  const stat = statSync(absolute);
  if (!stat.isFile() || stat.size === 0)
    fail(`${label} must be a non-empty file: ${absolute}`);
  if (stat.size > MAX_INPUT_BYTES) fail(`${label} exceeds 32 MiB: ${absolute}`);
  const mime = mimeFor(absolute);
  if (!mime.startsWith("image/"))
    fail(`${label} must be png, jpeg, webp, or gif: ${absolute}`);
  return { absolute, mime, bytes: readFileSync(absolute) };
}

async function commandEdit(options) {
  const prompt = readPrompt(options);
  const plan = planImageRequest(options, prompt);
  if (!options.image.length) fail("Edit requires at least one --image path.");
  const images = options.image.map((item) => checkedInput(item, "Image"));
  const mask = options.mask ? checkedInput(options.mask, "Mask") : null;
  const out = outputPath(options, plan.outputFormat);
  if (options["dry-run"]) {
    payloadPreview(
      "/v1/images/edits",
      {
        model: plan.model,
        prompt: plan.prompt,
        n: 1,
        size: plan.size,
        quality: plan.quality,
        response_format: options["response-format"],
        background: plan.background,
        output_format: plan.outputFormat,
        input_fidelity: options["input-fidelity"],
      },
      describePlan(plan, {
        image: images.map((item) => item.absolute),
        mask: mask?.absolute,
        output: out,
      }),
    );
    return;
  }
  const form = new FormData();
  form.append("model", plan.model);
  form.append("prompt", plan.prompt);
  form.append("n", "1");
  form.append("size", plan.size);
  form.append("quality", plan.quality);
  form.append("output_format", plan.outputFormat);
  if (plan.background) form.append("background", plan.background);
  if (options["response-format"])
    form.append("response_format", options["response-format"]);
  if (options["input-fidelity"])
    form.append("input_fidelity", options["input-fidelity"]);
  for (const image of images) {
    form.append(
      "image",
      new Blob([image.bytes], { type: image.mime }),
      path.basename(image.absolute),
    );
  }
  if (mask)
    form.append(
      "mask",
      new Blob([mask.bytes], { type: mask.mime }),
      path.basename(mask.absolute),
    );

  const credential = resolveCredential();
  const models = await listModels(credential);
  requireModelAccess(models, plan.model);
  info(
    `Editing one ${plan.model} image at ${plan.size}${plan.targetSize ? ` (target ${plan.targetSize})` : ""} via ${credential.source}; this consumes BeefAPI quota and may take a couple of minutes…`,
  );
  if (plan.warning) info(plan.warning);
  const result = await callImageApi("/images/edits", form, credential, true);
  if (!Array.isArray(result?.data) || !result.data.length)
    fail("Image API returned no images.");
  let bytes = await imageBytes(result.data[0], credential.baseUrl);
  if (plan.resize) {
    const resized = resizeWithLocalTool(bytes, plan.targetSize, plan.outputFormat);
    if (resized.resized) {
      bytes = resized.bytes;
      info(`Resized to ${plan.targetSize} with ${resized.tool}.`);
    } else {
      info(
        `Native output is ${plan.size}; could not locally resize to ${plan.targetSize}. Install ImageMagick, or on macOS use sips.`,
      );
    }
  }
  writeImage(out, bytes, options.force);
}

function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function commandUninstall(options) {
  const p = paths();
  if (!existsSync(p.state)) fail(`Install state not found: ${p.state}`);
  const state = readJson(p.state, "Install state");
  if (state.product !== PRODUCT)
    fail("Install state is not owned by BeefAPI Image2.");
  if (path.resolve(state.skill_dir) !== path.resolve(p.skillDir)) {
    fail("Install state points outside the expected skill directory.");
  }
  if (state.backup_path && !isInside(state.backup_path, p.backupRoot)) {
    fail("Recorded backup path is outside the managed backup directory.");
  }
  if (!existsSync(p.skillDir))
    fail("Managed skill directory is already missing.");
  const markerPath = path.join(p.skillDir, MANAGED_MARKER);
  const marker = readJson(markerPath, "Managed skill marker");
  if (marker.product !== PRODUCT)
    fail("Refusing to remove a skill not owned by BeefAPI Image2.");
  const currentHash = hashSkill(p.skillDir);
  if (currentHash !== state.skill_hash && !options.force) {
    fail(
      "Managed skill was modified locally; use --force only after reviewing those changes.",
    );
  }

  const removedPath = `${p.skillDir}.remove.${process.pid}.${Date.now()}`;
  renameSync(p.skillDir, removedPath);
  let restored = false;
  try {
    if (state.backup_path && existsSync(state.backup_path)) {
      if (
        state.backup_hash &&
        hashSkill(state.backup_path) !== state.backup_hash
      ) {
        fail(
          "Recorded backup checksum changed; uninstall stopped before restoration.",
        );
      }
      renameSync(state.backup_path, p.skillDir);
      restored = true;
    }
    rmSync(removedPath, { recursive: true, force: true });
  } catch (error) {
    if (restored && existsSync(p.skillDir))
      renameSync(p.skillDir, state.backup_path);
    if (existsSync(removedPath)) renameSync(removedPath, p.skillDir);
    throw error;
  }

  if (
    path.resolve(state.wrapper_path || "") === path.resolve(p.wrapper) &&
    existsSync(p.wrapper)
  ) {
    const wrapper = readFileSync(p.wrapper, "utf8");
    if (wrapper.includes("BeefAPI Image2 managed wrapper"))
      unlinkSync(p.wrapper);
  }
  rmSync(p.state, { force: true });
  if (options["purge-credentials"]) rmSync(p.credentials, { force: true });
  info(
    restored
      ? "Uninstalled and restored the previous skill."
      : "Uninstalled the managed skill.",
  );
  if (!options["purge-credentials"] && existsSync(p.credentials)) {
    info(
      `Credential kept: ${p.credentials} (use --purge-credentials to remove it)`,
    );
  }
}

function printHelp() {
  console.log(`BeefAPI Image2 ${VERSION}

Usage:
  beefapi-image2 setup [--skip-check]
  beefapi-image2 doctor [--offline]
  beefapi-image2 generate --prompt <text> [--out <file>]
  beefapi-image2 edit --image <file> --prompt <text> [--out <file>]
  beefapi-image2 uninstall [--purge-credentials] [--force]

Uses Codex BeefAPI config.toml + auth.json when present. setup is optional.

Image options:
  --n 1
  --model gpt-image-2|gpt-image-2-firefly
  --size WxH|auto
  --target-size WxH
  --resolution 1k|2k|4k
  --quality low|medium|high|auto
  --background transparent|opaque|auto
  --output-format png|jpeg|webp
  --response-format b64_json|url
  --no-resize
  --dry-run
  --force

Without --model/--size, the CLI reads 淘系/1440/1:1/3:4/9:16/2K/4K from the
prompt and selects gpt-image-2 or gpt-image-2-firefly plus a native size.
`);
}

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  if (options.help || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  if (command === "version" || command === "--version") {
    console.log(VERSION);
    return;
  }
  if (Number(process.versions.node.split(".")[0]) < 18) {
    fail(`Node 18+ is required; found ${process.versions.node}.`);
  }
  if (command === "setup") return commandSetup(options);
  if (command === "doctor") return commandDoctor(options);
  if (command === "generate") return commandGenerate(options);
  if (command === "edit") return commandEdit(options);
  if (command === "uninstall") return commandUninstall(options);
  fail(`Unknown command: ${command}`);
}

main().catch((error) => {
  if (error?.message === "__BEEFAPI_IMAGE2_HANDLED__") return;
  console.error(`[BeefAPI Image2] ${error?.message || error}`);
  process.exitCode = 1;
});
