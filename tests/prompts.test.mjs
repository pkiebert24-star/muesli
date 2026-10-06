import test from "node:test";
import assert from "node:assert/strict";
import { NOTE_MODES, buildPrompt, isNoteMode } from "../lib/prompts.ts";

test("every mode has a prompt that carries the title and the date", () => {
  for (const mode of NOTE_MODES) {
    const prompt = buildPrompt(mode, "My Title", "2026-10-05");
    assert.match(prompt, /My Title/, mode);
    assert.match(prompt, /2026-10-05/, mode);
    assert.match(prompt, /Obsidian-compatible Markdown/, mode);
  }
});

test("a missing title falls back to a default for that mode", () => {
  assert.match(buildPrompt("webinar", "", "2026-10-05"), /Title: Webinar/);
  assert.match(buildPrompt("tool-ideas", undefined, "2026-10-05"), /Title: Tool Ideas/);
  assert.match(buildPrompt("topic-expansion", undefined, "2026-10-05"), /Title: Topic Expansion/);
});

test("an unknown mode falls back to meeting notes", () => {
  const meeting = buildPrompt("meeting", "T", "2026-10-05");
  assert.equal(buildPrompt("not-a-mode", "T", "2026-10-05"), meeting);
  assert.equal(buildPrompt(undefined, "T", "2026-10-05"), meeting);
  assert.equal(buildPrompt("constructor", "T", "2026-10-05"), meeting);
});

test("the new modes ask for what they promise", () => {
  assert.match(buildPrompt("webinar", "T", "d"), /Claims to Verify/);
  assert.match(buildPrompt("tool-ideas", "T", "d"), /Tool Ideas \(3 to 7\)/);
  assert.match(buildPrompt("tool-ideas", "T", "d"), /"inferred"/);
  assert.match(buildPrompt("topic-expansion", "T", "d"), /Do not invent sources/);
});

test("isNoteMode accepts only the known modes", () => {
  assert.equal(isNoteMode("webinar"), true);
  assert.equal(isNoteMode("meeting"), true);
  assert.equal(isNoteMode("webinars"), false);
  assert.equal(isNoteMode(42), false);
  assert.equal(isNoteMode(null), false);
});

test("idea snippets mode asks for self-contained snippets with a research question", () => {
  const prompt = buildPrompt("idea-snippets", "T", "d");
  assert.match(prompt, /### 1\. Short heading/);
  assert.match(prompt, /\*\*To research:\*\*/);
  assert.match(prompt, /Do not add outside facts/);
  assert.equal(isNoteMode("idea-snippets"), true);
  assert.match(buildPrompt("idea-snippets", "", "d"), /Title: Idea Snippets/);
});
