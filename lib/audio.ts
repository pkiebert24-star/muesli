// lib/audio.ts — pure helpers for recordings. Imports nothing, so it runs in the
// browser, on the server and in tests.

// OpenAI's documented upload limit for one transcription request. If your
// transcription model allows larger files, raise this number.
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

// File extensions the transcription endpoint accepts, with the MIME type for each.
const MIME_BY_EXTENSION = new Map<string, string>([
  ["webm", "audio/webm"],
  ["wav", "audio/wav"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["mp4", "video/mp4"],
  ["ogg", "audio/ogg"],
]);

export const AUDIO_EXTENSIONS: string[] = Array.from(MIME_BY_EXTENSION.keys());

// Content types the browser may report for those files. The upload route allows these.
export const ALLOWED_UPLOAD_TYPES: string[] = [
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/webm; codecs=opus",
  "video/webm",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "video/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
];

// The lower-case extension of a path, if it is one the app can transcribe.
export function audioExtension(pathname: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(pathname);
  const extension = match?.[1].toLowerCase();
  return extension && MIME_BY_EXTENSION.has(extension) ? extension : null;
}

// File name and type to send to the transcription endpoint. It reads the format
// from the extension, so an .mp3 must not be sent as "recording.webm".
// Older recordings with no known extension are treated as webm, as before.
export function audioFileInfo(pathname: string): { name: string; type: string } {
  const extension = audioExtension(pathname) ?? "webm";
  return { name: `recording.${extension}`, type: MIME_BY_EXTENSION.get(extension) ?? "audio/webm" };
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// A message when a file is too big to transcribe, or null when it fits.
export function tooLargeMessage(bytes: number): string | null {
  if (bytes <= MAX_TRANSCRIBE_BYTES) return null;
  return (
    `This recording is ${formatMegabytes(bytes)}, and transcription accepts at most ` +
    `${formatMegabytes(MAX_TRANSCRIBE_BYTES)} per file. Save it as a lower-bitrate mono mp3 ` +
    `(32 kbps is enough for speech) or split it into parts, then try again.`
  );
}

// A recording may be uploaded only into the signed-in person's own folder.
export function isOwnRecordingPath(pathname: string, email: string): boolean {
  if (!email) return false;
  if (pathname.includes("..")) return false;
  return pathname.startsWith(`recordings/${email}/`) && audioExtension(pathname) !== null;
}
