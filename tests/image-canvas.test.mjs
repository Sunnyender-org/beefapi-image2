import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { canvasDeliveryMetadata, fitImageCanvas, imageDimensions, localCanvasTool } from "../scripts/image-canvas.mjs";

function png(width, height, alpha = false) {
  const chunk = (kind, bytes) => {
    const content = Buffer.concat([Buffer.from(kind), bytes]);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, content, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = alpha ? 6 : 2;
  const channels = alpha ? 4 : 3;
  const data = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * channels + 1) + 1 + x * channels;
    data[offset + (x < width / 2 ? 0 : 2)] = 255;
    if (alpha) data[offset + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(data)), chunk("IEND", Buffer.alloc(0))]);
}

test("image dimensions come from bytes and exact sizes keep bytes intact", () => {
  const image = png(200, 100);
  assert.deepEqual(imageDimensions(image), { width: 200, height: 100, alpha: false });
  assert.equal(fitImageCanvas(image, "200x100").bytes, image);
  assert.throws(() => fitImageCanvas(image, "100x100", { fit: "native" }), /Native dimensions/);
  assert.throws(() => fitImageCanvas(image, "999999x1"), /16 MP/);
  assert.equal(imageDimensions(Buffer.from("not an image")), null);
});

for (const target of ["100x50", "400x200", "200x100"]) {
  test(`no padding metadata for ${target} without a border`, { skip: !localCanvasTool("png") }, () => {
    const result = fitImageCanvas(png(200, 100), target);
    assert.equal("padding" in result.metadata, false);
    assert.equal(result.metadata.operation, target === "200x100" ? "native" : "resize");
  });
}

test("a real one-pixel sips rounding border remains reported", { skip: localCanvasTool("png") !== "sips" }, () => {
  const result = fitImageCanvas(png(201, 100), "100x50");
  assert.equal(result.metadata.padding, "white");
  assert.equal(result.metadata.operation, "pad");
});

for (const fit of ["pad", "crop"]) {
  test(`real local tool ${fit} fits exact pixels without stretching`, { skip: !localCanvasTool("png") }, () => {
    const result = fitImageCanvas(png(200, 100), "100x100", { fit });
    assert.equal(imageDimensions(result.bytes).width, 100);
    assert.equal(imageDimensions(result.bytes).height, 100);
    assert.equal(result.metadata.operation, fit);
    assert.equal(result.metadata.upscaled, false);
  });
  test(`non-square local ${fit} preserves width-height order`, { skip: !localCanvasTool("png") }, () => {
    const result = fitImageCanvas(png(200, 100), "128x72", { fit });
    assert.equal(imageDimensions(result.bytes).width, 128);
    assert.equal(imageDimensions(result.bytes).height, 72);
  });
}

test("delivery metadata retains prior fitting and interpolation", () => {
  const local = { source_size: "1440x1440", delivered_size: "1440x1440", fit: "pad", operation: "native", upscaled: false };
  const server = { source_size: "1024x1024", delivered_size: "1440x1440", fit: "pad", operation: "resize", upscaled: true };
  assert.deepEqual(canvasDeliveryMetadata(local, server), { ...server, verified_size: "1440x1440" });
  assert.throws(() => canvasDeliveryMetadata({ ...local, fit: "native" }, server), /native-only/);
});

test("alpha padding either preserves alpha or explicitly requires a capable tool", () => {
  const image = png(200, 100, true);
  if (!localCanvasTool("png", true)) {
    assert.throws(() => fitImageCanvas(image, "100x100"), /requires ImageMagick/);
  } else {
    const result = fitImageCanvas(image, "100x100");
    assert.equal(imageDimensions(result.bytes).alpha, true);
    assert.equal(result.metadata.padding, "transparent");
  }
});
