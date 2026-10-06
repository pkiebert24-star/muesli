import { issueSignedToken } from '@vercel/blob';
import {
  handleUpload,
  handleUploadPresigned,
  type HandleUploadBody,
  type HandleUploadPresignedBody,
} from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { ALLOWED_UPLOAD_TYPES, isOwnRecordingPath } from '@/lib/audio';
import { hasBlobToken } from '@/lib/config';

// A hard ceiling for one upload. Transcription takes far less (see lib/audio.ts).
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// The signed-in person, or an error. Recordings go only into their own folder.
async function requireUser(pathname: string) {
  const session = await auth();
  if (!session?.user?.email || !session?.user?.id) {
    throw new Error('Unauthorized');
  }
  if (!isOwnRecordingPath(pathname, session.user.email)) {
    throw new Error('Not allowed. Reload the page and try again.');
  }
  return { email: session.user.email, id: session.user.id };
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody | HandleUploadPresignedBody;

  try {
    // A store with a read-write token uses client tokens. A newer store (store ID,
    // no token) uses presigned URLs. The dashboard asks /api/settings which one.
    if (hasBlobToken()) {
      const jsonResponse = await handleUpload({
        body: body as HandleUploadBody,
        request,
        onBeforeGenerateToken: async (pathname: string) => {
          const user = await requireUser(pathname);
          return {
            allowedContentTypes: ALLOWED_UPLOAD_TYPES,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            tokenPayload: JSON.stringify({ userId: user.id }),
          };
        },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          console.log('blob upload completed', blob, tokenPayload);
        },
      });
      return NextResponse.json(jsonResponse);
    }

    const jsonResponse = await handleUploadPresigned({
      body: body as HandleUploadPresignedBody,
      request,
      getSignedToken: async (pathname: string) => {
        const user = await requireUser(pathname);
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          allowedContentTypes: ALLOWED_UPLOAD_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
        });
        return { token, urlOptions: { tokenPayload: JSON.stringify({ userId: user.id }) } };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 }, // The webhook will retry 5 times waiting for a 200
    );
  }
}
