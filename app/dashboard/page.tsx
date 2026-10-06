"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { signOut } from "next-auth/react";
import { upload, uploadPresigned } from '@vercel/blob/client';
import { AUDIO_EXTENSIONS, audioExtension, audioFileInfo, MAX_TRANSCRIBE_BYTES } from "@/lib/audio";
import {
  SEGMENT_SECONDS,
  WAV_CHUNK_SECONDS,
  WAV_SAMPLE_RATE,
  chunkRanges,
  downmixToMono,
  encodeWav,
  groupRecordings,
  partPath,
  type RecordingGroup,
} from "@/lib/split";
import type { NoteMode } from "@/lib/prompts";
import { CopyNoteButton } from "./copy-note-button";

type Recording = {
  url: string;
  pathname: string;
  uploadedAt: string;
  size: number;
  title: string;
};

type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
};

type Note = {
  url: string;
  pathname: string;
  uploadedAt: string;
  title: string;
  preview: string;
};

// Simple SVG icons — no emojis
const MicIcon = () => (
  <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const StopIcon = () => (
  <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

type Mode = NoteMode;

const MODES: { value: Mode; label: string; placeholder: string }[] = [
  { value: "meeting", label: "Meeting Notes", placeholder: "e.g. UX Review with Dan" },
  { value: "voice-memo", label: "Voice Memo", placeholder: "e.g. Quick thought on pricing" },
  { value: "brain-dump", label: "Brain Dump", placeholder: "e.g. Product roadmap ideas" },
  { value: "content-draft", label: "Content Draft", placeholder: "e.g. LinkedIn post about AI" },
  { value: "webinar", label: "Webinar", placeholder: "e.g. Launch webinar with Alex" },
  { value: "tool-ideas", label: "Tool Ideas", placeholder: "e.g. Tool ideas from the SaaS webinar" },
  { value: "topic-expansion", label: "Expand Topic", placeholder: "e.g. Expand: cold email for freelancers" },
  { value: "idea-snippets", label: "Idea Snippets", placeholder: "e.g. Snippets from the pricing webinar" },
];

// Where the sound comes from. A browser tab is how you record a webinar.
type AudioSource = "mic" | "tab" | "tab-mic";

const SOURCES: { value: AudioSource; label: string }[] = [
  { value: "mic", label: "Microphone" },
  { value: "tab", label: "Browser tab" },
  { value: "tab-mic", label: "Tab + mic" },
];

const NO_TAB_AUDIO = "no-tab-audio";

const OPENAI_KEY_STORAGE = "muesli-openai-key";

export default function Dashboard() {
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState("00:00");
  const [status, setStatus] = useState<{
    text: string;
    type: "" | "recording" | "processing" | "success" | "error";
  }>({ text: "", type: "" });
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [mode, setMode] = useState<Mode>("meeting");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [openaiKey, setOpenaiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState("");
  const [source, setSource] = useState<AudioSource>("mic");
  const [uploading, setUploading] = useState(false);
  const [blobMode, setBlobMode] = useState<"token" | "presigned">("presigned");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const segmentsRef = useRef<Blob[]>([]);
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotatingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const finishRef = useRef<() => Promise<void>>(async () => {});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const loadData = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const [recResult, notesResult, calResult] = await Promise.allSettled([
        fetch("/api/recordings", { signal: controller.signal }),
        fetch("/api/notes", { signal: controller.signal }),
        fetch("/api/calendar", { signal: controller.signal })
      ]);

      if (recResult.status === "fulfilled" && recResult.value.ok) {
        const recData = await recResult.value.json();
        setRecordings(recData.recordings || []);
        if (recData.email) setUserEmail(recData.email);
      }
      if (notesResult.status === "fulfilled" && notesResult.value.ok) {
        setNotes(await notesResult.value.json());
      }
      if (calResult.status === "fulfilled" && calResult.value.ok) {
        const calData = await calResult.value.json();
        if (calData.events) setCalendarEvents(calData.events);
      }
    } catch { /* timeout or network error — ignore */ }
    finally { clearTimeout(timeout); }
  }, []);

  useEffect(() => {
    loadData();
    // Each list call counts against the Blob plan's monthly operations, so the page
    // refreshes when you come back to the tab instead of polling on a timer.
    const onVisible = () => { if (document.visibilityState === "visible") loadData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadData]);

  // When the deployment has no OpenAI key of its own, each person uses theirs.
  // It is kept in this browser only and sent with each notes request.
  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.blobMode === "token" || data.blobMode === "presigned") setBlobMode(data.blobMode);
        if (!data.needsOpenAIKey) return;
        setNeedsKey(true);
        setOpenaiKey(window.localStorage.getItem(OPENAI_KEY_STORAGE) || "");
      })
      .catch(() => { /* leave the prompt off; the server still asks for a key */ });
  }, []);

  // The upload folder is named after the signed-in person. If the page has not
  // loaded the email yet, ask for it now instead of saving into a wrong folder.
  const resolveEmail = async (): Promise<string> => {
    if (userEmail) return userEmail;
    try {
      const res = await fetch("/api/recordings");
      const data = await res.json();
      if (typeof data.email === "string" && data.email) {
        setUserEmail(data.email);
        return data.email;
      }
    } catch { /* fall through */ }
    return "";
  };

  // Which kind of Blob store is connected decides how the browser uploads.
  const uploadBlob = blobMode === "token" ? upload : uploadPresigned;

  const saveKey = (e: React.FormEvent) => {
    e.preventDefault();
    const value = keyDraft.trim();
    if (!value.startsWith("sk-")) {
      setKeyError("That does not look like an OpenAI key. It starts with sk-.");
      return;
    }
    window.localStorage.setItem(OPENAI_KEY_STORAGE, value);
    setOpenaiKey(value);
    setKeyDraft("");
    setKeyError("");
  };

  const removeKey = () => {
    window.localStorage.removeItem(OPENAI_KEY_STORAGE);
    setOpenaiKey("");
  };

  const updateTimer = useCallback(() => {
    if (!startTimeRef.current) return;
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const secs = String(elapsed % 60).padStart(2, "0");
    setTimer(`${mins}:${secs}`);
  }, []);

  // Stops the recorder. Saving happens in finishRecording once it has stopped.
  const stopRecording = () => {
    // A stop must end the recording, not start the next part.
    rotatingRef.current = false;
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  // Saves the parts of a recording. One part keeps the plain file name; several
  // parts get "_part1", "_part2", ... so the list can put them together again.
  const saveParts = async (parts: Blob[], extension: string, contentType: string, name: string): Promise<boolean> => {
    const email = await resolveEmail();
    if (!email) {
      setStatus({ text: "Could not confirm your login. Reload the page and sign in again.", type: "error" });
      return false;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeName = (name || "recording").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
    const base = `recordings/${email}/${timestamp}_${safeName}`;
    try {
      for (let i = 0; i < parts.length; i++) {
        if (parts.length > 1) {
          setStatus({ text: `Uploading part ${i + 1} of ${parts.length}...`, type: "processing" });
        }
        const path = parts.length > 1 ? partPath(base, i + 1, extension) : `${base}.${extension}`;
        await uploadBlob(path, parts[i], {
          access: 'private',
          handleUploadUrl: '/api/upload',
          clientPayload: JSON.stringify({ email }),
          // Browsers report odd types for some files, so send the one that matches the extension.
          contentType,
        });
      }
      return true;
    } catch (error) {
      setStatus({ text: "Upload failed: " + (error as Error).message, type: "error" });
      return false;
    }
  };

  // Runs once the recorder has stopped, whether Stop was pressed or the tab share ended.
  const finishRecording = async () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (rotateTimerRef.current) clearTimeout(rotateTimerRef.current);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    const segments = segmentsRef.current;
    segmentsRef.current = [];
    setStatus({ text: "Uploading securely...", type: "processing" });

    if (segments.length === 0) {
      setStatus({ text: "Nothing was recorded.", type: "error" });
    } else if (await saveParts(segments, "webm", "audio/webm", title)) {
      setStatus({
        text: segments.length > 1
          ? `Recording saved in ${segments.length} parts.`
          : "Recording saved securely!",
        type: "success",
      });
      setTitle("");
      loadData();
    }
    setIsRecording(false);
    setTimer("00:00");
    startTimeRef.current = null;
  };

  // The recorder's stop handler is set once, so it calls the latest finishRecording through a ref.
  useEffect(() => {
    finishRef.current = finishRecording;
  });

  // Records one part. After SEGMENT_SECONDS it stops and starts the next part on the
  // same stream, so every file stays far below the transcription limit.
  // 32 kbps mono is plenty for speech.
  const startSegment = (stream: MediaStream) => {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond: 32000,
    });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      if (chunks.length > 0) segmentsRef.current.push(new Blob(chunks, { type: "audio/webm" }));
      if (rotatingRef.current) {
        rotatingRef.current = false;
        startSegment(stream);
      } else {
        void finishRef.current();
      }
    };
    mediaRecorderRef.current = recorder;
    recorder.start(1000);
    rotateTimerRef.current = setTimeout(() => {
      rotatingRef.current = true;
      if (recorder.state !== "inactive") recorder.stop();
    }, SEGMENT_SECONDS * 1000);
  };

  // Starts recording from the microphone, a browser tab (a webinar), or both mixed.
  const startRecording = async () => {
    const wantsTab = source !== "mic";
    if (wantsTab && !navigator.mediaDevices?.getDisplayMedia) {
      setStatus({ text: "Recording a browser tab needs Chrome or Edge on a computer.", type: "error" });
      return;
    }
    setStatus({
      text: wantsTab ? "Choose the webinar tab and tick “Share tab audio”..." : "Requesting mic access...",
      type: "",
    });
    // Made now, while the click still counts, so the browser lets it run.
    const audioContext = wantsTab ? new AudioContext() : null;
    const opened: MediaStream[] = [];
    const release = () => {
      opened.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      audioContext?.close().catch(() => { /* already closed */ });
    };
    try {
      let recordStream: MediaStream;
      if (!audioContext) {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        opened.push(mic);
        recordStream = mic;
      } else {
        // Chrome offers tab audio only together with video, so ask for both and record the audio.
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        opened.push(display);
        const tabAudio = display.getAudioTracks();
        if (tabAudio.length === 0) throw new Error(NO_TAB_AUDIO);
        await audioContext.resume();
        // Everything goes through one mono output, which keeps the file small.
        const mixed = audioContext.createMediaStreamDestination();
        mixed.channelCount = 1;
        audioContext.createMediaStreamSource(new MediaStream(tabAudio)).connect(mixed);
        if (source === "tab-mic") {
          const mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          opened.push(mic);
          audioContext.createMediaStreamSource(mic).connect(mixed);
        }
        recordStream = mixed.stream;
        // The browser's "Stop sharing" button ends the shared audio. Stop and save what was recorded.
        tabAudio[0].addEventListener("ended", () => stopRecording());
      }

      segmentsRef.current = [];
      rotatingRef.current = false;
      cleanupRef.current = release;
      startSegment(recordStream);
      setIsRecording(true);
      setStatus({ text: "", type: "recording" });
      startTimeRef.current = Date.now();
      timerIntervalRef.current = setInterval(updateTimer, 1000);
    } catch (error) {
      release();
      if (error instanceof Error && error.message === NO_TAB_AUDIO) {
        setStatus({ text: "No audio was shared. Pick a browser tab and tick “Share tab audio”.", type: "error" });
      } else if (wantsTab) {
        setStatus({ text: "Tab recording was cancelled or blocked — check browser permissions", type: "error" });
      } else {
        setStatus({ text: "Mic access denied — check browser permissions", type: "error" });
      }
    }
  };

  // Cuts a long file into WAV parts inside the browser: decode, mix to mono at
  // 16 kHz, then one part per WAV_CHUNK_SECONDS. Nothing leaves the computer yet.
  const cutIntoWavParts = async (file: File): Promise<Blob[]> => {
    const context = new AudioContext({ sampleRate: WAV_SAMPLE_RATE });
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c));
      const mono = downmixToMono(channels);
      // Counted in samples, so a part is about 19 MB even if the browser ignored the 16 kHz request.
      const ranges = chunkRanges(mono.length, WAV_CHUNK_SECONDS * WAV_SAMPLE_RATE);
      return ranges.map((r) => new Blob([encodeWav(mono.subarray(r.start, r.end), decoded.sampleRate)], { type: "audio/wav" }));
    } finally {
      context.close().catch(() => { /* already closed */ });
    }
  };

  // Uploads a recording that already exists, such as a webinar replay saved as mp3 or mp4.
  // A file over the transcription limit is cut into parts first.
  const uploadFile = async (file: File) => {
    const extension = audioExtension(file.name);
    if (!extension) {
      setStatus({ text: `That file type is not supported. Use ${AUDIO_EXTENSIONS.join(", ")}.`, type: "error" });
      return;
    }
    setUploading(true);
    const stem = file.name.replace(/\.[^.]+$/, "");
    const name = title || stem;

    let parts: Blob[] = [file];
    let partExtension = extension;
    let contentType = audioFileInfo(`x.${extension}`).type;
    if (file.size > MAX_TRANSCRIBE_BYTES) {
      setStatus({ text: "File is large. Cutting it into parts in your browser (this can take a minute)...", type: "processing" });
      try {
        parts = await cutIntoWavParts(file);
        partExtension = "wav";
        contentType = "audio/wav";
      } catch {
        setStatus({
          text: "This file could not be cut into parts in the browser. It may be too long (over about 2 hours) or in a format Chrome cannot read. Record the webinar live instead, or convert the file to a 32 kbps mono mp3 first.",
          type: "error",
        });
        setUploading(false);
        return;
      }
      if (parts.length === 0) {
        setStatus({ text: "No sound was found in that file.", type: "error" });
        setUploading(false);
        return;
      }
    }

    setStatus({ text: `Uploading "${file.name}"...`, type: "processing" });
    if (await saveParts(parts, partExtension, contentType, name)) {
      setStatus({
        text: parts.length > 1
          ? `File uploaded in ${parts.length} parts. Press Generate Notes below.`
          : "File uploaded. Press Generate Notes below.",
        type: "success",
      });
      setTitle("");
      loadData();
    }
    setUploading(false);
  };

  // Each part is transcribed in its own request, then the notes are written from all
  // transcripts together. That keeps every request short, however long the recording is.
  const processRecording = async (group: RecordingGroup) => {
    if (needsKey && !openaiKey) {
      setStatus({ text: "Add your OpenAI key above to generate notes.", type: "error" });
      return;
    }
    const headers = { "Content-Type": "application/json", ...(needsKey ? { "x-openai-key": openaiKey } : {}) };
    const total = group.pathnames.length;
    setProcessingId(group.key);
    try {
      const transcripts: string[] = [];
      for (let i = 0; i < total; i++) {
        setStatus({
          text: total > 1 ? `Transcribing part ${i + 1} of ${total}...` : `Processing "${group.title}"...`,
          type: "processing",
        });
        const res = await fetch("/api/process", {
          method: "POST",
          headers,
          body: JSON.stringify({ step: "transcribe", pathname: group.pathnames[i] }),
        });
        const part = await res.json();
        if (!part.ok) {
          setStatus({ text: (total > 1 ? `Part ${i + 1}: ` : "") + (part.error || "Processing failed"), type: "error" });
          setProcessingId(null);
          return;
        }
        if (part.transcript) transcripts.push(part.transcript);
      }
      const transcript = transcripts.join("\n\n");
      if (transcript.trim().length < 20) {
        setStatus({ text: "Transcript too short -- the recording may not have captured audio properly.", type: "error" });
        setProcessingId(null);
        return;
      }

      setStatus({ text: "Writing notes...", type: "processing" });
      const res = await fetch("/api/process", {
        method: "POST",
        headers,
        body: JSON.stringify({ step: "notes", transcript, title: group.title, mode }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus({ text: "Notes generated!", type: "success" });

        // Push notes to calendar if an event was selected
        if (selectedEventId && data.notesText) {
          setStatus({ text: "Adding to Google Calendar...", type: "processing" });
          try {
            await fetch("/api/calendar", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ eventId: selectedEventId, notesText: data.notesText }),
            });
            setStatus({ text: "Notes added to Calendar!", type: "success" });
          } catch {
             setStatus({ text: "Generated, but couldn't add to calendar", type: "error" });
          }
        }

        loadData();
      }
      else { setStatus({ text: data.error || "Processing failed", type: "error" }); }
    } catch { setStatus({ text: "Connection error", type: "error" }); }
    setProcessingId(null);
  };

  // Removes a recording and all its parts. Saved notes stay.
  const deleteRecording = async (group: RecordingGroup) => {
    const what = group.parts > 1 ? `"${group.title}" (${group.parts} parts)` : `"${group.title}"`;
    if (!window.confirm(`Delete the recording ${what}? Your notes stay.`)) return;
    try {
      const res = await fetch("/api/recordings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathnames: group.pathnames }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus({ text: "Recording deleted.", type: "success" });
      loadData();
    } catch {
      setStatus({ text: "Could not delete the recording.", type: "error" });
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const formatSize = (bytes: number) => {
    const kb = Math.round(bytes / 1024);
    return kb > 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${kb} KB`;
  };

  return (
    <>
      <div className="container">
        {/* Dashboard header */}
        <div className="dash-header">
          <h1 className="dash-brand">Muesli</h1>
          <button onClick={() => signOut({ callbackUrl: "/" })} className="btn-ghost">
            Sign Out
          </button>
        </div>

        {needsKey && (
          <div className="card compact">
            <div className="section-header">
              <h2 className="section-title">Your OpenAI key</h2>
            </div>
            {openaiKey ? (
              <div className="list-item">
                <div className="list-item-info">
                  <div className="key-saved">Key saved in this browser</div>
                  <div className="list-item-meta">Muesli uses it to write your notes. It is never stored on the server.</div>
                </div>
                <button onClick={removeKey} className="btn-sm neutral">Remove key</button>
              </div>
            ) : (
              <form onSubmit={saveKey}>
                <p className="key-help">
                  Muesli writes your notes with your own OpenAI key. It stays in this browser and is sent only when you generate notes.
                  Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>.
                </p>
                <label htmlFor="openai-key" className="sr-only">OpenAI API key</label>
                <div className="key-row">
                  <input
                    id="openai-key"
                    type="password"
                    autoComplete="off"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="sk-..."
                    className="title-input"
                    required
                  />
                  <button type="submit" className="btn-sm accent">Save key</button>
                </div>
                {keyError && <div className="status error" role="alert">{keyError}</div>}
              </form>
            )}
          </div>
        )}

        {/* Recording Card */}
        <div className="card">
          <div className="mode-selector" role="group" aria-label="Recording mode">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                disabled={isRecording}
                aria-pressed={mode === m.value}
                className={`mode-btn ${mode === m.value ? "active" : ""}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="mode-selector" role="group" aria-label="Audio source">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                onClick={() => setSource(s.value)}
                disabled={isRecording}
                aria-pressed={source === s.value}
                className={`mode-btn ${source === s.value ? "active" : ""}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {source !== "mic" && !isRecording && (
            <p className="key-help">
              Open the webinar in its own browser tab first. When Chrome or Edge asks, choose that tab and tick “Share tab audio”.
              Long recordings are saved automatically in 30-minute parts.
            </p>
          )}

          {calendarEvents.length > 0 && (
            <div className="calendar-events-wrap" role="group" aria-label="Calendar events" style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 20, paddingBottom: 8 }}>
              {calendarEvents.map(event => {
                const isSelected = selectedEventId === event.id;
                const date = new Date(event.start);
                const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                return (
                  <button
                    key={event.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedEventId(null);
                        setTitle("");
                      } else {
                        setSelectedEventId(event.id);
                        setTitle(event.summary);
                        setMode("meeting");
                      }
                    }}
                    className={`calendar-event-btn ${isSelected ? "active" : ""}`}
                    disabled={isRecording}
                    aria-pressed={isSelected}
                    style={{
                      flex: "0 0 auto",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: isSelected ? "2px solid var(--accent)" : "1px solid var(--card-border)",
                      background: isSelected ? "var(--accent-bg)" : "var(--card)",
                      cursor: isRecording ? "not-allowed" : "pointer",
                      textAlign: "left",
                      minWidth: 140,
                      maxWidth: 220,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {event.summary}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{time}</div>
                  </button>
                );
              })}
            </div>
          )}

          <label htmlFor="recording-title" className="sr-only">Recording title</label>
          <input
            id="recording-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={MODES.find((m) => m.value === mode)?.placeholder || "Title"}
            disabled={isRecording}
            className="title-input"
          />

          {isRecording && (
            <div className="recording-viz">
              <div className="waveform">
                {[...Array(9)].map((_, i) => (
                  <span key={i} className="wave-bar" />
                ))}
              </div>
              <div className="timer">{timer}</div>
              <div className="recording-badge">
                <span className="dot" />
                Recording
              </div>
            </div>
          )}

          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`record-btn ${isRecording ? "stop" : "start"}`}
          >
            {isRecording ? <><StopIcon /> Stop Recording</> : <><MicIcon /> Start Recording</>}
          </button>

          <div style={{ textAlign: "center", marginTop: 12 }}>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept={`audio/*,video/mp4,video/webm,${AUDIO_EXTENSIONS.map((e) => `.${e}`).join(",")}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void uploadFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRecording || uploading}
              className="btn-sm neutral"
            >
              {uploading ? <><span className="spinner" aria-hidden="true" /> Uploading...</> : "Or upload an audio or video file"}
            </button>
          </div>

          <div role="status" aria-live="polite">
            {status.text && (
              <div className={`status ${status.type}`}>
                {status.type === "processing" && <span className="spinner" aria-hidden="true" />}
                {status.text}
              </div>
            )}
          </div>
        </div>

        {/* Recordings */}
        <div className="card compact">
          <div className="section-header">
            <h2 className="section-title">Recordings</h2>
            {recordings.length > 0 && (
              <span className="section-count">{recordings.length}</span>
            )}
          </div>

          {recordings.length === 0 ? (
            <div className="empty-state">
              <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <p>Hit record to get started</p>
            </div>
          ) : (
            <div>
              {groupRecordings(recordings).map((g) => (
                <div key={g.key} className="list-item">
                  <div className="list-item-info">
                    <div className="list-item-name">{g.title}</div>
                    <div className="list-item-meta">
                      {formatDate(g.uploadedAt)} · {formatSize(g.size)}{g.parts > 1 ? ` · ${g.parts} parts` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => processRecording(g)}
                      disabled={processingId !== null}
                      className="btn-sm accent"
                    >
                      {processingId === g.key ? <><span className="spinner" aria-hidden="true" /> Processing...</> : "Generate Notes"}
                    </button>
                    <button
                      onClick={() => deleteRecording(g)}
                      disabled={processingId !== null}
                      className="btn-sm neutral"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="card compact">
          <div className="section-header">
            <h2 className="section-title">Notes</h2>
            {notes.length > 0 && (
              <span className="section-count">{notes.length}</span>
            )}
          </div>

          {notes.length === 0 ? (
            <div className="empty-state">
              <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              <p>Notes will appear here after processing</p>
            </div>
          ) : (
            <div>
              {notes.map((n) => (
                <div key={n.pathname} className="list-item">
                  <div className="list-item-info">
                    <div className="list-item-name">{n.title}</div>
                    <div className="list-item-meta">{formatDate(n.uploadedAt)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <a href={`/dashboard/notes?pathname=${encodeURIComponent(n.pathname)}`} target="_blank" rel="noreferrer" className="btn-sm accent">
                      Open
                    </a>
                    <CopyNoteButton pathname={n.pathname} />
                    <a href={`/api/notes/download?pathname=${encodeURIComponent(n.pathname)}`} download className="btn-sm neutral">
                      <DownloadIcon /> Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="footer">
          Powered by OpenAI
        </footer>
      </div>
    </>
  );
}
