import test from "node:test";
import assert from "node:assert/strict";
import { isOwnNotePath, noteTitle, stripFrontmatter } from "../lib/notes.ts";

test("opens only the signed-in person's own .md notes", () => {
  const email = "a@b.de";
  assert.equal(isOwnNotePath("notes/a@b.de/2026-10-06_talk.md", email), true);
  assert.equal(isOwnNotePath("notes/other@b.de/2026-10-06_talk.md", email), false);
  assert.equal(isOwnNotePath("recordings/a@b.de/talk.webm", email), false);
  assert.equal(isOwnNotePath("notes/a@b.de/talk.txt", email), false);
  assert.equal(isOwnNotePath("notes/a@b.de/../other@b.de/x.md", email), false);
  assert.equal(isOwnNotePath("notes//x.md", ""), false);
});

test("removes the YAML block from the reading view", () => {
  const note = "---\ntags: [webinar]\ndate: 2026-10-06\n---\n\n## Summary\n\nText here.\n";
  assert.equal(stripFrontmatter(note), "## Summary\n\nText here.");
});

test("handles Windows line endings and a BOM", () => {
  const note = "﻿---\r\ntitle: x\r\n---\r\nBody";
  assert.equal(stripFrontmatter(note), "Body");
});

test("leaves notes without a YAML block alone, including a leading rule", () => {
  assert.equal(stripFrontmatter("  # Heading\n\ntext "), "# Heading\n\ntext");
  assert.equal(stripFrontmatter("Intro\n\n---\n\nAfter"), "Intro\n\n---\n\nAfter");
});

test("makes a readable title from the saved file name", () => {
  assert.equal(noteTitle("notes/a@b.de/2026-10-06T10-00-00_launch-webinar.md"), "launch webinar");
  assert.equal(noteTitle("notes/a@b.de/2026-10-06T10-00-00_.md"), "Untitled");
});
