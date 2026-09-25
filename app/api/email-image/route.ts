import { NextRequest, NextResponse } from "next/server";
import { gmailClient, } from "@/lib/google";
import { refreshAccessToken } from "@/lib/google";
import { getRefreshToken, setAccessToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowedMime(mime: string) {
  return /^image\/(jpeg|png|gif|webp|avif|svg\+xml)$/i.test(mime);
}

export async function GET(req: NextRequest) {
  const messageId = req.nextUrl.searchParams.get("messageId");
  const attachmentId = req.nextUrl.searchParams.get("attachmentId");
  const mimeType = req.nextUrl.searchParams.get("mimeType") || "image/jpeg";

  if (!messageId || !attachmentId || !allowedMime(mimeType)) {
    return new NextResponse("bad_request", { status: 400 });
  }

  const refresh = await getRefreshToken();
  if (!refresh) return new NextResponse("not_connected", { status: 401 });

  const accessToken = await refreshAccessToken(refresh);
  if (!accessToken) return new NextResponse("not_connected", { status: 401 });
  await setAccessToken(accessToken);

  try {
    const gmail = await gmailClient(accessToken);
    const result = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });

    if (!result.data.data) return new NextResponse("image_not_found", { status: 404 });

    const bytes = Buffer.from(
      result.data.data.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );

    return new NextResponse(bytes as any, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (e) {
    console.error("[api/email-image]", e);
    return new NextResponse("image_fetch_failed", { status: 502 });
  }
}
