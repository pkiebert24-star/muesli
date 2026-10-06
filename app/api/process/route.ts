import { get, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@/auth";
import { getNotesText, NOTES_MODEL, TRANSCRIPTION_MODEL } from "@/lib/ai";
import { audioFileInfo, tooLargeMessage } from "@/lib/audio";
import { buildPrompt } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for Pro plan

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Long recordings come in parts. The browser asks for one step at a time
    // ("transcribe" a part, then write the "notes" from all transcripts), so no
    // single request runs into the time limit. Without a step, one file is
    // transcribed and turned into notes in one go.
    const { pathname, title, mode = "meeting", step, transcript: sentTranscript } = await request.json();

    if (step !== "notes" && !pathname) {
      return NextResponse.json(
        { ok: false, error: "No recording pathname provided" },
        { status: 400 }
      );
    }

    // The deployment's own key wins. With none set, each person sends their own
    // key with the request. It is used for this request only and never stored or logged.
    const apiKey =
      process.env.OPENAI_API_KEY?.trim() || request.headers.get("x-openai-key")?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Add your OpenAI API key to generate notes." },
        { status: 400 }
      );
    }

    // Lazy-init client (env vars not available at build time)
    const openai = new OpenAI({ apiKey });

    let transcript: string;
    if (step === "notes") {
      if (typeof sentTranscript !== "string" || sentTranscript.trim().length < 20) {
        return NextResponse.json({ ok: false, error: "No transcript provided" }, { status: 400 });
      }
      transcript = sentTranscript;
    } else {
      // Step 1: Download audio from Vercel Blob
      console.log(`Downloading: ${pathname}`);

      // Recordings are private and each user reads only their own folder.
      const recording = pathname.startsWith(`recordings/${session.user.email}/`)
        ? await get(pathname, { access: "private" })
        : null;

      if (!recording || recording.statusCode !== 200) {
        return NextResponse.json(
          { ok: false, error: "Recording not found" },
          { status: 404 }
        );
      }

      const audioBuffer = await new Response(recording.stream).arrayBuffer();

      // One transcription request takes a limited file size. Say so plainly
      // instead of failing inside the OpenAI call.
      const sizeProblem = tooLargeMessage(audioBuffer.byteLength);
      if (sizeProblem) {
        return NextResponse.json({ ok: false, error: sizeProblem }, { status: 413 });
      }

      // Step 2: Transcribe with the current speech model
      console.log(`Transcribing with ${TRANSCRIPTION_MODEL}...`);
      // The endpoint reads the format from the file name, so keep the real extension.
      const { name: audioName, type: audioType } = audioFileInfo(pathname);
      const audioFile = new File([audioBuffer], audioName, { type: audioType });

      const transcription = await openai.audio.transcriptions.create({
        model: TRANSCRIPTION_MODEL,
        file: audioFile,
        response_format: "json",
      });

      transcript = transcription.text;

      // A part with no speech (a break, say) is not an error. The browser skips it.
      if (step === "transcribe") {
        return NextResponse.json({ ok: true, transcript: (transcript || "").trim() });
      }

      if (!transcript || transcript.trim().length < 20) {
        return NextResponse.json({
          ok: false,
          error:
            "Transcript too short -- the recording may not have captured audio properly.",
        });
      }

      console.log(
        `Transcript: ${transcript.length} chars`
      );
    }

    // Step 3: Generate notes with OpenAI — prompt depends on mode
    console.log(`Generating notes (mode: ${mode})...`);
    const meetingDate = new Date().toISOString().split("T")[0];

    const systemPrompt = buildPrompt(mode, title, meetingDate);

    // The notes model reasons before it writes, and reasoning spends output
    // tokens. 16384 leaves well over 4096 for the notes at low effort.
    const response = await openai.responses.create({
      model: NOTES_MODEL,
      instructions: systemPrompt,
      input: `TRANSCRIPT:\n${transcript}`,
      max_output_tokens: 16384,
      reasoning: { effort: "low" },
    });

    const notesContent = getNotesText(response);

    // Step 4: Save notes to Vercel Blob
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const safeName = (title || "meeting")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 50);
    const notesFilename = `${timestamp}_${safeName}.md`;

    await put(`notes/${session.user.email}/${notesFilename}`, notesContent, {
      access: "private",
      addRandomSuffix: false,
      contentType: "text/markdown",
    });

    console.log(`✅ Notes saved: ${notesFilename}`);

    return NextResponse.json({
      ok: true,
      notesFile: notesFilename,
      notesText: notesContent,
    });
  } catch (error) {
    console.error("Processing error:", error);
    if (error instanceof OpenAI.APIError && error.status === 401) {
      return NextResponse.json(
        { ok: false, error: "OpenAI did not accept that API key. Check the key and try again." },
        { status: 400 }
      );
    }
    if (error instanceof OpenAI.APIError && error.status === 429 && /credit|quota/.test(String(error.code))) {
      return NextResponse.json(
        { ok: false, error: "Your OpenAI account has no credits. Add credits at platform.openai.com, then try again." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Processing failed",
      },
      { status: 500 }
    );
  }
}
