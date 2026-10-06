// lib/split.ts — pure helpers for long recordings that must be cut into parts.
// Imports nothing, so it runs in the browser, on the server and in tests.

// A live recording is cut into a new file this often. 30 minutes at 32 kbps is
// about 7 MB, far below the transcription limit.
export const SEGMENT_SECONDS = 30 * 60;

// A big uploaded file is turned into WAV parts of this length. 10 minutes of
// 16 kHz mono 16-bit sound is 19.2 MB, which stays under the 25 MB limit.
export const WAV_CHUNK_SECONDS = 10 * 60;
export const WAV_SAMPLE_RATE = 16000;

// "base" + part 2 + "webm" -> "base_part2.webm"
export function partPath(base: string, part: number, extension: string): string {
  return `${base}_part${part}.${extension}`;
}

// "folder/2026_talk_part3.webm" -> { base: "folder/2026_talk", part: 3 }, or null.
export function parsePart(pathname: string): { base: string; part: number } | null {
  const match = /^(.*)_part(\d+)\.[a-z0-9]+$/i.exec(pathname);
  if (!match) return null;
  return { base: match[1], part: Number(match[2]) };
}

export type RecordingLike = {
  pathname: string;
  uploadedAt: string;
  size: number;
  title: string;
};

export type RecordingGroup = {
  key: string;
  title: string;
  pathnames: string[]; // in listening order
  size: number;
  uploadedAt: string;
  parts: number;
};

// Puts the parts of one recording together. A file without "_partN" is a group
// of its own. The newest group comes first, as in the plain list.
export function groupRecordings(recordings: RecordingLike[]): RecordingGroup[] {
  const groups = new Map<string, { items: { rec: RecordingLike; part: number }[] }>();
  for (const rec of recordings) {
    const parsed = parsePart(rec.pathname);
    const key = parsed ? parsed.base : rec.pathname;
    const entry = groups.get(key) ?? { items: [] };
    entry.items.push({ rec, part: parsed ? parsed.part : 0 });
    groups.set(key, entry);
  }
  const result: RecordingGroup[] = [];
  for (const [key, { items }] of groups) {
    items.sort((a, b) => a.part - b.part);
    const newest = items.reduce((max, i) => (i.rec.uploadedAt > max ? i.rec.uploadedAt : max), items[0].rec.uploadedAt);
    result.push({
      key,
      title: items[0].rec.title.replace(/_part\d+$/i, "") || "Untitled",
      pathnames: items.map((i) => i.rec.pathname),
      size: items.reduce((sum, i) => sum + i.rec.size, 0),
      uploadedAt: newest,
      parts: items.length,
    });
  }
  return result.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

// Start and end sample of each part when `total` samples are cut every `chunkSamples`.
export function chunkRanges(total: number, chunkSamples: number): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  if (total <= 0 || chunkSamples <= 0) return ranges;
  for (let start = 0; start < total; start += chunkSamples) {
    ranges.push({ start, end: Math.min(start + chunkSamples, total) });
  }
  return ranges;
}

// Averages all channels of decoded sound into one mono channel.
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels.length; c++) {
    const data = channels[c];
    for (let i = 0; i < length; i++) mono[i] += data[i];
  }
  for (let i = 0; i < length; i++) mono[i] /= channels.length;
  return mono;
}

// A mono 16-bit PCM WAV file.
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true); // size of this block
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample frame
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
