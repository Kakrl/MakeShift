import { redirect } from "next/navigation";

/**
 * Share links stay short (`/play/<id>`) but open the song in the shared songs
 * dialog over the play screen rather than on a page of their own.
 */
export default async function SharedRecordingLink({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mock?: string | string[] }>;
}) {
  const { id } = await params;
  // A mock share's link stays on the mock store (see shareUrl).
  const mock = (await searchParams).mock !== undefined ? "&mock=1" : "";
  redirect(`/?song=${encodeURIComponent(id)}${mock}`);
}
