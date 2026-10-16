/** JPEG처럼 이미 압축된 파일을 그대로 담는 ZIP. 다시 압축하지 않는다. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type StoredZipFile = {
  name: string;
  data: Uint8Array;
};

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

export function buildStoredZip(files: StoredZipFile[]): Blob {
  if (files.length > 0xffff) {
    throw new Error("사진이 너무 많아 한 번에 저장할 수 없습니다.");
  }

  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const file of files) {
    if (file.data.length > 0xffffffff) {
      throw new Error("파일이 너무 커서 한 번에 저장할 수 없습니다.");
    }
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, now.time, true);
    view.setUint16(12, now.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    local.set(name, 30);
    const stored = new ArrayBuffer(file.data.byteLength);
    new Uint8Array(stored).set(file.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, now.time, true);
    centralView.setUint16(14, now.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    localParts.push(local.buffer as ArrayBuffer, stored);
    centralParts.push(central);
    offset += local.length + file.data.length;
    if (offset > 0xf0000000) {
      throw new Error("파일이 너무 커서 한 번에 저장할 수 없습니다.");
    }
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const endView = new DataView(eocd.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob(
    [...localParts, ...centralParts.map((part) => part.buffer as ArrayBuffer), eocd.buffer as ArrayBuffer],
    { type: "application/zip" },
  );
}

/** STORE(무압축) ZIP만 읽는다. 이 앱이 만든 완전 백업 zip용. */
export function readStoredZip(buffer: ArrayBuffer): StoredZipFile[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder("utf-8");
  const files: StoredZipFile[] = [];
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      throw new Error("지원하지 않는 zip 형식입니다. 앱에서 만든 완전 백업 파일을 선택해 주세요.");
    }
    if (offset + 30 > bytes.length) throw new Error("손상된 zip 파일입니다.");
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (dataStart + compSize > bytes.length) throw new Error("손상된 zip 파일입니다.");
    if (method !== 0) {
      throw new Error("압축된 zip은 불러올 수 없습니다. 앱에서 만든 완전 백업 파일을 사용해 주세요.");
    }
    if (flags & 0x08) {
      throw new Error("지원하지 않는 zip 형식입니다.");
    }
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const data = bytes.subarray(dataStart, dataStart + compSize);
    files.push({ name: name.replace(/\\/g, "/"), data: data.slice() });
    offset = dataStart + compSize;
  }

  if (files.length === 0) throw new Error("빈 zip 파일입니다.");
  return files;
}
