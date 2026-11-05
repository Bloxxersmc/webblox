// Roblox binary models (.rbxm/.rbxl) store each chunk compressed with LZ4 or Zstandard, so a small
// edit changes most of the file's bytes. WebBlox's patches for them are made against, and produce,
// the same model with every chunk stored uncompressed, which the format allows (compressed length 0).
// Shared by tools/hosted/build.mjs (Node) and the hosted service worker (importScripts).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.webbloxRbxm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function lz4Block(src, size) {
    const out = new Uint8Array(size);
    let i = 0, o = 0;
    while (i < src.length) {
      const token = src[i++];
      let literals = token >> 4;
      if (literals === 15) { let b; do { b = src[i++]; literals += b; } while (b === 255); }
      out.set(src.subarray(i, i + literals), o);
      i += literals; o += literals;
      if (i >= src.length) break;
      const offset = src[i] | (src[i + 1] << 8);
      i += 2;
      let length = token & 15;
      if (length === 15) { let b; do { b = src[i++]; length += b; } while (b === 255); }
      length += 4;
      for (let from = o - offset, end = o + length; o < end;) out[o++] = out[from++];
    }
    if (o !== size) throw new Error('LZ4 chunk decoded to the wrong size');
    return out;
  }

  function isModel(name) { return /\.rbx[ml]$/i.test(name); }

  // zstd(bytes) -> Uint8Array is supplied by the caller (zlib in Node, fzstd in the browser).
  function normalize(bytes, zstd) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const parts = [bytes.subarray(0, 32)];
    let at = 32, total = 32;
    while (at + 16 <= bytes.length) {
      const name = bytes.subarray(at, at + 4);
      const compressed = view.getUint32(at + 4, true), size = view.getUint32(at + 8, true);
      const reserved = bytes.subarray(at + 12, at + 16);
      at += 16;
      let body;
      if (compressed === 0) { body = bytes.subarray(at, at + size); at += size; }
      else {
        const raw = bytes.subarray(at, at + compressed);
        at += compressed;
        const zstdFrame = raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd;
        body = zstdFrame ? new Uint8Array(zstd(raw)) : lz4Block(raw, size);
        if (body.length !== size) throw new Error('model chunk decoded to the wrong size');
      }
      const head = new Uint8Array(16);
      head.set(name, 0);
      new DataView(head.buffer).setUint32(8, body.length, true);
      head.set(reserved, 12);
      parts.push(head, body);
      total += 16 + body.length;
      if (name[0] === 0x45 && name[1] === 0x4e && name[2] === 0x44 && name[3] === 0) break;
    }
    if (at < bytes.length) { parts.push(bytes.subarray(at)); total += bytes.length - at; }
    const out = new Uint8Array(total);
    let o = 0;
    for (const part of parts) { out.set(part, o); o += part.length; }
    return out;
  }

  return { normalize, isModel, lz4Block };
});
