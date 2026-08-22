/*
 * BeefAPI Image2 request planner.
 * Maps natural-language size/ratio intent onto BeefAPI Image2 models and
 * their native pixel sizes. This file is the size-table SSOT.
 */

export const MODEL_GPT_IMAGE_2 = "gpt-image-2";
export const MODEL_FIREFLY = "gpt-image-2-firefly";
export const DEFAULT_MODEL = MODEL_GPT_IMAGE_2;
export const KNOWN_MODELS = [MODEL_GPT_IMAGE_2, MODEL_FIREFLY];

const MODEL_ALIASES = {
  "gpt-image-2": MODEL_GPT_IMAGE_2,
  image2: MODEL_GPT_IMAGE_2,
  "gpt-image2": MODEL_GPT_IMAGE_2,
  "gpt-image-2-firefly": MODEL_FIREFLY,
  "image2-firefly": MODEL_FIREFLY,
  "gpt-image2-firefly": MODEL_FIREFLY,
  firefly: MODEL_FIREFLY,
};

// BeefAPI gpt-image-2-firefly native table. Do not invent extra WxH here.
export const FIREFLY_SIZES = {
  "1:1": { "1k": "1024x1024", "2k": "2048x2048", "4k": "2880x2880" },
  "5:4": { "1k": "1120x896", "2k": "2240x1792", "4k": "3200x2560" },
  "4:3": { "1k": "1152x864", "2k": "2304x1728", "4k": "3264x2448" },
  "3:2": { "1k": "1248x832", "2k": "2496x1664", "4k": "3504x2336" },
  "16:9": { "1k": "1280x720", "2k": "2560x1440", "4k": "3840x2160" },
  "21:9": { "1k": "1456x624", "2k": "3024x1296", "4k": "3696x1584" },
  "4:5": { "1k": "896x1120", "2k": "1792x2240", "4k": "2560x3200" },
  "3:4": { "1k": "864x1152", "2k": "1728x2304", "4k": "2448x3264" },
  "2:3": { "1k": "832x1248", "2k": "1664x2496", "4k": "2336x3504" },
  "9:16": { "1k": "720x1280", "2k": "1440x2560", "4k": "2160x3840" },
};

export const GPT_IMAGE_2_SIZES = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

const TAOBAO_TARGETS = {
  "1:1": "1440x1440",
  "3:4": "1440x1920",
  "9:16": "1440x2560",
};

const TAOBAO_RATIOS = new Set(Object.keys(TAOBAO_TARGETS));

const SIZE_RE = /^(\d+)\s*[x×]\s*(\d+)$/i;
const ALLOWED_QUALITIES = new Set(["low", "medium", "high", "auto"]);
const ALLOWED_BACKGROUNDS = new Set(["transparent", "opaque", "auto"]);
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);

export function parseWxH(value) {
  const match = String(value || "")
    .trim()
    .match(SIZE_RE);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1) return null;
  return { width, height, size: `${width}x${height}` };
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

export function ratioOf(width, height) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function fireflySize(ratio, tier) {
  const row = FIREFLY_SIZES[ratio];
  if (!row) return null;
  return row[tier] || null;
}

function invertFireflyLookup() {
  const map = new Map();
  for (const [ratio, tiers] of Object.entries(FIREFLY_SIZES)) {
    for (const [tier, size] of Object.entries(tiers)) {
      map.set(size, { ratio, tier, model: MODEL_FIREFLY });
    }
  }
  return map;
}

const FIREFLY_BY_SIZE = invertFireflyLookup();

export function normalizeModel(value) {
  if (value == null || String(value).trim() === "") return null;
  const key = String(value).trim().toLowerCase();
  return MODEL_ALIASES[key] || null;
}

function detectRatio(text) {
  const source = String(text || "");
  const rules = [
    [/\b21\s*[:：xX×/]\s*9\b/, "21:9"],
    [/\b16\s*[:：xX×/]\s*9\b/, "16:9"],
    [/\b9\s*[:：xX×/]\s*16\b/, "9:16"],
    [/\b5\s*[:：xX×/]\s*4\b/, "5:4"],
    [/\b4\s*[:：xX×/]\s*5\b/, "4:5"],
    [/\b4\s*[:：xX×/]\s*3\b/, "4:3"],
    [/\b3\s*[:：xX×/]\s*4\b/, "3:4"],
    [/\b3\s*[:：xX×/]\s*2\b/, "3:2"],
    [/\b2\s*[:：xX×/]\s*3\b/, "2:3"],
    [/\b1\s*[:：xX×/]\s*1\b/, "1:1"],
    [/方图|正方形|square(?:\s+image)?/i, "1:1"],
    [/竖版详情|详情竖图/i, "3:4"],
    [/故事屏|全屏竖/i, "9:16"],
  ];
  for (const [pattern, ratio] of rules) {
    if (pattern.test(source)) return ratio;
  }
  return null;
}

function detectTier(text) {
  const source = String(text || "");
  if (/\b4k\b|四[kK]|超清/i.test(source)) return "4k";
  if (/\b2k\b|两[kK]|二[kK]/i.test(source)) return "2k";
  if (/\b1k\b/i.test(source)) return "1k";
  return null;
}

function detectTaobao(text) {
  return /淘系|淘宝|天猫|1440\s*底宽|底宽\s*1440/.test(String(text || ""));
}

function detect1440Canvas(text) {
  return /(?<!\d)1440(?!\d)/.test(String(text || ""));
}

export function rewriteCanvasPixels(prompt, fromWidth, toWidth) {
  const source = String(prompt || "");
  if (!fromWidth || !toWidth || fromWidth === toWidth) return source;
  const scale = fromWidth / toWidth;
  return source.replace(/(\d+(?:\.\d+)?)\s*(px|像素)/gi, (_, raw, unit) => {
    const scaled = Math.max(1, Math.round(Number(raw) * scale));
    const suffix = unit.toLowerCase() === "px" ? "px" : "像素";
    return `${scaled}${suffix}`;
  });
}

function replaceTargetCanvasSize(prompt, targetSize, nativeSize) {
  if (!targetSize || !nativeSize || targetSize === nativeSize) return prompt;
  const parsed = parseWxH(targetSize);
  if (!parsed) return prompt;
  const pattern = new RegExp(
    `\\b${parsed.width}\\s*[x×]\\s*${parsed.height}\\b`,
    "gi",
  );
  return String(prompt || "").replace(pattern, nativeSize);
}

function taobaoTarget(ratio, width = 1440) {
  if (ratio === "1:1") return `${width}x${width}`;
  if (ratio === "3:4") return `${width}x${Math.round((width * 4) / 3)}`;
  if (ratio === "9:16") return `${width}x${Math.round((width * 16) / 9)}`;
  return null;
}

function planError(message) {
  const error = new Error(message);
  error.code = "IMAGE2_PLAN";
  return error;
}

export function resolveImageRequest(input = {}) {
  const prompt = String(input.prompt || "").trim();
  const quality = String(input.quality || "auto").trim() || "auto";
  const background = input.background
    ? String(input.background).trim()
    : undefined;
  const outputFormat = String(input.outputFormat || "png").trim() || "png";
  const noResize = Boolean(input.noResize);
  const text = [prompt, input.size, input.targetSize, input.resolution, input.model]
    .filter(Boolean)
    .join("\n");

  if (!ALLOWED_QUALITIES.has(quality)) {
    throw planError(`Unsupported quality: ${quality}`);
  }
  if (background && !ALLOWED_BACKGROUNDS.has(background)) {
    throw planError(`Unsupported background: ${background}`);
  }
  if (!ALLOWED_FORMATS.has(outputFormat)) {
    throw planError(`Unsupported output format: ${outputFormat}`);
  }
  if (background === "transparent" && outputFormat === "jpeg") {
    throw planError("Transparent background requires png or webp output.");
  }

  const forcedModel = normalizeModel(input.model);
  if (input.model && !forcedModel) {
    throw planError(
      `Unknown model: ${input.model}. Use gpt-image-2 or gpt-image-2-firefly.`,
    );
  }

  const explicitSize = input.size ? parseWxH(input.size) : null;
  if (input.size && String(input.size).trim().toLowerCase() === "auto") {
    return {
      model: forcedModel || DEFAULT_MODEL,
      size: "auto",
      targetSize: null,
      quality,
      background,
      outputFormat,
      prompt,
      reason: "explicit-auto",
      resize: false,
      selectedBy: forcedModel ? "user-model" : "default",
    };
  }
  if (input.size && !explicitSize && String(input.size).trim().toLowerCase() !== "auto") {
    throw planError(`Unsupported size: ${input.size}`);
  }

  const explicitTarget = input.targetSize ? parseWxH(input.targetSize) : null;
  if (input.targetSize && !explicitTarget) {
    throw planError(`Unsupported target size: ${input.targetSize}`);
  }

  let ratio =
    (explicitSize && ratioOf(explicitSize.width, explicitSize.height)) ||
    (explicitTarget && ratioOf(explicitTarget.width, explicitTarget.height)) ||
    detectRatio(text) ||
    null;
  let tier = String(input.resolution || "").trim().toLowerCase() || detectTier(text);
  if (tier && !["1k", "2k", "4k"].includes(tier)) {
    throw planError(`Unsupported resolution: ${input.resolution}`);
  }

  const taobao =
    detectTaobao(text) ||
    explicitTarget?.width === 1440 ||
    detect1440Canvas(text);
  const targetWidth = explicitTarget?.width || (taobao ? 1440 : null);
  if (taobao && !ratio) ratio = "1:1";

  if (
    explicitSize &&
    GPT_IMAGE_2_SIZES[ratio] === explicitSize.size &&
    forcedModel !== MODEL_FIREFLY &&
    !taobao
  ) {
    return finalizePlan({
      model: MODEL_GPT_IMAGE_2,
      size: explicitSize.size,
      targetSize: explicitTarget?.size || null,
      quality,
      background,
      outputFormat,
      prompt,
      reason: `native-gpt-image-2-${ratio}`,
      selectedBy: forcedModel ? "user-model" : "size-table",
      noResize,
    });
  }

  if (explicitSize && FIREFLY_BY_SIZE.has(explicitSize.size)) {
    const hit = FIREFLY_BY_SIZE.get(explicitSize.size);
    const nativeSize = explicitSize.size;
    const targetSize = explicitTarget?.size || null;
    return finalizePlan({
      model: forcedModel || MODEL_FIREFLY,
      size: nativeSize,
      targetSize,
      quality,
      background,
      outputFormat,
      prompt,
      reason: `native-firefly-${hit.ratio}-${hit.tier}`,
      selectedBy: forcedModel ? "user-model" : "size-table",
      noResize,
    });
  }

  if (taobao || targetWidth === 1440) {
    const marketplaceRatio = TAOBAO_RATIOS.has(ratio) ? ratio : "1:1";
    if (!TAOBAO_RATIOS.has(marketplaceRatio)) {
      throw planError(
        "淘系图目前支持 1:1、3:4、9:16。请改比例或显式传入 --size。",
      );
    }
    const targetSize =
      explicitTarget?.size || taobaoTarget(marketplaceRatio, targetWidth || 1440);
    if (forcedModel === MODEL_GPT_IMAGE_2) {
      return finalizePlan({
        model: MODEL_GPT_IMAGE_2,
        size: GPT_IMAGE_2_SIZES[marketplaceRatio] || "1024x1024",
        targetSize,
        quality,
        background,
        outputFormat,
        prompt,
        reason: `taobao-forced-gpt-image-2-${marketplaceRatio}`,
        selectedBy: "user-model",
        noResize,
        warning:
          "gpt-image-2 cannot natively output 1440. Use gpt-image-2-firefly for 淘系 sizes.",
      });
    }
    const nativeSize = fireflySize(marketplaceRatio, tier || "2k");
    return finalizePlan({
      model: MODEL_FIREFLY,
      size: nativeSize,
      targetSize,
      quality,
      background,
      outputFormat,
      prompt,
      reason: `taobao-${marketplaceRatio}-${tier || "2k"}`,
      selectedBy: forcedModel ? "user-model" : "auto",
      noResize,
    });
  }

  if (explicitSize && forcedModel === MODEL_GPT_IMAGE_2) {
    return finalizePlan({
      model: MODEL_GPT_IMAGE_2,
      size: explicitSize.size,
      targetSize: explicitTarget?.size || null,
      quality,
      background,
      outputFormat,
      prompt,
      reason: "user-forced-gpt-image-2-size",
      selectedBy: "user-model",
      noResize,
      warning:
        explicitSize.size !== "1024x1024" &&
        explicitSize.size !== "1536x1024" &&
        explicitSize.size !== "1024x1536"
          ? "gpt-image-2 only reliably honors 1K square/3:2/2:3. Custom square sizes often snap to ~1254."
          : undefined,
    });
  }

  if (explicitSize && (forcedModel === MODEL_FIREFLY || FIREFLY_SIZES[ratio])) {
    if (!FIREFLY_SIZES[ratio]) {
      throw planError(
        `Unsupported firefly ratio ${ratio}. Use one of: ${Object.keys(FIREFLY_SIZES).join(", ")}.`,
      );
    }
    const nativeSize = fireflySize(ratio, tier || nearestFireflyTier(explicitSize));
    return finalizePlan({
      model: forcedModel || MODEL_FIREFLY,
      size: nativeSize,
      targetSize: explicitTarget?.size || explicitSize.size,
      quality,
      background,
      outputFormat,
      prompt,
      reason: `mapped-firefly-${ratio}`,
      selectedBy: forcedModel ? "user-model" : "auto",
      noResize,
    });
  }

  if (ratio && FIREFLY_SIZES[ratio] && (tier === "2k" || tier === "4k" || !GPT_IMAGE_2_SIZES[ratio])) {
    const chosenTier = tier || "1k";
    return finalizePlan({
      model: forcedModel || MODEL_FIREFLY,
      size: fireflySize(ratio, chosenTier),
      targetSize: explicitTarget?.size || null,
      quality,
      background,
      outputFormat,
      prompt,
      reason: `ratio-${ratio}-${chosenTier}`,
      selectedBy: forcedModel ? "user-model" : "auto",
      noResize,
    });
  }

  if (ratio && GPT_IMAGE_2_SIZES[ratio]) {
    return finalizePlan({
      model: forcedModel || MODEL_GPT_IMAGE_2,
      size: GPT_IMAGE_2_SIZES[ratio],
      targetSize: explicitTarget?.size || null,
      quality,
      background,
      outputFormat,
      prompt,
      reason: `gpt-image-2-${ratio}`,
      selectedBy: forcedModel ? "user-model" : "auto",
      noResize,
    });
  }

  return finalizePlan({
    model: forcedModel || DEFAULT_MODEL,
    size: "1024x1024",
    targetSize: explicitTarget?.size || null,
    quality,
    background,
    outputFormat,
    prompt,
    reason: "default-1k-square",
    selectedBy: forcedModel ? "user-model" : "default",
    noResize,
  });
}

function nearestFireflyTier(parsed) {
  const longEdge = Math.max(parsed.width, parsed.height);
  if (longEdge >= 2500) return "4k";
  if (longEdge >= 1400) return "2k";
  return "1k";
}

function finalizePlan(plan) {
  const native = parseWxH(plan.size);
  const target = plan.targetSize ? parseWxH(plan.targetSize) : null;
  const rewritten = replaceTargetCanvasSize(
    rewriteCanvasPixels(plan.prompt, native?.width, target?.width),
    plan.targetSize,
    plan.size,
  );
  const resize = Boolean(
    !plan.noResize && target && native && target.size !== native.size,
  );
  return {
    model: plan.model,
    size: plan.size,
    targetSize: target?.size || null,
    quality: plan.quality,
    background: plan.background,
    outputFormat: plan.outputFormat,
    prompt: rewritten,
    originalPrompt: plan.prompt,
    reason: plan.reason,
    selectedBy: plan.selectedBy,
    resize,
    warning: plan.warning,
  };
}
