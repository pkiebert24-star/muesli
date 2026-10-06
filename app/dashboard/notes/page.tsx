import { get } from "@vercel/blob";
import Link from "next/link";
import { auth } from "@/auth";
import { isOwnNotePath, noteTitle, stripFrontmatter } from "@/lib/notes";
import { CopyNoteButton } from "../copy-note-button";

// Shows one saved note as an ordinary page, so a browser extension that reads
// the open tab (such as Content Genesis) can use its text.
export default async function NotePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const raw = (await searchParams).pathname;
  const pathname = typeof raw === "string" ? raw : "";

  let text: string | null = null;
  if (isOwnNotePath(pathname, email)) {
    const note = await get(pathname, { access: "private" });
    if (note && note.statusCode === 200) {
      text = stripFrontmatter(await new Response(note.stream).text());
    }
  }

  return (
    <div className="container">
      <div className="dash-header">
        <h1 className="dash-brand">Muesli</h1>
        <Link href="/dashboard" className="btn-ghost">Back</Link>
      </div>

      <article className="card">
        {text === null ? (
          <p>This note could not be found.</p>
        ) : (
          <>
            <h2 className="section-title">{noteTitle(pathname)}</h2>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.65, marginTop: 16 }}>{text}</div>
            <p style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <CopyNoteButton pathname={pathname} />
              <a
                href={`/api/notes/download?pathname=${encodeURIComponent(pathname)}`}
                download
                className="btn-sm neutral"
              >
                Download .md
              </a>
            </p>
          </>
        )}
      </article>
    </div>
  );
}
