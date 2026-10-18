import { redirect } from "next/navigation";

/**
 * Share links stay short (`/play/<id>`) but open the song in the shared songs
 * dialog over the play screen rather than on a page of their own.
 */
export default async function SharedRecordingLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/?song=${encodeURIComponent(id)}`);
}
