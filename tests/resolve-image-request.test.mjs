import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODEL_FIREFLY,
  MODEL_GPT_IMAGE_2,
  resolveImageRequest,
  rewriteCanvasPixels,
} from "../scripts/resolve-image-request.mjs";

test("default request stays on cheap 1K gpt-image-2", () => {
  const plan = resolveImageRequest({ prompt: "一只玻璃小龙虾，白底" });
  assert.equal(plan.model, MODEL_GPT_IMAGE_2);
  assert.equal(plan.size, "1024x1024");
  assert.equal(plan.targetSize, null);
  assert.equal(plan.resize, false);
});

test("淘系 1440 方图 selects firefly 2K and a 1440 target", () => {
  const plan = resolveImageRequest({
    prompt: "淘系主图，1440 方图，白底，logo 200px",
  });
  assert.equal(plan.model, MODEL_FIREFLY);
  assert.equal(plan.size, "2048x2048");
  assert.equal(plan.targetSize, "1440x1440");
  assert.equal(plan.resize, true);
  assert.match(plan.prompt, /284px/);
});

test("9:16 1440 uses the native firefly size", () => {
  const plan = resolveImageRequest({
    prompt: "淘系 9:16 竖图，底宽 1440",
  });
  assert.equal(plan.model, MODEL_FIREFLY);
  assert.equal(plan.size, "1440x2560");
  assert.equal(plan.targetSize, "1440x2560");
  assert.equal(plan.resize, false);
});

test("3:4 1440 maps to firefly 2K then target 1440x1920", () => {
  const plan = resolveImageRequest({ prompt: "1440 底宽 3:4 详情图" });
  assert.equal(plan.model, MODEL_FIREFLY);
  assert.equal(plan.size, "1728x2304");
  assert.equal(plan.targetSize, "1440x1920");
  assert.equal(plan.resize, true);
});

test("user --model wins over auto firefly", () => {
  const plan = resolveImageRequest({
    prompt: "淘系 1440 方图",
    model: "gpt-image-2",
  });
  assert.equal(plan.model, MODEL_GPT_IMAGE_2);
  assert.equal(plan.size, "1024x1024");
  assert.equal(plan.targetSize, "1440x1440");
  assert.match(plan.warning, /firefly/);
});

test("explicit 1024x1024 stays on gpt-image-2", () => {
  const plan = resolveImageRequest({
    prompt: "plain mug",
    size: "1024x1024",
  });
  assert.equal(plan.model, MODEL_GPT_IMAGE_2);
  assert.equal(plan.size, "1024x1024");
});

test("explicit firefly native size is passed through", () => {
  const plan = resolveImageRequest({
    prompt: "wide banner",
    size: "2560x1440",
  });
  assert.equal(plan.model, MODEL_FIREFLY);
  assert.equal(plan.size, "2560x1440");
  assert.equal(plan.resize, false);
});

test("rewriteCanvasPixels scales logo hints", () => {
  assert.equal(rewriteCanvasPixels("logo 200px", 2048, 1440), "logo 284px");
  assert.equal(rewriteCanvasPixels("无尺寸", 2048, 1440), "无尺寸");
});
