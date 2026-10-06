// lib/notes.ts — small pure helpers for saved notes. Imports nothing, so it runs
// on the server and in tests.

// A note may be opened only from the signed-in person's own folder, and only as .md.
export function isOwnNotePath(pathname: string, email: string): boolean {
  if (!email) return false;
  if (pathname.includes("..")) return false;
  return pathname.startsWith(`notes/${email}/`) && pathname.endsWith(".md");
}

// The notes start with a YAML block between "---" lines. It is machine data, so the
// reading view leaves it out. The downloaded file keeps it.
export function stripFrontmatter(markdown: string): string {
  const text = markdown.replace(/^﻿/, "");
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
}

// A readable title from a saved file name such as
// "notes/a@b.de/2026-10-06T10-00-00_launch-webinar.md".
export function noteTitle(pathname: string): string {
  const filename = pathname.split("/").pop() || "";
  const title = filename
    .replace(/^\d{4}.*?_/, "")
    .replace(/\.md$/i, "")
    .replace(/-/g, " ")
    .trim();
  return title || "Untitled";
}
