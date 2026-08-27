import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODEL_FIREFLY,
  MODEL_GPT_IMAGE_2,
  MODEL_NANO_BANANA_2,
  MODEL_NANO_BANANA_PRO,
  MODEL_REMOVE_BG,
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

test("2K without a ratio uses firefly square", () => {
  const plan = resolveImageRequest({ prompt: "出一张2K的猫，产品摄影" });
  assert.equal(plan.model, MODEL_FIREFLY);
  assert.equal(plan.size, "2048x2048");
});

test("4K 16:9 uses firefly native 4K", () => {
  const plan = resolveImageRequest({ prompt: "4K 16:9 海报" });
  assert.equal(plan.model, MODEL_FIREFLY);
  assert.equal(plan.size, "3840x2160");
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

test("named Nano Banana Pro 4K ratio uses Leonardo native pixels", () => {
  const plan = resolveImageRequest({
    prompt: "用 Nano Banana Pro 出一张 4K 16:9 海报",
  });
  assert.equal(plan.model, MODEL_NANO_BANANA_PRO);
  assert.equal(plan.size, "5504x3072");
  assert.equal(plan.reason, "nano-banana-pro-16:9-4k");
});

test("named Nano Banana 2 defaults to a 1K square", () => {
  const plan = resolveImageRequest({ prompt: "用 Nano Banana 2 画一只猫" });
  assert.equal(plan.model, MODEL_NANO_BANANA_2);
  assert.equal(plan.size, "1024x1024");
});

test("background-removal intent selects the public cutout capability", () => {
  assert.equal(
    resolveImageRequest({ prompt: "给这张商品图抠图去背景", operation: "edit" }).model,
    MODEL_REMOVE_BG,
  );
});

test("utility requests preserve their non-pixel size contracts", () => {
  const remove = resolveImageRequest({
    prompt: "remove background",
    operation: "edit",
    model: "remove-bg",
    size: "full",
  });
  assert.equal(remove.model, MODEL_REMOVE_BG);
  assert.equal(remove.size, "full");
  assert.equal(remove.resize, false);

});
