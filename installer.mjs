#!/usr/bin/env node

/*
 * Source template for the standalone BeefAPI Codex Image2 installers.
 * Copyright (C) 2026 QuantumNous
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * `build-installers.mjs` replaces the two placeholders below with the skill
 * payload and its deterministic checksum. Do not publish this template
 * directly.
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
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const VERSION = "0.5.0";
const PRODUCT = "beefapi-codex-image2";
const MANAGED_MARKER = ".beefapi-image2-managed.json";
const PAYLOAD = __BEEFAPI_IMAGE2_PAYLOAD__;
const EXPECTED_SKILL_HASH = "__BEEFAPI_IMAGE2_SKILL_HASH__";

function die(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function info(message) {
  console.log(`[BeefAPI Image2] ${message}`);
}

function parseArgs(argv) {
  const result = { replace: false, skipCheck: false, help: false };
  for (const arg of argv) {
    if (arg === "--replace") result.replace = true;
    else if (arg === "--skip-check") result.skipCheck = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else die(`Unknown installer option: ${arg}`);
  }
  return result;
}

function installPaths() {
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
  const skillsRoot = path.join(codexHome, "skills");
  return {
    home,
    codexHome,
    configDir,
    credentials: path.join(configDir, "image2.credentials.json"),
    state: path.join(configDir, "image2.install-state.json"),
    skillsRoot,
    skillDir: path.join(skillsRoot, "beefapi-image2"),
    backupRoot: path.join(skillsRoot, ".beefapi-image2-backups"),
    wrapper:
      process.platform === "win32"
        ? path.join(binDir, "beefapi-image2.cmd")
        : path.join(binDir, "beefapi-image2"),
  };
}

function atomicWrite(filePath, contents, mode = 0o600) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(temp, contents, { mode });
    if (process.platform !== "win32") chmodSync(temp, mode);
    renameSync(temp, filePath);
    if (process.platform !== "win32") chmodSync(filePath, mode);
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function listSkillFiles(root, prefix = "") {
  const entries = [];
  for (const name of readdirSync(root).sort()) {
    if (name === MANAGED_MARKER) continue;
    const absolute = path.join(root, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) entries.push(...listSkillFiles(absolute, relative));
    else if (stat.isFile())
      entries.push({ relative, type: "file", data: readFileSync(absolute) });
    else if (stat.isSymbolicLink())
      entries.push({ relative, type: "symlink", data: readFileSync(absolute) });
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

function writePayload(stageDir) {
  for (const [relative, encoded] of Object.entries(PAYLOAD)) {
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative.split("/").includes("..")
    ) {
      die(`Unsafe bundled path: ${relative}`);
    }
    const target = path.join(stageDir, ...relative.split("/"));
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, Buffer.from(encoded, "base64"), {
      mode: relative.startsWith("scripts/") ? 0o700 : 0o600,
    });
    if (process.platform !== "win32") {
      chmodSync(target, relative.startsWith("scripts/") ? 0o700 : 0o600);
    }
  }
  const actual = hashSkill(stageDir);
  if (actual !== EXPECTED_SKILL_HASH) {
    die(
      `Bundled skill checksum mismatch: expected ${EXPECTED_SKILL_HASH}, got ${actual}`,
    );
  }
  atomicWrite(
    path.join(stageDir, MANAGED_MARKER),
    `${JSON.stringify(
      {
        product: PRODUCT,
        version: VERSION,
        skill_hash: actual,
      },
      null,
      2,
    )}\n`,
  );
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function wrapperContents(cliPath) {
  return process.platform === "win32"
    ? `@echo off\r\nrem BeefAPI Image2 managed wrapper\r\nnode "${cliPath}" %*\r\n`
    : `#!/usr/bin/env sh\n# BeefAPI Image2 managed wrapper\nexec node ${shellQuote(cliPath)} "$@"\n`;
}

function writeWrapper(wrapperPath, cliPath) {
  mkdirSync(path.dirname(wrapperPath), { recursive: true, mode: 0o700 });
  atomicWrite(
    wrapperPath,
    wrapperContents(cliPath),
    process.platform === "win32" ? 0o600 : 0o700,
  );
}

function restoreFile(filePath, snapshot) {
  if (!snapshot) {
    rmSync(filePath, { force: true });
    return;
  }
  atomicWrite(filePath, snapshot.contents, snapshot.mode);
}

function readFileSnapshot(filePath) {
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  return { contents: readFileSync(filePath), mode: stat.mode & 0o777 };
}

function removeInstalledWrapper(wrapperPath) {
  if (!existsSync(wrapperPath)) return;
  const contents = readFileSync(wrapperPath, "utf8");
  if (contents.includes("BeefAPI Image2 managed wrapper"))
    rmSync(wrapperPath, { force: true });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      `BeefAPI Codex Image2 installer ${VERSION}\n\nUsage:\n  installer [--skip-check] [--replace]\n\n--replace is required only when a foreign directory already exists at\n~/.codex/skills/beefapi-image2. It never replaces the generic imagegen skill.`,
    );
    return;
  }
  if (Number(process.versions.node.split(".")[0]) < 18) {
    die(`Node 18+ is required; found ${process.versions.node}.`);
  }

  const p = installPaths();
  const wrapperSnapshot = readFileSnapshot(p.wrapper);
  const installedCliPath = path.join(
    p.skillDir,
    "scripts",
    "beefapi-image2.mjs",
  );
  if (
    wrapperSnapshot &&
    wrapperSnapshot.contents.toString("utf8") !==
      wrapperContents(installedCliPath)
  ) {
    die(
      `A non-BeefAPI or locally modified command exists at ${p.wrapper}. ` +
        "It was left untouched; move or restore it before installing.",
      2,
    );
  }
  mkdirSync(p.skillsRoot, { recursive: true, mode: 0o700 });
  mkdirSync(p.configDir, { recursive: true, mode: 0o700 });
  const stageDir = path.join(
    p.skillsRoot,
    `.beefapi-image2.stage.${process.pid}.${Date.now()}`,
  );
  const rollbackDir = path.join(
    p.skillsRoot,
    `.beefapi-image2.rollback.${process.pid}.${Date.now()}`,
  );
  const previousState = safeReadJson(p.state);
  const credentialSnapshot = readFileSnapshot(p.credentials);
  let backupPath = previousState?.backup_path || null;
  let backupHash = previousState?.backup_hash || null;
  let movedExisting = false;
  let existingWasManaged = false;
  let installedNew = false;
  let wrapperWritten = false;
  let setupStarted = false;
  let stateWriteStarted = false;

  try {
    mkdirSync(stageDir, { recursive: false, mode: 0o700 });
    writePayload(stageDir);

    if (existsSync(p.skillDir)) {
      const marker = safeReadJson(path.join(p.skillDir, MANAGED_MARKER));
      existingWasManaged = marker?.product === PRODUCT;
      if (!existingWasManaged && !options.replace) {
        die(
          `A non-BeefAPI directory already exists at ${p.skillDir}. ` +
            "It was left untouched. Re-run with --replace only after reviewing it.",
          2,
        );
      }
      if (existingWasManaged) {
        if (!marker.skill_hash || marker.skill_hash !== hashSkill(p.skillDir)) {
          die(
            `The managed skill at ${p.skillDir} was modified locally. ` +
              "It was left untouched; review or uninstall it before updating.",
            2,
          );
        }
        renameSync(p.skillDir, rollbackDir);
      } else {
        mkdirSync(p.backupRoot, { recursive: true, mode: 0o700 });
        backupPath = path.join(p.backupRoot, `beefapi-image2.${Date.now()}`);
        backupHash = hashSkill(p.skillDir);
        renameSync(p.skillDir, backupPath);
      }
      movedExisting = true;
    }

    renameSync(stageDir, p.skillDir);
    installedNew = true;
    const cliPath = path.join(p.skillDir, "scripts", "beefapi-image2.mjs");
    writeWrapper(p.wrapper, cliPath);
    wrapperWritten = true;

    const setupArgs = [cliPath, "setup"];
    if (options.skipCheck || process.env.BEEFAPI_IMAGE2_SKIP_CHECK === "1") {
      setupArgs.push("--skip-check");
    }
    setupStarted = true;
    const setup = spawnSync(process.execPath, setupArgs, {
      stdio: "inherit",
      env: process.env,
    });
    if (setup.status !== 0)
      die("Credential setup failed; installation will be rolled back.");

    const state = {
      product: PRODUCT,
      installer_version: VERSION,
      installed_at: new Date().toISOString(),
      skill_dir: p.skillDir,
      skill_hash: EXPECTED_SKILL_HASH,
      wrapper_path: p.wrapper,
      credentials_path: p.credentials,
      backup_path: backupPath,
      backup_hash: backupHash,
    };
    stateWriteStarted = true;
    atomicWrite(p.state, `${JSON.stringify(state, null, 2)}\n`);

    if (existingWasManaged && existsSync(rollbackDir)) {
      rmSync(rollbackDir, { recursive: true, force: true });
    }
    info(`Installed skill: ${p.skillDir}`);
    info(`Installed command: ${p.wrapper}`);
    if (
      !(process.env.PATH || "")
        .split(path.delimiter)
        .includes(path.dirname(p.wrapper))
    ) {
      info(`If beefapi-image2 is not found, run it by full path: ${p.wrapper}`);
    }
    info(
      "Restart Codex, then ordinary image requests will prefer BeefAPI Image2.",
    );
  } catch (error) {
    if (installedNew && existsSync(p.skillDir))
      rmSync(p.skillDir, { recursive: true, force: true });
    if (movedExisting) {
      if (existingWasManaged && existsSync(rollbackDir))
        renameSync(rollbackDir, p.skillDir);
      else if (backupPath && existsSync(backupPath))
        renameSync(backupPath, p.skillDir);
    }
    if (wrapperWritten) {
      if (wrapperSnapshot) restoreFile(p.wrapper, wrapperSnapshot);
      else removeInstalledWrapper(p.wrapper);
    }
    if (setupStarted) restoreFile(p.credentials, credentialSnapshot);
    if (stateWriteStarted) {
      if (previousState)
        atomicWrite(p.state, `${JSON.stringify(previousState, null, 2)}\n`);
      else rmSync(p.state, { force: true });
    }
    if (existsSync(stageDir))
      rmSync(stageDir, { recursive: true, force: true });
    if (error?.message) {
      console.error(`[BeefAPI Image2] ${error.message}`);
    }
    process.exitCode = error?.exitCode || process.exitCode || 1;
  } finally {
    if (existsSync(stageDir))
      rmSync(stageDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[BeefAPI Image2] ${error?.message || error}`);
  process.exitCode = error?.exitCode || 1;
}
