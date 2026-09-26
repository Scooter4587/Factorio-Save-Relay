import { deflateRawSync } from "node:zlib";

// A tiny, valid ZIP generated in memory. This is synthetic test
// data, not a real Factorio save. No game files are read.
export function testZip(text = "synthetic relay test", deflate = false, descriptor = false) {
  const name = Buffer.from("test-world/level.dat");
  const content = Buffer.from(text);
  const payload = deflate ? deflateRawSync(content) : content;
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(descriptor ? 8 : 0, 6);
  local.writeUInt16LE(deflate ? 8 : 0, 8);
  if (!descriptor) {
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(content.length, 22);
  }
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(descriptor ? 8 : 0, 8);
  central.writeUInt16LE(deflate ? 8 : 0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  const dataDescriptor = Buffer.alloc(descriptor ? 16 : 0);
  if (descriptor) {
    dataDescriptor.writeUInt32LE(0x08074b50, 0);
    dataDescriptor.writeUInt32LE(crc, 4);
    dataDescriptor.writeUInt32LE(payload.length, 8);
    dataDescriptor.writeUInt32LE(content.length, 12);
  }
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + payload.length + dataDescriptor.length, 16);
  return Buffer.concat([local, name, payload, dataDescriptor, central, name, end]);
}
