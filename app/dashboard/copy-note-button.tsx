"use client";

import { useState } from "react";

type State = "idle" | "copied" | "failed";

// Copies one saved note, including its YAML block, as Markdown text, so it can be
// pasted into a new note in Obsidian or any other notes app.
export function CopyNoteButton({ pathname }: { pathname: string }) {
  const [state, setState] = useState<State>("idle");

  const fetchNote = async (): Promise<string> => {
    const res = await fetch(`/api/notes/download?pathname=${encodeURIComponent(pathname)}`);
    if (!res.ok) throw new Error("Could not load the note");
    return res.text();
  };

  const copy = async () => {
    try {
      // The clipboard call starts inside the click and waits for the text. Some
      // browsers refuse a copy that starts only after a download has finished.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const blob = fetchNote().then((text) => new Blob([text], { type: "text/plain" }));
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } else {
        await navigator.clipboard.writeText(await fetchNote());
      }
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  };

  return (
    <>
      <button type="button" onClick={copy} className="btn-sm neutral">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? "Note copied to the clipboard" : state === "failed" ? "Could not copy the note" : ""}
      </span>
    </>
  );
}
