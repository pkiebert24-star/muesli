import { NextResponse } from "next/server";
import { connection } from "next/server";
import { hasBlobToken, hasServerOpenAIKey } from "@/lib/config";

// Tells the dashboard whether to ask for an OpenAI key and how to upload recordings.
// Never returns a key.
export async function GET() {
  await connection();
  return NextResponse.json({
    needsOpenAIKey: !hasServerOpenAIKey(),
    blobMode: hasBlobToken() ? "token" : "presigned",
  });
}
