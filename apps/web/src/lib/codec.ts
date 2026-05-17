const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const encodeUtf8 = (value: string) => textEncoder.encode(value);

export const toUint8Array = (value: ArrayBuffer | ArrayBufferView): Uint8Array => {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new Uint8Array(value.buffer as ArrayBuffer, value.byteOffset, value.byteLength);
};

export const toArrayBuffer = (value: ArrayBuffer | ArrayBufferView): ArrayBuffer => {
  const bytes = toUint8Array(value);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

export const decodeUtf8 = (value: ArrayBuffer | ArrayBufferView) => textDecoder.decode(toUint8Array(value));

export const encodeFrame = (fields: Array<string | number>): Uint8Array => {
  const encoded = fields.map((field) => encodeUtf8(String(field)));
  const totalLength = encoded.reduce((total, item) => total + 4 + item.byteLength, 0);
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer);
  let offset = 0;

  for (const item of encoded) {
    view.setUint32(offset, item.byteLength, false);
    offset += 4;
    result.set(item, offset);
    offset += item.byteLength;
  }

  return result;
};

export const bytesToHex = (bytes: ArrayBuffer | ArrayBufferView) =>
  [...toUint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const base64UrlFromBytes = (bytes: ArrayBuffer | ArrayBufferView) => {
  const binary = String.fromCharCode(...toUint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

export const bytesFromBase64Url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};
