import { listRecordings, recordingsDeps, uploadRecording } from "../../../server/recordings";

export const dynamic = "force-dynamic";

/** Shared recordings, newest first (#119). */
export function GET(request: Request) {
  return listRecordings(request, recordingsDeps());
}

/** Shares a recording and returns its delete token once (#122). */
export function POST(request: Request) {
  return uploadRecording(request, recordingsDeps());
}
