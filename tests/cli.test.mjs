import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
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
const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
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
          data: [
            { id: "gpt-image-2" },
            { id: "gpt-image-2-firefly" },
            { id: "nano-banana-2" },
            { id: "nano-banana-pro" },
            { id: "remove-bg" },
          ],
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
              : {
                  b64_json: (payload.prompt === "jpeg-response"
                    ? tinyJpeg
                    : tinyPng
                  ).toString("base64"),
                },
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

test("exact canvas options reach both API routes and output pixels are verified", async () => {
  const generated = await run(["generate", "--prompt", "cup", "--size", "1x1", "--fit", "pad",
    "--out", path.join(fixtureRoot, "exact-generated.png")]);
  assert.match(generated.stdout, /Verified canvas/);
  const payload = JSON.parse(requests.findLast(r => r.url === "/v1/images/generations").body);
  assert.equal(payload.extra_fields, undefined, "default fitting must not add provider-specific options");
  const ref = path.join(fixtureRoot, "canvas-ref.png");
  writeFileSync(ref, tinyPng);
  await run(["edit", "--image", ref, "--prompt", "change background", "--size", "1x1", "--fit", "crop",
    "--out", path.join(fixtureRoot, "exact-edited.png")]);
  const multipart = requests.findLast(r => r.url === "/v1/images/edits").body.toString();
  assert.match(multipart, /name="extra_fields"\r\n\r\n\{"image_canvas":\{"fit":"crop"\}\}/);
});

test("native mismatch saves original, reports failure, and never generates twice", async () => {
  const beforeCount = requests.filter(r => r.url === "/v1/images/generations").length;
  const result = await run(["generate", "--prompt", "cup", "--size", "100x100", "--fit", "native",
    "--out", path.join(fixtureRoot, "mismatch.png")], { expectStatus: 1 });
  assert.match(result.stderr, /target size is NOT complete/);
  assert.match(result.stderr, /Do not regenerate/);
  assert.equal(existsSync(path.join(fixtureRoot, "mismatch.png")), false);
  assert.deepEqual(readFileSync(path.join(fixtureRoot, "mismatch.native.png")), tinyPng);
  assert.equal(requests.filter(r => r.url === "/v1/images/generations").length - beforeCount, 1);
});

test("oversized canvas fails before any HTTP request", async () => {
  const beforeCount = requests.length;
  await run(["generate", "--prompt", "cup", "--size", "9000x9000"], { expectStatus: 1 });
  assert.equal(requests.length, beforeCount);
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

test("setup accepts --api-key without env and does not print it", async () => {
  const isolated = path.join(fixtureRoot, "flag-key-config");
  mkdirSync(isolated, { recursive: true });
  const flagKey = "sk-flag-image2-key";
  const beforeCount = requests.length;
  const result = await run(["setup", "--api-key", flagKey], {
    withKey: false,
    configDir: isolated,
  });
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(flagKey));
  const credential = JSON.parse(
    readFileSync(path.join(isolated, "image2.credentials.json"), "utf8"),
  );
  assert.equal(credential.api_key, flagKey);
  const modelRequest = requests.slice(beforeCount).find(
    (request) => request.url === "/v1/models",
  );
  assert.equal(modelRequest.headers.authorization, `Bearer ${flagKey}`);
});

test("setup migrates the retired api.beefapi.com host", async () => {
  const isolated = path.join(fixtureRoot, "legacy-setup-config");
  mkdirSync(isolated, { recursive: true });
  await run(["setup", "--skip-check"], {
    configDir: isolated,
    baseUrl: "https://api.beefapi.com/v1",
  });
  const credential = JSON.parse(
    readFileSync(path.join(isolated, "image2.credentials.json"), "utf8"),
  );
  assert.equal(credential.base_url, "https://beefapi.com/v1");
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
  const request = requests.findLast(
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

test("generate corrects a misleading requested extension from actual image bytes", async () => {
  const requested = path.join(fixtureRoot, "leonardo-output.png");
  const actual = path.join(fixtureRoot, "leonardo-output.jpg");
  const result = await run([
    "generate",
    "--prompt",
    "jpeg-response",
    "--output-format",
    "png",
    "--out",
    requested,
  ]);
  assert.equal(existsSync(requested), false);
  assert.deepEqual(readFileSync(actual), tinyJpeg);
  assert.match(result.stdout, /returned JPEG; writing .*\.jpg instead/);
});

test("generate forwards the GPT Image 2 transparent-background contract", async () => {
  const out = path.join(fixtureRoot, "transparent.png");
  await run([
    "generate",
    "--prompt",
    "a reusable product cutout",
    "--background",
    "transparent",
    "--output-format",
    "png",
    "--out",
    out,
  ]);
  assert.deepEqual(readFileSync(out), tinyPng);
  const request = requests.find(
    (item) => item.url === "/v1/images/generations" &&
      item.body.toString("utf8").includes("a reusable product cutout"),
  );
  const payload = JSON.parse(request.body.toString("utf8"));
  assert.equal(payload.model, "gpt-image-2");
  assert.equal(payload.background, "transparent");
  assert.equal(payload.output_format, "png");
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
    "--background",
    "transparent",
    "--output-format",
    "webp",
    "--out",
    out,
  ]);
  assert.deepEqual(readFileSync(out), tinyPng);
  const request = requests.findLast((item) => item.url === "/v1/images/edits");
  assert.match(
    request.headers["content-type"],
    /^multipart\/form-data; boundary=/,
  );
  const body = request.body.toString("latin1");
  assert.match(body, /name="model"\r\n\r\ngpt-image-2/);
  assert.match(body, /name="n"\r\n\r\n1/);
  assert.match(body, /name="image"; filename="input.png"/);
  assert.match(body, /name="input_fidelity"\r\n\r\nhigh/);
  assert.match(body, /name="background"\r\n\r\ntransparent/);
  assert.match(body, /name="output_format"\r\n\r\nwebp/);
});

test("utility edit forwards remove-bg parameters from natural language", async () => {
  const input = path.join(fixtureRoot, "utility-input.png");
  writeFileSync(input, tinyPng);

  const beforeRemove = requests.length;
  await run([
    "edit",
    "--image",
    input,
    "--prompt",
    "给商品抠图",
    "--size",
    "full",
    "--channels",
    "alpha",
    "--foreground-type",
    "product",
    "--crop",
    "true",
    "--semitransparency",
    "false",
    "--shadow-opacity",
    "35",
    "--shadow-type",
    "drop",
    "--out",
    path.join(fixtureRoot, "cutout.png"),
  ]);
  const removeRequest = requests.slice(beforeRemove).find(
    (item) => item.url === "/v1/images/edits",
  );
  const removeBody = removeRequest.body.toString("latin1");
  assert.match(removeBody, /name="model"\r\n\r\nremove-bg/);
  assert.match(removeBody, /name="size"\r\n\r\nfull/);
  assert.match(removeBody, /name="channels"\r\n\r\nalpha/);
  assert.match(removeBody, /name="type"\r\n\r\nproduct/);
  assert.match(removeBody, /name="crop"\r\n\r\ntrue/);
  assert.match(removeBody, /name="semitransparency"\r\n\r\nfalse/);
  assert.match(removeBody, /name="shadow_opacity"\r\n\r\n35/);
  assert.match(removeBody, /name="shadow_type"\r\n\r\ndrop/);

});

test("utility edits require exactly one reference image", async () => {
  const input = path.join(fixtureRoot, "single-utility-input.png");
  writeFileSync(input, tinyPng);
  const result = await run(
    [
      "edit",
      "--image",
      input,
      "--image",
      input,
      "--prompt",
      "remove background",
      "--out",
      path.join(fixtureRoot, "invalid-cutout.png"),
    ],
    { expectStatus: 1 },
  );
  assert.match(result.stderr, /requires exactly one --image/);
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
  assert.match(forced.stdout, /"size": "1440x1440"/);

  const invalid = await run(["generate", "--prompt", "bad", "--n", "2"], {
    expectStatus: 1,
  });
  assert.match(invalid.stderr, /requires --n 1/);

  const transparentJpeg = await run(
    [
      "generate",
      "--prompt",
      "transparent asset",
      "--background",
      "transparent",
      "--output-format",
      "jpeg",
    ],
    { expectStatus: 1 },
  );
  assert.match(
    transparentJpeg.stderr,
    /Transparent background requires png or webp output/,
  );
  assert.equal(requests.length, beforeCount);
});

test("generate uses Codex BeefAPI auth.json without a dedicated setup file", async () => {
  const isolatedCodex = path.join(fixtureRoot, "codex-beefapi");
  mkdirSync(isolatedCodex, { recursive: true });
  writeFileSync(
    path.join(isolatedCodex, "config.toml"),
    [
      'model_provider = "beefapi"',
      "",
      "[model_providers.beefapi]",
      'name = "beefapi"',
      `base_url = "${baseUrl}"`,
      'wire_api = "responses"',
      "requires_openai_auth = true",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(isolatedCodex, "auth.json"),
    `${JSON.stringify({ OPENAI_API_KEY: apiKey })}\n`,
  );
  const isolated = path.join(fixtureRoot, "codex-only-config");
  mkdirSync(isolated, { recursive: true });
  const out = path.join(fixtureRoot, "from-codex.png");
  const beforeCount = requests.length;
  await run(
    ["generate", "--prompt", "codex key", "--out", out, "--response-format", "b64_json"],
    {
      withKey: false,
      configDir: isolated,
      useBaseUrlEnv: false,
      env: { CODEX_HOME: isolatedCodex },
    },
  );
  assert.equal(existsSync(path.join(isolated, "image2.credentials.json")), false);
  const request = requests.slice(beforeCount).find(
    (item) => item.url === "/v1/images/generations",
  );
  assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
  const payload = JSON.parse(request.body.toString("utf8"));
  assert.equal(payload.model, "gpt-image-2");
});

test("offline doctor migrates retired hosts from dedicated and Codex credentials", async () => {
  const dedicated = path.join(fixtureRoot, "legacy-dedicated-config");
  const dedicatedCodex = path.join(fixtureRoot, "legacy-dedicated-codex-home");
  mkdirSync(dedicated, { recursive: true });
  mkdirSync(path.join(dedicatedCodex, "skills", "beefapi-image2"), {
    recursive: true,
  });
  writeFileSync(
    path.join(dedicatedCodex, "skills", "beefapi-image2", "SKILL.md"),
    "---\nname: beefapi-image2\ndescription: test fixture\n---\n",
  );
  writeFileSync(
    path.join(dedicated, "image2.credentials.json"),
    JSON.stringify({
      api_key: apiKey,
      base_url: "https://api.beefapi.com/v1",
    }),
    { mode: 0o600 },
  );
  const dedicatedDoctor = await run(["doctor", "--offline"], {
    configDir: dedicated,
    withKey: false,
    useBaseUrlEnv: false,
    env: { CODEX_HOME: dedicatedCodex },
  });
  assert.match(
    dedicatedDoctor.stdout,
    /PASS  API base URL: https:\/\/beefapi\.com\/v1/,
  );

  const legacyCodex = path.join(fixtureRoot, "legacy-codex-home");
  const codexOnlyConfig = path.join(fixtureRoot, "legacy-codex-only-config");
  mkdirSync(legacyCodex, { recursive: true });
  mkdirSync(codexOnlyConfig, { recursive: true });
  mkdirSync(path.join(legacyCodex, "skills", "beefapi-image2"), {
    recursive: true,
  });
  writeFileSync(
    path.join(legacyCodex, "skills", "beefapi-image2", "SKILL.md"),
    "---\nname: beefapi-image2\ndescription: test fixture\n---\n",
  );
  writeFileSync(
    path.join(legacyCodex, "config.toml"),
    [
      'model_provider = "beefapi"',
      "",
      "[model_providers.beefapi]",
      'name = "beefapi"',
      'base_url = "https://api.beefapi.com/v1"',
      'env_key = "OPENAI_API_KEY"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(legacyCodex, "auth.json"),
    `${JSON.stringify({ OPENAI_API_KEY: apiKey })}\n`,
  );
  const codexDoctor = await run(["doctor", "--offline"], {
    configDir: codexOnlyConfig,
    withKey: false,
    useBaseUrlEnv: false,
    env: { CODEX_HOME: legacyCodex },
  });
  assert.match(
    codexDoctor.stdout,
    /PASS  API base URL: https:\/\/beefapi\.com\/v1/,
  );
});

test("network failures identify the host and low-level cause without leaking the key", async () => {
  const isolated = path.join(fixtureRoot, "network-error-config");
  mkdirSync(isolated, { recursive: true });
  const result = await spawnCli(
    ["generate", "--prompt", "network diagnostic", "--out", path.join(fixtureRoot, "network.png")],
    {
      configDir: isolated,
      baseUrl: "http://127.0.0.1:65534/v1",
    },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Network request to 127\.0\.0\.1 failed: fetch failed/,
  );
  assert.match(result.stderr, /ECONNREFUSED|connection refused/i);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(apiKey));
});

test("invalid JSON and missing credentials fail clearly without leaking secrets", async () => {
  const isolated = path.join(fixtureRoot, "isolated-config");
  mkdirSync(isolated, { recursive: true });
  const missing = await spawnCli(["doctor", "--offline"], {
    configDir: isolated,
    withKey: false,
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /FAIL {2}BeefAPI key/);
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
