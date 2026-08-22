import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "scripts", "beefapi-image2.mjs");
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "beefapi-image2-cli-"));
const configDir = path.join(fixtureRoot, "config");
const codexHome = path.join(fixtureRoot, "codex");
const apiKey = "sk-test-image2-secret";
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xz4nGQAAAABJRU5ErkJggg==",
  "base64",
);
const requests = [];
let server;
let baseUrl;

function spawnCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        HOME: fixtureRoot,
        CODEX_HOME: codexHome,
        BEEFAPI_IMAGE2_CONFIG_DIR: options.configDir || configDir,
        BEEFAPI_IMAGE2_BASE_URL:
          options.useBaseUrlEnv === false ? "" : options.baseUrl || baseUrl,
        BEEFAPI_IMAGE2_API_KEY: options.withKey === false ? "" : apiKey,
        ...(options.env || {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(options.input || "");
  });
}

async function run(args, options = {}) {
  const result = await spawnCli(args, options);
  if (options.expectStatus === undefined) {
    assert.equal(
      result.status,
      0,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } else {
    assert.equal(
      result.status,
      options.expectStatus,
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

before(async () => {
  server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    });

    if (
      request.url === "/v1/models" ||
      request.url === "/v1/bad-json/models"
    ) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          data: [{ id: "gpt-image-2" }, { id: "gpt-image-2-firefly" }],
        }),
      );
      return;
    }
    if (request.url === "/v1/images/proxy-test") {
      response.setHeader("Content-Type", "image/png");
      response.end(tinyPng);
      return;
    }
    if (request.url === "/v1/images/generations") {
      const payload = JSON.parse(body.toString("utf8"));
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          data: [
            payload.prompt === "url-response"
              ? { url: "/v1/images/proxy-test" }
              : { b64_json: tinyPng.toString("base64") },
          ],
        }),
      );
      return;
    }
    if (request.url === "/v1/images/edits") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ data: [{ b64_json: tinyPng.toString("base64") }] }),
      );
      return;
    }
    if (request.url === "/v1/bad-json/images/generations") {
      response.statusCode = 200;
      response.end("not-json");
      return;
    }
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("setup validates the model, stores a private credential, and never prints the key", async () => {
  const result = await run(["setup"]);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(apiKey));
  const credentialPath = path.join(configDir, "image2.credentials.json");
  const credential = JSON.parse(readFileSync(credentialPath, "utf8"));
  assert.equal(credential.model, "gpt-image-2");
  assert.equal(credential.base_url, baseUrl);
  assert.equal(credential.api_key, apiKey);
  if (process.platform !== "win32") {
    assert.equal(statSync(credentialPath).mode & 0o077, 0);
  }
  const modelRequest = requests.find((request) => request.url === "/v1/models");
  assert.equal(modelRequest.headers.authorization, `Bearer ${apiKey}`);
});

test("generate enforces model/n=1 and writes b64_json output", async () => {
  const out = path.join(fixtureRoot, "generated.png");
  await run([
    "generate",
    "--prompt",
    "a tiny test image",
    "--out",
    out,
    "--response-format",
    "b64_json",
  ]);
  assert.deepEqual(readFileSync(out), tinyPng);
  const request = requests.find(
    (item) => item.url === "/v1/images/generations",
  );
  const payload = JSON.parse(request.body.toString("utf8"));
  assert.equal(payload.model, "gpt-image-2");
  assert.equal(payload.n, 1);
  assert.equal(payload.response_format, "b64_json");
  assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
});

test("generate accepts a signed-url-style response without forwarding Authorization", async () => {
  const out = path.join(fixtureRoot, "url-result.png");
  await run(["generate", "--prompt", "url-response", "--out", out]);
  assert.deepEqual(readFileSync(out), tinyPng);
  const proxyRequest = requests.find(
    (item) => item.url === "/v1/images/proxy-test",
  );
  assert.equal(proxyRequest.headers.authorization, undefined);
});

test("edit sends multipart image data with fixed model and n=1", async () => {
  const input = path.join(fixtureRoot, "input.png");
  const out = path.join(fixtureRoot, "edited.png");
  writeFileSync(input, tinyPng);
  await run([
    "edit",
    "--image",
    input,
    "--prompt",
    "change only the background",
    "--input-fidelity",
    "high",
    "--out",
    out,
  ]);
  assert.deepEqual(readFileSync(out), tinyPng);
  const request = requests.find((item) => item.url === "/v1/images/edits");
  assert.match(
    request.headers["content-type"],
    /^multipart\/form-data; boundary=/,
  );
  const body = request.body.toString("latin1");
  assert.match(body, /name="model"\r\n\r\ngpt-image-2/);
  assert.match(body, /name="n"\r\n\r\n1/);
  assert.match(body, /name="image"; filename="input.png"/);
  assert.match(body, /name="input_fidelity"\r\n\r\nhigh/);
});

test("dry-run needs no credential and n>1 fails before any network call", async () => {
  const beforeCount = requests.length;
  const dry = await run(
    [
      "generate",
      "--prompt",
      "dry",
      "--dry-run",
      "--out",
      path.join(fixtureRoot, "dry.png"),
    ],
    { withKey: false },
  );
  assert.match(dry.stdout, /"model": "gpt-image-2"/);
  assert.equal(requests.length, beforeCount);

  const taobao = await run(
    [
      "generate",
      "--prompt",
      "淘系主图，1440 方图，logo 200px",
      "--dry-run",
      "--out",
      path.join(fixtureRoot, "taobao.png"),
    ],
    { withKey: false },
  );
  assert.match(taobao.stdout, /"model": "gpt-image-2-firefly"/);
  assert.match(taobao.stdout, /"size": "2048x2048"/);
  assert.match(taobao.stdout, /"target_size": "1440x1440"/);
  assert.match(taobao.stdout, /284px/);
  assert.equal(requests.length, beforeCount);

  const forced = await run(
    [
      "generate",
      "--prompt",
      "淘系 1440 方图",
      "--model",
      "gpt-image-2",
      "--dry-run",
      "--out",
      path.join(fixtureRoot, "forced.png"),
    ],
    { withKey: false },
  );
  assert.match(forced.stdout, /"model": "gpt-image-2"/);
  assert.match(forced.stdout, /"size": "1024x1024"/);

  const invalid = await run(["generate", "--prompt", "bad", "--n", "2"], {
    expectStatus: 1,
  });
  assert.match(invalid.stderr, /requires --n 1/);
  assert.equal(requests.length, beforeCount);
});

test("invalid JSON and missing credentials fail clearly without leaking secrets", async () => {
  const isolated = path.join(fixtureRoot, "isolated-config");
  mkdirSync(isolated, { recursive: true });
  const missing = await spawnCli(["doctor", "--offline"], {
    configDir: isolated,
    withKey: false,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /FAIL  Credential file/);
  assert.doesNotMatch(missing.stdout + missing.stderr, /sk-test/);

  const badConfig = path.join(fixtureRoot, "bad-json-config");
  mkdirSync(badConfig, { recursive: true });
  writeFileSync(
    path.join(badConfig, "image2.credentials.json"),
    JSON.stringify({ api_key: apiKey, base_url: `${baseUrl}/bad-json` }),
    { mode: 0o600 },
  );
  const bad = await spawnCli(
    [
      "generate",
      "--prompt",
      "bad json",
      "--out",
      path.join(fixtureRoot, "bad.png"),
    ],
    { configDir: badConfig, withKey: false, useBaseUrlEnv: false },
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /invalid JSON/);
  assert.doesNotMatch(bad.stdout + bad.stderr, new RegExp(apiKey));
});
