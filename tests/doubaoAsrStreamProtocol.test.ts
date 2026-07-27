import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAsrAudioFrame,
  buildAsrFullClientJsonFrame,
  isAsrFinalFrame,
  isAsrResultFrame,
  parseAsrServerFrame,
} from "../lib/voice/doubaoAsrStreamProtocol";

test("builds Doubao ASR full client JSON frame", () => {
  const frame = buildAsrFullClientJsonFrame({ request: { reqid: "r1" } });

  assert.equal(frame[0], 0x11);
  assert.equal(frame[1], 0x10);
  assert.equal(frame[2], 0x10);
  assert.equal(readUint32(frame, 4), frame.byteLength - 8);
});

test("builds normal and final audio frames", () => {
  const normal = buildAsrAudioFrame(new Uint8Array([1, 2, 3]), false);
  const final = buildAsrAudioFrame(new Uint8Array(), true);

  assert.equal(normal[1], 0x20);
  assert.equal(readUint32(normal, 4), 3);
  assert.equal(final[1], 0x22);
  assert.equal(readUint32(final, 4), 0);
});

test("parses final Doubao ASR server result frame", () => {
  const payload = new TextEncoder().encode(JSON.stringify({ result: { text: "你好" } }));
  const frame = parseAsrServerFrame(buildServerResultFrame(payload, 0x2));

  assert.equal(isAsrResultFrame(frame), true);
  assert.equal(isAsrFinalFrame(frame), true);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(frame.payload)), {
    result: { text: "你好" },
  });
});

function buildServerResultFrame(payload: Uint8Array, flags: number): Uint8Array {
  const hasSequence = flags === 0x1 || flags === 0x2 || flags === 0x3;
  const frame = new Uint8Array(8 + (hasSequence ? 4 : 0) + payload.byteLength);
  frame[0] = 0x11;
  frame[1] = (0x9 << 4) | flags;
  frame[2] = 0x10;
  frame[3] = 0x00;
  let offset = 4;
  if (hasSequence) {
    frame[offset] = 0xff;
    frame[offset + 1] = 0xff;
    frame[offset + 2] = 0xff;
    frame[offset + 3] = 0xff;
    offset += 4;
  }
  writeUint32(frame, offset, payload.byteLength);
  frame.set(payload, offset + 4);
  return frame;
}

function readUint32(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}
