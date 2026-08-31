/*
 * BeefAPI Image2 request planner.
 * Maps natural-language size/ratio intent onto BeefAPI Image2 models and
 * their native pixel sizes. This file is the size-table SSOT.
 */

export const MODEL_GPT_IMAGE_2 = "gpt-image-2";
export const MODEL_FIREFLY = "gpt-image-2-firefly";
export const MODEL_NANO_BANANA_2 = "nano-banana-2";
export const MODEL_NANO_BANANA_PRO = "nano-banana-pro";
export const MODEL_REMOVE_BG = "remove-bg";
export const DEFAULT_MODEL = MODEL_GPT_IMAGE_2;
export const KNOWN_MODELS = [
  MODEL_GPT_IMAGE_2,
  MODEL_FIREFLY,
  MODEL_NANO_BANANA_2,
  MODEL_NANO_BANANA_PRO,
  MODEL_REMOVE_BG,
];

export const UTILITY_MODELS = new Set([MODEL_REMOVE_BG]);

const MODEL_ALIASES = {
  "gpt-image-2": MODEL_GPT_IMAGE_2,
  image2: MODEL_GPT_IMAGE_2,
  "gpt-image2": MODEL_GPT_IMAGE_2,
  "gpt-image-2-firefly": MODEL_FIREFLY,
  "image2-firefly": MODEL_FIREFLY,
  "gpt-image2-firefly": MODEL_FIREFLY,
  firefly: MODEL_FIREFLY,
  "nano-banana-2": MODEL_NANO_BANANA_2,
  "nano banana 2": MODEL_NANO_BANANA_2,
  nanobanana2: MODEL_NANO_BANANA_2,
  "nano-banana-pro": MODEL_NANO_BANANA_PRO,
  "nano banana pro": MODEL_NANO_BANANA_PRO,
  nanobananapro: MODEL_NANO_BANANA_PRO,
  "gemini-image-2": MODEL_NANO_BANANA_PRO,
  "remove-bg": MODEL_REMOVE_BG,
  "remove background": MODEL_REMOVE_BG,
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

// Exact consumer-route outputs verified from image bytes, not only API metadata.
// Keep ratio defaults above unchanged; explicit pixels must not become a resize.
export const GPT_IMAGE_2_EXACT_SIZES = new Set([
  "1584x672", "2048x864", "3808x1632",
  "1376x768", "2048x1136", "3584x2016",
  "1264x848", "2048x1376", "3504x2336",
  "1200x896", "2048x1536", "3264x2448",
  "1152x928", "2048x1648", "3200x2560",
  "1024x1024", "2048x2048", "2880x2880",
  "928x1152", "1648x2048", "2560x3200",
  "896x1200", "1536x2048", "2448x3264",
  "848x1264", "1376x2048", "2336x3504",
  "768x1376", "1136x2048", "2016x3584",
  "1536x1024", "1024x1536", "1536x1536", "2048x1024",
]);

// Leonardo Nano Banana native pixels. Public model names stay provider-neutral;
// this table is used only when the caller explicitly names a Nano model.
export const NANO_BANANA_SIZES = {
  "21:9": { "1k": "1584x672", "2k": "3168x1344", "4k": "6336x2688" },
  "16:9": { "1k": "1376x768", "2k": "2752x1536", "4k": "5504x3072" },
  "3:2": { "1k": "1264x848", "2k": "2528x1696", "4k": "5056x3392" },
  "4:3": { "1k": "1200x896", "2k": "2400x1792", "4k": "4800x3584" },
  "5:4": { "1k": "1152x928", "2k": "2304x1856", "4k": "4608x3712" },
  "1:1": { "1k": "1024x1024", "2k": "2048x2048", "4k": "4096x4096" },
  "4:5": { "1k": "928x1152", "2k": "1856x2304", "4k": "3712x4608" },
  "3:4": { "1k": "896x1200", "2k": "1792x2400", "4k": "3584x4800" },
  "2:3": { "1k": "848x1264", "2k": "1696x2528", "4k": "3392x5056" },
  "9:16": { "1k": "768x1376", "2k": "1536x2752", "4k": "3072x5504" },
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

function detectNamedModel(text, operation) {
  const source = String(text || "");
  if (/nano[\s_-]*banana[\s_-]*pro|gemini[\s_-]*(?:image[\s_-]*)?2/i.test(source)) {
    return MODEL_NANO_BANANA_PRO;
  }
  if (/nano[\s_-]*banana(?:[\s_-]*2)?/i.test(source)) {
    return MODEL_NANO_BANANA_2;
  }
  if (/gpt[\s_-]*image[\s_-]*2[\s_-]*firefly|\bfirefly\b/i.test(source)) {
    return MODEL_FIREFLY;
  }
  if (operation === "edit") {
    if (/remove[\s_-]*(?:the[\s_-]*)?(?:bg|background)|去(?:除)?背景|抠图/i.test(source)) {
      return MODEL_REMOVE_BG;
    }
  }
  return null;
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
  const fit = input.noResize ? "native" : (input.fit || "pad");
  if (!["pad", "crop", "native"].includes(fit)) throw planError("fit must be pad, crop, or native.");
  const named = normalizeModel(input.model) || detectNamedModel(input.prompt, input.operation);
  const nativeNano = [MODEL_NANO_BANANA_2, MODEL_NANO_BANANA_PRO].includes(named)
    && Object.values(NANO_BANANA_SIZES).some(row => Object.values(row).includes(parseWxH(input.size)?.size));
  for (const value of [input.size, input.targetSize]) {
    if (nativeNano && value === input.size) continue;
    const pixels = parseWxH(value);
    if (pixels && (Math.max(pixels.width, pixels.height) > 8192 || pixels.width * pixels.height > 16777216)) {
      throw planError("Output canvas must be at most 8192 pixels per edge and 16 MP.");
    }
  }
  const plan = resolvePlan(input);
  if (UTILITY_MODELS.has(plan.model)) return plan;
  if (fit === "native" && plan.resize) throw planError("Native-only output cannot also request a resized target canvas.");
  return {
    ...plan,
    fit,
    requestedSize: input.noResize ? (parseWxH(input.size)?.size || null)
      : (plan.targetSize || parseWxH(input.size)?.size || null),
  };
}

function resolvePlan(input = {}) {
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
      `Unknown model: ${input.model}. Use one of: ${KNOWN_MODELS.join(", ")}.`,
    );
  }
  const inferredModel = detectNamedModel(prompt, input.operation);
  const selectedModel = forcedModel || inferredModel;

  if (selectedModel && UTILITY_MODELS.has(selectedModel)) {
    if (input.operation && input.operation !== "edit") {
      throw planError(`${selectedModel} is an edit-only model.`);
    }
    const rawSize = String(input.size || "").trim().toLowerCase();
    const size = rawSize || "auto";
    if (!["auto", "preview", "full", "50mp"].includes(size)) {
      throw planError("remove-bg size must be auto, preview, full, or 50mp.");
    }
    return {
      model: selectedModel,
      size,
      targetSize: null,
      quality: "auto",
      background,
      outputFormat,
      prompt,
      originalPrompt: prompt,
      reason: "remove-bg-edit",
      selectedBy: forcedModel ? "user-model" : "utility-intent",
      resize: false,
    };
  }

  const explicitSize = input.size ? parseWxH(input.size) : null;
  if (input.size && String(input.size).trim().toLowerCase() === "auto") {
    return {
      model: selectedModel || DEFAULT_MODEL,
      size: "auto",
      targetSize: null,
      quality,
      background,
      outputFormat,
      prompt,
      reason: "explicit-auto",
      resize: false,
      selectedBy: forcedModel ? "user-model" : inferredModel ? "named-model" : "default",
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
  if ((tier === "2k" || tier === "4k") && !ratio) ratio = "1:1";

  if (
    selectedModel === MODEL_NANO_BANANA_2 ||
    selectedModel === MODEL_NANO_BANANA_PRO
  ) {
    const nativeNano = Object.entries(NANO_BANANA_SIZES).flatMap(([ratio, tiers]) =>
      Object.entries(tiers).map(([tier, size]) => ({ ratio, tier, size })))
      .find(entry => entry.size === explicitSize?.size);
    const nanoRatio = nativeNano?.ratio || (ratio && NANO_BANANA_SIZES[ratio] ? ratio : "1:1");
    if (ratio && !nativeNano && !NANO_BANANA_SIZES[ratio]) {
      throw planError(
        `Unsupported Nano Banana ratio ${ratio}. Use one of: ${Object.keys(NANO_BANANA_SIZES).join(", ")}.`,
      );
    }
    const nanoTier = tier || nativeNano?.tier || (explicitSize ? nearestNanoTier(explicitSize) : "1k");
    const nativeSize = NANO_BANANA_SIZES[nanoRatio][nanoTier];
    return finalizePlan({
      model: selectedModel,
      size: nativeSize,
      targetSize:
        explicitTarget?.size ||
        (explicitSize && explicitSize.size !== nativeSize ? explicitSize.size : null),
      quality,
      background,
      outputFormat,
      prompt,
      reason: `${selectedModel}-${nanoRatio}-${nanoTier}`,
      selectedBy: forcedModel ? "user-model" : "named-model",
      noResize,
    });
  }

  if (
    explicitSize &&
    selectedModel !== MODEL_FIREFLY
  ) {
    return finalizePlan({
      model: MODEL_GPT_IMAGE_2,
      size: explicitSize.size,
      targetSize: explicitTarget?.size || null,
      quality,
      background,
      outputFormat,
      prompt,
      reason: GPT_IMAGE_2_EXACT_SIZES.has(explicitSize.size)
        ? `native-gpt-image-2-${ratio}` : "gpt-image-2-output-canvas",
      selectedBy: forcedModel ? "user-model" : "size-table",
      noResize,
      warning: GPT_IMAGE_2_EXACT_SIZES.has(explicitSize.size) ? undefined
        : "Exact output pixels requested: the Leonardo channel may fit a supported generation with padding or explicit cropping; this is not a native-size guarantee.",
    });
  }

  if (explicitSize && FIREFLY_BY_SIZE.has(explicitSize.size)) {
    const hit = FIREFLY_BY_SIZE.get(explicitSize.size);
    const nativeSize = explicitSize.size;
    const targetSize = explicitTarget?.size || null;
    return finalizePlan({
      model: selectedModel || MODEL_FIREFLY,
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
    if (selectedModel === MODEL_GPT_IMAGE_2) {
      return finalizePlan({
        model: MODEL_GPT_IMAGE_2,
        size: noResize ? (GPT_IMAGE_2_SIZES[marketplaceRatio] || "1024x1024") : targetSize,
        targetSize: noResize ? null : targetSize,
        quality,
        background,
        outputFormat,
        prompt,
        reason: `taobao-forced-gpt-image-2-${marketplaceRatio}`,
        selectedBy: "user-model",
        noResize,
        warning:
          "The Leonardo channel can fit the requested canvas; this is not a native 1440 generation guarantee.",
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

  if (explicitSize && (selectedModel === MODEL_FIREFLY || FIREFLY_SIZES[ratio])) {
    if (!FIREFLY_SIZES[ratio]) {
      throw planError(
        `Unsupported firefly ratio ${ratio}. Use one of: ${Object.keys(FIREFLY_SIZES).join(", ")}.`,
      );
    }
    const nativeSize = fireflySize(ratio, tier || nearestFireflyTier(explicitSize));
    return finalizePlan({
      model: selectedModel || MODEL_FIREFLY,
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
      model: selectedModel || MODEL_FIREFLY,
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
      model: selectedModel || MODEL_GPT_IMAGE_2,
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
      model: selectedModel || DEFAULT_MODEL,
    size: "1024x1024",
    targetSize: explicitTarget?.size || null,
    quality,
    background,
    outputFormat,
    prompt,
    reason: "default-1k-square",
      selectedBy: forcedModel ? "user-model" : inferredModel ? "named-model" : "default",
    noResize,
  });
}

function nearestFireflyTier(parsed) {
  const longEdge = Math.max(parsed.width, parsed.height);
  if (longEdge >= 2500) return "4k";
  if (longEdge >= 1400) return "2k";
  return "1k";
}

function nearestNanoTier(parsed) {
  const longEdge = Math.max(parsed.width, parsed.height);
  if (longEdge >= 3500) return "4k";
  if (longEdge >= 1800) return "2k";
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
