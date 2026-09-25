import { ApiError } from "./http";

const MAX_DIRECTORY = 4 * 1024 * 1024;
const MAX_ENTRIES = 2048;
const MAX_EXPANDED = 2 * 1024 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function invalid(): never {
  throw new ApiError(422, "invalid_zip", "ZIP is damaged or unsupported. Use a non-encrypted ZIP32 with stored or deflated entries within the documented limits.");
}
async function range(bucket: R2Bucket, key: string, offset: number, length: number): Promise<Uint8Array> {
  const object = await bucket.get(key, { range: { offset, length } });
  if (!object) throw new ApiError(409, "upload_incomplete", "Upload content is missing.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length !== length) invalid();
  return bytes;
}
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Implements the ZIP32 subset in PKWARE APPNOTE. Entry data is decompressed to
// a CRC counter, never to disk or an unbounded in-memory buffer. This validates
// archive integrity, not Factorio game/version/mod compatibility.
export async function validateZip(bucket: R2Bucket, key: string, size: number): Promise<void> {
  const tailSize = Math.min(size, 65557);
  const tail = view(await range(bucket, key, size - tailSize, tailSize));
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) { end = i; break; }
  }
  if (end < 0) invalid();
  const count = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const directoryOffset = tail.getUint32(end + 16, true);
  if (tail.getUint16(end + 4, true) !== 0 || tail.getUint16(end + 6, true) !== 0
    || count === 0 || count > MAX_ENTRIES || tail.getUint16(end + 8, true) !== count
    || directorySize < 46 || directorySize > MAX_DIRECTORY
    || directoryOffset + directorySize !== size - tailSize + end) invalid();
  const directory = await range(bucket, key, directoryOffset, directorySize);
  const central = view(directory);
  const entries: { flags: number; method: number; crc: number; compressed: number; expanded: number; offset: number; name: Uint8Array }[] = [];
  let p = 0, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > central.byteLength || central.getUint32(p, true) !== 0x02014b50) invalid();
    const flags = central.getUint16(p + 8, true), method = central.getUint16(p + 10, true);
    const crc = central.getUint32(p + 16, true), compressed = central.getUint32(p + 20, true), expanded = central.getUint32(p + 24, true);
    const nameSize = central.getUint16(p + 28, true), extraSize = central.getUint16(p + 30, true), commentSize = central.getUint16(p + 32, true);
    const offset = central.getUint32(p + 42, true);
    total += expanded;
    if ((flags & ~0x080e) !== 0 || ![0, 8].includes(method) || nameSize === 0
      || central.getUint16(p + 34, true) !== 0 || total > MAX_EXPANDED
      || offset + 30 + nameSize + compressed > directoryOffset
      || p + 46 + nameSize + extraSize + commentSize > central.byteLength) invalid();
    entries.push({ flags, method, crc, compressed, expanded, offset, name: directory.slice(p + 46, p + 46 + nameSize) });
    p += 46 + nameSize + extraSize + commentSize;
  }
  if (p !== central.byteLength) invalid();
  entries.sort((a, b) => a.offset - b.offset);
  if (entries[0]!.offset !== 0) invalid();
  let previousEnd = 0;
  for (const entry of entries) {
    if (entry.offset !== previousEnd) invalid();
    const local = view(await range(bucket, key, entry.offset, 30));
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== entry.flags
      || local.getUint16(8, true) !== entry.method || local.getUint16(26, true) !== entry.name.length) invalid();
    if (!(entry.flags & 8) && (local.getUint32(14, true) !== entry.crc
      || local.getUint32(18, true) !== entry.compressed || local.getUint32(22, true) !== entry.expanded)) invalid();
    const name = await range(bucket, key, entry.offset + 30, entry.name.length);
    if (name.some((b, i) => b !== entry.name[i])) invalid();
    const dataOffset = entry.offset + 30 + name.length + local.getUint16(28, true);
    previousEnd = dataOffset + entry.compressed;
    if (previousEnd > directoryOffset) invalid();
    if (entry.flags & 8) {
      if (previousEnd + 12 > directoryOffset) invalid();
      const descriptor = view(await range(bucket, key, previousEnd, Math.min(16, directoryOffset - previousEnd)));
      const signed = descriptor.getUint32(0, true) === 0x08074b50;
      const start = signed ? 4 : 0;
      if (descriptor.byteLength < start + 12 || descriptor.getUint32(start, true) !== entry.crc
        || descriptor.getUint32(start + 4, true) !== entry.compressed || descriptor.getUint32(start + 8, true) !== entry.expanded) invalid();
      previousEnd += start + 12;
    }
    if (entry.compressed === 0) {
      if (entry.method !== 0 || entry.expanded !== 0 || entry.crc !== 0) invalid();
      continue;
    }
    const object = await bucket.get(key, { range: { offset: dataOffset, length: entry.compressed } });
    if (!object) throw new ApiError(409, "upload_incomplete", "Upload content is missing.");
    const stream = entry.method === 8 ? object.body.pipeThrough(new DecompressionStream("deflate-raw")) : object.body;
    const reader = stream.getReader();
    let length = 0, crc = 0xffffffff;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > entry.expanded) invalid();
        for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
      }
    } catch {
      await reader.cancel().catch(() => {});
      invalid();
    } finally { reader.releaseLock(); }
    if (length !== entry.expanded || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) invalid();
  }
  if (previousEnd !== directoryOffset) invalid();
}
