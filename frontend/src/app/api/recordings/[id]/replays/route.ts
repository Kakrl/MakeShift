import { recordReplay, recordingsDeps } from "../../../../../server/recordings";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return recordReplay((await params).id, request, recordingsDeps());
}
