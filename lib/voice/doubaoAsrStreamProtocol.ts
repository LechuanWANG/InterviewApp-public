const MSG_FULL_CLIENT = 0x1;
const MSG_AUDIO_ONLY_CLIENT = 0x2;
const MSG_FULL_SERVER = 0x9;
const MSG_ERROR = 0xf;

const FLAG_NO_SEQUENCE = 0x0;
const FLAG_NEGATIVE_SEQUENCE = 0x2;

const SERIALIZATION_NONE = 0x0;
const SERIALIZATION_JSON = 0x1;
const COMPRESSION_NONE = 0x0;

export type DoubaoAsrServerFrame = {
  messageType: number;
  flags: number;
  payload: Uint8Array;
  errorCode?: number;
};

export function buildAsrFullClientJsonFrame(payload: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return buildClientFrame(MSG_FULL_CLIENT, FLAG_NO_SEQUENCE, SERIALIZATION_JSON, bytes);
}

export function buildAsrAudioFrame(payload: ArrayBuffer | ArrayBufferView, isLast: boolean): Uint8Array {
  const bytes = toUint8Array(payload);
  return buildClientFrame(
    MSG_AUDIO_ONLY_CLIENT,
    isLast ? FLAG_NEGATIVE_SEQUENCE : FLAG_NO_SEQUENCE,
    SERIALIZATION_NONE,
    bytes
  );
}

export function parseAsrServerFrame(input: ArrayBuffer | ArrayBufferView): DoubaoAsrServerFrame {
  const data = toUint8Array(input);
  if (data.byteLength < 8) throw new Error(`ASR frame too short: ${data.byteLength}`);

  const headerUnits = data[0] & 0x0f;
  const headerSize = headerUnits * 4;
  if (headerSize <= 0 || data.byteLength < headerSize) {
    throw new Error(`Invalid ASR frame header: ${headerSize}`);
  }

  const messageType = (data[1] >> 4) & 0x0f;
  const flags = data[1] & 0x0f;
  let offset = headerSize;

  if (hasSequenceField(messageType, flags)) {
    offset += 4;
  }

  let errorCode: number | undefined;
  if (messageType === MSG_ERROR) {
    errorCode = readUint32(data, offset);
    offset += 4;
  }

  const payloadSize = readUint32(data, offset);
  offset += 4;
  if (data.byteLength < offset + payloadSize) {
    throw new Error(`Invalid ASR payload size: ${payloadSize}`);
  }

  return {
    messageType,
    flags,
    errorCode,
    payload: data.slice(offset, offset + payloadSize),
  };
}

export function isAsrResultFrame(frame: DoubaoAsrServerFrame): boolean {
  return frame.messageType === MSG_FULL_SERVER;
}

export function isAsrErrorFrame(frame: DoubaoAsrServerFrame): boolean {
  return frame.messageType === MSG_ERROR;
}

export function isAsrFinalFrame(frame: DoubaoAsrServerFrame): boolean {
  return frame.flags === FLAG_NEGATIVE_SEQUENCE || frame.flags === 0x3;
}

function buildClientFrame(messageType: number, flags: number, serialization: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(8 + payload.byteLength);
  frame[0] = 0x11;
  frame[1] = (messageType << 4) | flags;
  frame[2] = (serialization << 4) | COMPRESSION_NONE;
  frame[3] = 0x00;
  writeUint32(frame, 4, payload.byteLength);
  frame.set(payload, 8);
  return frame;
}

function hasSequenceField(messageType: number, flags: number): boolean {
  if (messageType === MSG_AUDIO_ONLY_CLIENT) return false;
  return flags === 0x1 || flags === 0x2 || flags === 0x3;
}

function toUint8Array(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readUint32(data: Uint8Array, offset: number): number {
  if (data.byteLength < offset + 4) throw new Error("ASR frame missing uint32 field");
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}
