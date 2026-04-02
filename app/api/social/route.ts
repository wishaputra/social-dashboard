import { NextRequest, NextResponse } from "next/server";

import { getInstagramData } from "./lib/instagram";
import { getTikTokData } from "./lib/tiktok";
import { getYouTubeData } from "./lib/youtube";
import { clampLimit, normalizeUsername } from "./lib/utils";

export async function GET(request: NextRequest) {
  const limit = clampLimit(request.nextUrl.searchParams.get("limit"));
  const usernames = {
    tiktok: normalizeUsername(request.nextUrl.searchParams.get("tiktok")),
    youtube: normalizeUsername(request.nextUrl.searchParams.get("youtube"), true),
    instagram: normalizeUsername(request.nextUrl.searchParams.get("instagram")),
  };

  const [tiktok, youtube, instagram] = await Promise.all([
    usernames.tiktok ? getTikTokData(usernames.tiktok, limit) : Promise.resolve(null),
    usernames.youtube ? getYouTubeData(usernames.youtube, limit) : Promise.resolve(null),
    usernames.instagram ? getInstagramData(usernames.instagram, limit) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    requestedAt: new Date().toISOString(),
    limit,
    platforms: {
      tiktok,
      youtube,
      instagram,
    },
  });
}
