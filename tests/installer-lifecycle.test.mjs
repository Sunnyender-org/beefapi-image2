import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const installer = path.join(repoRoot, "install", "beefapi-codex-image2.sh");
const apiKey = "sk-installer-secret-test";

function fixture(options = {}) {
  const tempRoot = mkdtempSync(
    path.join(os.tmpdir(), "beefapi-image2-installer-"),
  );
  const root = options.apostrophe
    ? path.join(tempRoot, "ender's fixture")
    : tempRoot;
  const codexHome = path.join(root, "codex");
  const configDir = path.join(root, "config");
  const binDir = path.join(root, "bin");
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(codexHome, "config.toml"), 'model = "keep-me"\n');
  writeFileSync(
    path.join(codexHome, "auth.json"),
    '{"OPENAI_API_KEY":"keep-me"}\n',
  );
  return {
    root,
    codexHome,
    configDir,
    binDir,
    skillDir: path.join(codexHome, "skills", "beefapi-image2"),
    wrapper: path.join(binDir, "beefapi-image2"),
  };
}

function envFor(f) {
  return {
    ...process.env,
    HOME: f.root,
    CODEX_HOME: f.codexHome,
    BEEFAPI_IMAGE2_CONFIG_DIR: f.configDir,
    BEEFAPI_IMAGE2_BIN_DIR: f.binDir,
    BEEFAPI_IMAGE2_API_KEY: apiKey,
    BEEFAPI_IMAGE2_SKIP_CHECK: "1",
  };
}

function runInstaller(f, args = [], expected = 0, env = {}) {
  const result = spawnSync("bash", [installer, ...args], {
    cwd: f.root,
    encoding: "utf8",
    env: { ...envFor(f), ...env },
  });
  assert.equal(
    result.status,
    expected,
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(apiKey));
  return result;
}

function runWrapper(f, args, expected = 0) {
  const result = spawnSync(f.wrapper, args, {
    cwd: f.root,
    encoding: "utf8",
    env: envFor(f),
  });
  assert.equal(
    result.status,
    expected,
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(apiKey));
  return result;
}

function assertCodexCoreUntouched(f) {
  assert.equal(
    readFileSync(path.join(f.codexHome, "config.toml"), "utf8"),
    'model = "keep-me"\n',
  );
  assert.equal(
    readFileSync(path.join(f.codexHome, "auth.json"), "utf8"),
    '{"OPENAI_API_KEY":"keep-me"}\n',
  );
}

test("install, update, doctor, and uninstall never touch Codex core config", () => {
  const f = fixture();
  runInstaller(f, ["--skip-check"]);
  assert.ok(existsSync(path.join(f.skillDir, "SKILL.md")));
  assert.ok(existsSync(path.join(f.skillDir, ".beefapi-image2-managed.json")));
  assert.ok(existsSync(f.wrapper));
  assertCodexCoreUntouched(f);

  const doctor = runWrapper(f, ["doctor", "--offline"]);
  assert.match(doctor.stdout, /Offline doctor passed/);

  runInstaller(f, ["--skip-check"]);
  assertCodexCoreUntouched(f);

  runWrapper(f, ["uninstall", "--purge-credentials"]);
  assert.equal(existsSync(f.skillDir), false);
  assert.equal(
    existsSync(path.join(f.configDir, "image2.credentials.json")),
    false,
  );
  assertCodexCoreUntouched(f);
});

test("foreign same-name skill is blocked unless --replace and is restored byte-for-byte", () => {
  const f = fixture();
  mkdirSync(path.join(f.skillDir, "nested"), { recursive: true });
  writeFileSync(path.join(f.skillDir, "SKILL.md"), "foreign skill\n", {
    mode: 0o640,
  });
  writeFileSync(
    path.join(f.skillDir, "nested", "data.txt"),
    "foreign nested data\n",
    { mode: 0o600 },
  );
  const beforeSkill = readFileSync(path.join(f.skillDir, "SKILL.md"));
  const beforeNested = readFileSync(
    path.join(f.skillDir, "nested", "data.txt"),
  );
  const beforeMode = statSync(path.join(f.skillDir, "SKILL.md")).mode & 0o777;

  const blocked = runInstaller(f, ["--skip-check"], 2);
  assert.match(blocked.stderr, /left untouched/);
  assert.deepEqual(
    readFileSync(path.join(f.skillDir, "SKILL.md")),
    beforeSkill,
  );
  assert.equal(
    existsSync(path.join(f.configDir, "image2.credentials.json")),
    false,
  );

  runInstaller(f, ["--skip-check", "--replace"]);
  assert.match(
    readFileSync(path.join(f.skillDir, "SKILL.md"), "utf8"),
    /name: beefapi-image2/,
  );
  const state = JSON.parse(
    readFileSync(path.join(f.configDir, "image2.install-state.json"), "utf8"),
  );
  assert.ok(state.backup_path);
  assert.ok(existsSync(state.backup_path));

  runWrapper(f, ["uninstall", "--purge-credentials"]);
  assert.deepEqual(
    readFileSync(path.join(f.skillDir, "SKILL.md")),
    beforeSkill,
  );
  assert.deepEqual(
    readFileSync(path.join(f.skillDir, "nested", "data.txt")),
    beforeNested,
  );
  assert.equal(
    statSync(path.join(f.skillDir, "SKILL.md")).mode & 0o777,
    beforeMode,
  );
  assertCodexCoreUntouched(f);
});

test("failed managed update restores the previous wrapper byte-for-byte", () => {
  const f = fixture();
  runInstaller(f, ["--skip-check"]);
  const wrapperBefore = readFileSync(f.wrapper);
  const wrapperModeBefore = statSync(f.wrapper).mode & 0o777;

  runInstaller(f, [], 1, {
    BEEFAPI_IMAGE2_API_KEY: "",
    BEEFAPI_IMAGE2_SKIP_CHECK: "0",
  });

  assert.deepEqual(readFileSync(f.wrapper), wrapperBefore);
  assert.equal(statSync(f.wrapper).mode & 0o777, wrapperModeBefore);
  runWrapper(f, ["doctor", "--offline"]);
  assertCodexCoreUntouched(f);
});

test("foreign wrapper is never overwritten and quoted home paths still work", () => {
  const blocked = fixture();
  writeFileSync(blocked.wrapper, "foreign command\n", { mode: 0o700 });
  runInstaller(blocked, ["--skip-check"], 2);
  assert.equal(readFileSync(blocked.wrapper, "utf8"), "foreign command\n");
  assert.equal(existsSync(blocked.skillDir), false);
  assertCodexCoreUntouched(blocked);

  const quoted = fixture({ apostrophe: true });
  runInstaller(quoted, ["--skip-check"]);
  runWrapper(quoted, ["doctor", "--offline"]);
  assertCodexCoreUntouched(quoted);
});

test("managed updates refuse locally modified skill and wrapper files", () => {
  const modifiedSkill = fixture();
  runInstaller(modifiedSkill, ["--skip-check"]);
  const skillPath = path.join(modifiedSkill.skillDir, "SKILL.md");
  const changedSkill = `${readFileSync(skillPath, "utf8")}\nlocal change\n`;
  writeFileSync(skillPath, changedSkill);
  runInstaller(modifiedSkill, ["--skip-check"], 2);
  assert.equal(readFileSync(skillPath, "utf8"), changedSkill);
  assertCodexCoreUntouched(modifiedSkill);

  const modifiedWrapper = fixture();
  runInstaller(modifiedWrapper, ["--skip-check"]);
  const changedWrapper = `${readFileSync(modifiedWrapper.wrapper, "utf8")}# local change\n`;
  writeFileSync(modifiedWrapper.wrapper, changedWrapper, { mode: 0o700 });
  runInstaller(modifiedWrapper, ["--skip-check"], 2);
  assert.equal(readFileSync(modifiedWrapper.wrapper, "utf8"), changedWrapper);
  assertCodexCoreUntouched(modifiedWrapper);
});

test("published installers are deterministic and contain no credential", () => {
  const check = spawnSync(
    process.execPath,
    [path.join(repoRoot, "build-installers.mjs"), "--check"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.equal(check.status, 0, check.stderr);
  const bash = readFileSync(installer, "utf8");
  const powershell = readFileSync(
    path.join(repoRoot, "install", "beefapi-codex-image2.ps1"),
    "utf8",
  );
  assert.doesNotMatch(bash + powershell, /sk-[A-Za-z0-9]/);
  assert.match(bash, /Contains no API key/);
  assert.match(powershell, /Contains no API key/);
});
