// lib/config.ts — edge-safe: reads env only, imports nothing.
export function isGoogleEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

// True when the deployment has its own OpenAI key. When it has none, each
// person enters their own key in the app and it is sent with each request.
export function hasServerOpenAIKey(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

// Older Blob stores give the project a read-write token. Newer ones set a store ID
// and a webhook key instead, and uploads use presigned URLs.
export function hasBlobToken(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());
}
