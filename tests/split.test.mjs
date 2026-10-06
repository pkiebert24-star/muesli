import test from "node:test";
import assert from "node:assert/strict";
import {
  WAV_CHUNK_SECONDS,
  WAV_SAMPLE_RATE,
  chunkRanges,
  downmixToMono,
  encodeWav,
  groupRecordings,
  parsePart,
  partPath,
} from "../lib/split.ts";
import { MAX_TRANSCRIBE_BYTES } from "../lib/audio.ts";

test("a WAV part of the planned length stays under the transcription limit", () => {
  const bytes = WAV_CHUNK_SECONDS * WAV_SAMPLE_RATE * 2 + 44;
  assert.ok(bytes < MAX_TRANSCRIBE_BYTES);
});

test("builds and reads part names", () => {
  const path = partPath("recordings/a@b.de/2026-10-06_talk", 3, "webm");
  assert.equal(path, "recordings/a@b.de/2026-10-06_talk_part3.webm");
  assert.deepEqual(parsePart(path), { base: "recordings/a@b.de/2026-10-06_talk", part: 3 });
  assert.equal(parsePart("recordings/a@b.de/2026-10-06_talk.webm"), null);
});

test("groups parts of one recording in order and keeps single files alone", () => {
  const rec = (pathname, uploadedAt, size, title) => ({ pathname, uploadedAt, size, title });
  const groups = groupRecordings([
    rec("r/x/t1_talk_part2.webm", "2026-10-06T10:01:00Z", 20, "talk_part2"),
    rec("r/x/t1_talk_part1.webm", "2026-10-06T10:00:00Z", 10, "talk_part1"),
    rec("r/x/t1_talk_part10.webm", "2026-10-06T10:02:00Z", 5, "talk_part10"),
    rec("r/x/t0_single.mp3", "2026-10-05T09:00:00Z", 7, "single"),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, "talk");
  assert.deepEqual(groups[0].pathnames, ["r/x/t1_talk_part1.webm", "r/x/t1_talk_part2.webm", "r/x/t1_talk_part10.webm"]);
  assert.equal(groups[0].size, 35);
  assert.equal(groups[0].parts, 3);
  assert.equal(groups[1].title, "single");
  assert.equal(groups[1].parts, 1);
});

test("plans chunks that cover every sample once", () => {
  assert.deepEqual(chunkRanges(25, 10), [
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 20, end: 25 },
  ]);
  assert.deepEqual(chunkRanges(10, 10), [{ start: 0, end: 10 }]);
  assert.deepEqual(chunkRanges(0, 10), []);
});

test("mixes channels down to mono", () => {
  const mono = downmixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 1, -1])]);
  assert.deepEqual(Array.from(mono), [0.5, 0.5, -1]);
});

test("writes a valid mono 16-bit WAV header and samples", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000);
  const view = new DataView(wav);
  const text = (o, n) => String.fromCharCode(...new Uint8Array(wav, o, n));
  assert.equal(wav.byteLength, 44 + 8);
  assert.equal(text(0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 36 + 8);
  assert.equal(text(8, 4), "WAVE");
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(text(36, 4), "data");
  assert.equal(view.getUint32(40, true), 8);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(48, true), -32768);
  assert.equal(view.getInt16(50, true), 32767); // clipped
});
