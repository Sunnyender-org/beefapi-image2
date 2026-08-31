import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Read real image headers, never infer dimensions from the request or filename.
export function imageDimensions(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20),
      alpha: [4, 6].includes(bytes[25]) || bytes.includes(Buffer.from("tRNS")) };
  }
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), alpha: true };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if ([0xd8, 0x01].includes(marker) || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 8) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), alpha: false };
      }
      offset += length;
    }
  }
  if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1, alpha: Boolean(bytes[20] & 16) };
    if (kind === "VP8L" && bytes[20] === 47) {
      const packed = bytes.readUInt32LE(21);
      return { width: (packed & 16383) + 1, height: ((packed >>> 14) & 16383) + 1, alpha: Boolean(packed & 0x10000000) };
    }
    if (kind === "VP8 " && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return { width: bytes.readUInt16LE(26) & 16383, height: bytes.readUInt16LE(28) & 16383, alpha: false };
    }
  }
  return null;
}

function available(bin) {
  const result = spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 5000 });
  return !result.error && result.status === 0;
}

export function localCanvasTool(format, alpha = false) {
  if (available("magick")) return "magick";
  if (process.platform !== "win32" && available("convert")) return "convert";
  if (process.platform === "darwin" && format !== "webp" && !alpha) return "sips";
  return null;
}

export function fitImageCanvas(bytes, target, { fit = "pad", format = "png" } = {}) {
  const source = imageDimensions(bytes);
  const parsed = /^(\d+)x(\d+)$/.exec(target || "");
  if (!source || !parsed) throw new Error("Cannot verify the image or target dimensions.");
  const [width, height] = parsed.slice(1).map(Number);
  const metadata = { source_size: `${source.width}x${source.height}`, delivered_size: target, operation: "native", upscaled: false };
  if (source.width > 0 && source.height > 0 && metadata.source_size === target) return { bytes, metadata };
  if (![source.width, source.height, width, height].every(v => Number.isInteger(v) && v > 0 && v <= 8192)
      || width * height > 16777216 || source.width * source.height > 16777216) {
    throw new Error("Canvas processing is limited to 8192 pixels per edge and 16 MP.");
  }
  if (!["pad", "crop", "native"].includes(fit)) throw new Error("Invalid canvas fit.");
  if (fit === "native") throw new Error(`Native dimensions ${metadata.source_size} differ from requested ${target}.`);
  const tool = localCanvasTool(format, source.alpha);
  if (!tool) throw new Error("Exact canvas fitting requires ImageMagick (or macOS sips for opaque PNG/JPEG).");
  const temp = mkdtempSync(path.join(os.tmpdir(), "beefapi-image2-canvas-"));
  const input = path.join(temp, "input");
  const output = path.join(temp, `output.${format === "jpeg" ? "jpg" : format}`);
  try {
    writeFileSync(input, bytes, { mode: 0o600 });
    const scale = (fit === "crop" ? Math.max : Math.min)(width / source.width, height / source.height);
    const run = (bin, args) => {
      const result = spawnSync(bin, args, { stdio: "ignore", timeout: 60000 });
      if (result.error || result.status !== 0) throw new Error("Local canvas processing failed.");
    };
    if (tool === "sips") {
      const longEdge = (fit === "crop" ? Math.ceil : Math.floor)(Math.max(source.width, source.height) * scale);
      run(tool, ["-Z", String(Math.max(1, longEdge)), "-s", "format", format, input, "--out", output]);
      run(tool, [fit === "crop" ? "--cropToHeightWidth" : "--padToHeightWidth", String(height), String(width),
        ...(fit === "pad" ? ["--padColor", "FFFFFF"] : []), output]);
    } else {
      run(tool, [input, "-auto-orient", "-resize", `${width}x${height}${fit === "crop" ? "^" : ""}`,
        "-background", source.alpha && format !== "jpeg" ? "none" : "white",
        "-gravity", "center", "-extent", target, output]);
    }
    if (!existsSync(output)) throw new Error("Local canvas output is missing.");
    const fitted = readFileSync(output);
    const actual = imageDimensions(fitted);
    if (!actual || actual.width !== width || actual.height !== height) throw new Error("Local canvas output dimensions do not match.");
    metadata.operation = source.width * height === source.height * width ? "resize" : fit;
    metadata.upscaled = scale > 1;
    if (fit === "pad") metadata.padding = source.alpha ? "transparent" : "white";
    return { bytes: fitted, metadata };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
