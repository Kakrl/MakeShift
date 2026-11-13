import { deleteRecording, getRecording, recordingsDeps } from "../../../../server/recordings";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** One shared recording with its notes (#119). */
export async function GET(_request: Request, { params }: Context) {
  return getRecording((await params).id, recordingsDeps());
}

/** Stops sharing a recording given its delete token (#128). */
export async function DELETE(request: Request, { params }: Context) {
  return deleteRecording((await params).id, request, recordingsDeps());
}
