import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_UPLOAD_TYPES,
  AUDIO_EXTENSIONS,
  MAX_TRANSCRIBE_BYTES,
  audioExtension,
  audioFileInfo,
  isOwnRecordingPath,
  tooLargeMessage,
} from "../lib/audio.ts";

test("finds the extension of a supported file, ignoring case", () => {
  assert.equal(audioExtension("recordings/a@b.de/2026-10-05_talk.mp3"), "mp3");
  assert.equal(audioExtension("Replay.MP4"), "mp4");
  assert.equal(audioExtension("x.webm"), "webm");
});

test("returns null for files the app cannot transcribe", () => {
  assert.equal(audioExtension("notes.pdf"), null);
  assert.equal(audioExtension("no-extension"), null);
  assert.equal(audioExtension("file.constructor"), null);
});

test("sends the real extension and type to the transcription endpoint", () => {
  assert.deepEqual(audioFileInfo("recordings/a/b_talk.mp3"), { name: "recording.mp3", type: "audio/mpeg" });
  assert.deepEqual(audioFileInfo("recordings/a/b_talk.m4a"), { name: "recording.m4a", type: "audio/mp4" });
  assert.deepEqual(audioFileInfo("recordings/a/b_replay.mp4"), { name: "recording.mp4", type: "video/mp4" });
});

test("treats older recordings with no known extension as webm", () => {
  assert.deepEqual(audioFileInfo("recordings/a/old-recording"), { name: "recording.webm", type: "audio/webm" });
});

test("every supported extension has an allowed upload type", () => {
  for (const extension of AUDIO_EXTENSIONS) {
    const { type } = audioFileInfo(`x.${extension}`);
    assert.ok(ALLOWED_UPLOAD_TYPES.includes(type), `${extension} -> ${type}`);
  }
});

test("accepts a file at the limit and rejects one byte over", () => {
  assert.equal(tooLargeMessage(MAX_TRANSCRIBE_BYTES), null);
  assert.match(tooLargeMessage(MAX_TRANSCRIBE_BYTES + 1), /at most 25\.0 MB/);
  assert.match(tooLargeMessage(60 * 1024 * 1024), /60\.0 MB/);
});

test("recordings go only into the signed-in person's own folder", () => {
  const email = "a@b.de";
  assert.equal(isOwnRecordingPath("recordings/a@b.de/2026-10-06_talk.webm", email), true);
  assert.equal(isOwnRecordingPath("recordings/a@b.de/2026-10-06_replay.mp4", email), true);
  assert.equal(isOwnRecordingPath("recordings/anonymous/2026-10-06_talk.webm", email), false);
  assert.equal(isOwnRecordingPath("recordings/other@b.de/talk.webm", email), false);
  assert.equal(isOwnRecordingPath("recordings/a@b.de/../other@b.de/talk.webm", email), false);
  assert.equal(isOwnRecordingPath("recordings/a@b.de/notes.pdf", email), false);
  assert.equal(isOwnRecordingPath("recordings//talk.webm", ""), false);
});
