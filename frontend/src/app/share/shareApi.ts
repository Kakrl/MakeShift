// Browser client for the recordings API (#119, #122, #128). Same shape as
// the mock store, so the share UI does not care which one it is using.
import type {
  DeleteRecordingResponse,
  RecordingApiError,
  RecordingListResponse,
  SharedRecording,
  UploadRecordingRequest,
  UploadRecordingResponse,
} from "../../lib/recordings";

/** The share is already gone (a 404), so there is nothing left to stop. */
export class ShareNotFoundError extends Error {
  constructor() {
    super("Recording not found.");
    this.name = "ShareNotFoundError";
  }
}

export type ShareStore = {
  list(cursor?: string | null): Promise<RecordingListResponse>;
  /** Null when the recording is missing or hidden. */
  get(id: string): Promise<SharedRecording | null>;
  upload(request: UploadRecordingRequest): Promise<UploadRecordingResponse>;
  remove(id: string, deleteToken: string): Promise<DeleteRecordingResponse>;
};

// Prefer the first validation issue, which names the field.
async function apiError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as RecordingApiError | null;
  return new Error(body?.issues?.[0]?.message ?? body?.error ?? `Request failed (${response.status}).`);
}

export function createShareApi(fetchImpl: typeof fetch = (...args) => fetch(...args)): ShareStore {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`/api/recordings${path}`, { cache: "no-store", ...init });
    if (!response.ok) throw await apiError(response);
    return (await response.json()) as T;
  }

  const sendJson = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    list(cursor = null) {
      return call(cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
    },

    async get(id) {
      const response = await fetchImpl(`/api/recordings/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (response.status === 404) return null;
      if (!response.ok) throw await apiError(response);
      return (await response.json()) as SharedRecording;
    },

    upload(request) {
      return call("", sendJson("POST", request));
    },

    async remove(id, deleteToken) {
      const response = await fetchImpl(
        `/api/recordings/${encodeURIComponent(id)}`,
        sendJson("DELETE", { deleteToken }),
      );
      if (response.status === 404) throw new ShareNotFoundError();
      if (!response.ok) throw await apiError(response);
      return (await response.json()) as DeleteRecordingResponse;
    },
  };
}
