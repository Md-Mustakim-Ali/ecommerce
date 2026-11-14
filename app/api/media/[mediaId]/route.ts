import { downloadFile } from "@/lib/media/google/drive";
import { accessTokenForGrant } from "@/lib/media/google/oauth";
import {
  loadGrantCandidates,
  loadGrantCredentials,
  loadServableMedia,
} from "@/lib/media/repository";

/**
 * Serves a Drive-backed asset from this origin.
 *
 * The bytes stay in the seller's Drive, which is the entire point of letting
 * them connect it — mirroring into R2 would store everything twice and put the
 * storage cost straight back on the platform. But Drive is not a CDN, and the
 * undocumented hotlink URLs rate-limit on anything popular and have been broken
 * by Google more than once. So the file is streamed through here instead.
 *
 * Two things make that affordable. The response is streamed rather than
 * buffered, because holding whole images in memory on a 512 MB instance is an
 * OOM restart waiting for a busy afternoon. And it is cached immutably: a media
 * row maps to exactly one Drive file for its whole life — replacing a photo
 * creates a new row with a new id — so the CDN can hold it forever and Drive is
 * touched roughly once per file rather than once per view.
 */

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  const { mediaId } = await params;

  const media = await loadServableMedia(mediaId);
  if (!media || media.provider !== "drive" || !media.providerRef) {
    return new Response("Not found", { status: 404 });
  }

  // Anything not ready has no bytes worth serving — a queued row, or one whose
  // file was deleted at the source.
  if (media.state !== "ready") {
    return new Response("Not found", { status: 404 });
  }

  const candidates = await loadGrantCandidates(media.storeId);
  const grant = candidates.find(
    (candidate) =>
      candidate.accountId === media.googleAccountId &&
      candidate.grantState === "active",
  );

  if (!grant) {
    // Only the account that uploaded a file can read it back. Losing that
    // grant means the asset is unreachable until the seller reconnects.
    return new Response("Media unavailable", { status: 404 });
  }

  const credentials = await loadGrantCredentials(grant.grantId);
  if (!credentials) return new Response("Media unavailable", { status: 404 });

  try {
    const token = await accessTokenForGrant(grant.grantId, credentials);
    const upstream = await downloadFile(token, media.providerRef);

    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);

    headers.set("cache-control", "public, max-age=31536000, immutable");
    // The upstream URL carries an access token in its Authorization header;
    // nothing about the Google request should leak to the client.
    headers.set("x-content-type-options", "nosniff");

    return new Response(upstream.body, { status: 200, headers });
  } catch {
    // Deliberately opaque. The caller is a browser rendering a product photo,
    // and Google's error text can name the seller's account.
    return new Response("Media unavailable", { status: 502 });
  }
}
