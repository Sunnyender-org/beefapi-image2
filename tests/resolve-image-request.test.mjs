import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODEL_FIREFLY,
  MODEL_GPT_IMAGE_2,
  MODEL_NANO_BANANA_2,
  MODEL_NANO_BANANA_PRO,
  MODEL_REMOVE_BG,
  GPT_IMAGE_2_EXACT_SIZES,
  resolveImageRequest,
  rewriteCanvasPixels,
} from "../scripts/resolve-image-request.mjs";

test("all 34 Leonardo native pairs avoid a false fitting warning", () => {
  assert.equal(GPT_IMAGE_2_EXACT_SIZES.size, 34);
  for (const size of GPT_IMAGE_2_EXACT_SIZES) {
    const plan = resolveImageRequest({ prompt: "cup", size });
    assert.match(plan.reason, /^native-gpt-image-2/);
    assert.equal(plan.warning, undefined);
    assert.equal(plan.size, size);
  }
});

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
  assert.equal(plan.size, "1440x1440");
  assert.equal(plan.targetSize, "1440x1440");
  assert.match(plan.warning, /canvas/);
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

for (const size of ["1536x1024", "1024x1536", "1536x1536", "2048x1024"]) {
  for (const operation of ["generate", "edit"]) {
    test(`${operation} preserves verified exact pixels ${size}`, () => {
      const prompt = `画一张 ${size} 的蓝色陶瓷杯，背景浅绿`;
      const plan = resolveImageRequest({ prompt, size, operation });
      assert.equal(plan.model, MODEL_GPT_IMAGE_2);
      assert.equal(plan.size, size);
      assert.equal(plan.prompt, prompt);
      assert.equal(plan.resize, false);
      assert.equal(plan.targetSize, null);
    });
  }
}

test("exact pixels do not override an explicit model or target", () => {
  const firefly = resolveImageRequest({ prompt: "cup", model: "firefly", size: "1536x1536" });
  assert.equal(firefly.model, MODEL_FIREFLY);
  assert.equal(firefly.targetSize, "1536x1536");
  const nano = resolveImageRequest({ prompt: "Nano Banana 2 cup", size: "1536x1536" });
  assert.equal(nano.model, MODEL_NANO_BANANA_2);
  const target = resolveImageRequest({ prompt: "cup", size: "2048x1024", targetSize: "1000x500" });
  assert.equal(target.size, "2048x1024");
  assert.equal(target.targetSize, "1000x500");
  assert.equal(target.resize, true);
});

test("explicit verified pixels win over marketplace size defaults", () => {
  const plan = resolveImageRequest({ prompt: "淘系主图，1536x1536，logo 200px", size: "1536x1536" });
  assert.equal(plan.model, MODEL_GPT_IMAGE_2);
  assert.equal(plan.size, "1536x1536");
  assert.equal(plan.targetSize, null);
  assert.equal(plan.resize, false);
});

test("4K 16:9 uses firefly native 4K", () => {
  const plan = resolveImageRequest({ prompt: "4K 16:9 海报" });
  assert.equal(plan.model, MODEL_FIREFLY);
  assert.equal(plan.size, "3840x2160");
});

test("explicit firefly model preserves its native size", () => {
  const plan = resolveImageRequest({
    prompt: "wide banner",
    model: "firefly",
    size: "2560x1440",
  });
  assert.equal(plan.model, MODEL_FIREFLY);
  assert.equal(plan.size, "2560x1440");
  assert.equal(plan.resize, false);
});

for (const size of ["1440x1440", "1280x720", "1920x1088", "1000x333", "3840x2160"]) {
  test(`arbitrary explicit canvas ${size} stays on the public Image2 model`, () => {
    const plan = resolveImageRequest({ prompt: `画一张${size}海报`, size });
    assert.equal(plan.model, MODEL_GPT_IMAGE_2);
    assert.equal(plan.size, size);
    assert.equal(plan.requestedSize, size);
    assert.equal(plan.fit, "pad");
    assert.equal(plan.resize, false);
  });
}

test("canvas fit is explicit, bounded, and native-only is preserved", () => {
  assert.equal(resolveImageRequest({ prompt: "cup", size: "1000x333", fit: "crop" }).fit, "crop");
  assert.equal(resolveImageRequest({ prompt: "cup", size: "1000x333", noResize: true }).fit, "native");
  assert.throws(() => resolveImageRequest({ prompt: "cup", fit: "stretch" }), /fit/);
  assert.throws(() => resolveImageRequest({ prompt: "cup", size: "999999x999999" }), /16 MP/);
  assert.throws(() => resolveImageRequest({ prompt: "cup", size: "1536x1536", targetSize: "1000x1000", fit: "native" }), /Native-only/);
  const nano = resolveImageRequest({ prompt: "cup", model: "nano-banana-2", size: "5504x3072" });
  assert.equal(nano.size, "5504x3072");
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
