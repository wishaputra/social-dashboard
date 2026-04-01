import { NextRequest, NextResponse } from "next/server";

type PlatformKey = "tiktok" | "youtube" | "instagram";

type DashboardItem = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  contentType?: "video" | "short" | "live";
  views: number | null;
  viewsLabel: string;
  publishedLabel?: string;
};

type PlatformResult = {
  platform: PlatformKey;
  username: string;
  accountName: string;
  profileImageUrl?: string;
  totalViews: number | null;
  totalViewsLabel: string;
  followersLabel?: string;
  source: string;
  status: "success" | "partial" | "error";
  warnings: string[];
  items: DashboardItem[];
  error?: string;
};

const REQUEST_HEADERS: HeadersInit = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  pragma: "no-cache",
  "cache-control": "no-cache",
};

export async function GET(request: NextRequest) {
  const limit = clampLimit(request.nextUrl.searchParams.get("limit"));
  const usernames = {
    tiktok: normalizeUsername(request.nextUrl.searchParams.get("tiktok")),
    youtube: normalizeUsername(request.nextUrl.searchParams.get("youtube"), true),
    instagram: normalizeUsername(request.nextUrl.searchParams.get("instagram")),
  };

  const [tiktok, youtube, instagram] = await Promise.all([
    usernames.tiktok ? getTikTokData(usernames.tiktok) : Promise.resolve(null),
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

async function getYouTubeData(username: string, limit: number): Promise<PlatformResult> {
  const videosUrl = `https://www.youtube.com/@${username}/videos?hl=en`;
  const shortsUrl = `https://www.youtube.com/@${username}/shorts?hl=en`;
  const streamsUrl = `https://www.youtube.com/@${username}/streams?hl=en`;
  const aboutUrl = `https://www.youtube.com/@${username}/about?hl=en`;

  try {
    const [videosHtml, shortsHtml, streamsHtml, aboutHtml] = await Promise.all([
      fetchText(videosUrl).catch(() => null),
      fetchText(shortsUrl).catch(() => null),
      fetchText(streamsUrl).catch(() => null),
      fetchText(aboutUrl),
    ]);

    const videosData = videosHtml ? extractJsonAfter(videosHtml, "var ytInitialData = ") : null;
    const shortsData = shortsHtml ? extractJsonAfter(shortsHtml, "var ytInitialData = ") : null;
    const streamsData = streamsHtml ? extractJsonAfter(streamsHtml, "var ytInitialData = ") : null;
    const aboutData = extractJsonAfter(aboutHtml, "var ytInitialData = ");
    const channelMeta =
      extractObject(videosData, "channelMetadataRenderer") ??
      extractObject(shortsData, "channelMetadataRenderer") ??
      extractObject(streamsData, "channelMetadataRenderer") ??
      {};
    const aboutMeta = extractObject(aboutData, "channelAboutFullMetadataRenderer") ?? {};
    const videoItems = extractYouTubeVideoItems(videosData, "video");
    const liveItems = extractYouTubeVideoItems(streamsData, "live");
    const shortItems = extractYouTubeShortItems(shortsData);
    const fallbackItems = mergeSortedYouTubeItems([
      ...withYouTubeSortMeta(videoItems, "video"),
      ...withYouTubeSortMeta(liveItems, "live"),
      ...withYouTubeSortMeta(shortItems, "short"),
    ]);
    const channelId =
      getString(channelMeta, "externalId") ??
      getString(aboutMeta, "channelId") ??
      null;
    const detailItems = buildYouTubeDetailMap([...videoItems, ...liveItems, ...shortItems]);
    const items = channelId
      ? await buildYouTubeItemsFromFeed(channelId, detailItems, limit, fallbackItems)
      : fallbackItems.slice(0, limit);

    const warnings: string[] = [];

    if (items.length === 0) {
      warnings.push("Recent YouTube content could not be parsed from the current public channel pages.");
    }

    if (items.length < limit) {
      warnings.push("Only part of the recent YouTube content list could be parsed from the public pages.");
    }

    if (shortItems.length > 0) {
      warnings.push(
        "YouTube Shorts data is enriched from public channel pages; some items may still miss view metadata depending on public availability.",
      );
    }

    return {
      platform: "youtube",
      username,
      accountName: getString(channelMeta, "title") ?? `@${username}`,
      profileImageUrl: getThumbnailUrl(channelMeta.avatar),
      totalViews:
        parseCount(getText(aboutMeta.viewCountText) ?? "") ??
        sumViews(items),
      totalViewsLabel:
        getText(aboutMeta.viewCountText) ??
        formatNumber(sumViews(items)),
      followersLabel:
        getText(aboutMeta.subscriberCountText) ??
        getText(channelMeta.externalId) ??
        undefined,
      source: "YouTube public videos, streams, shorts, and about pages",
      status: items.length >= Math.min(limit, 5) ? "success" : "partial",
      warnings,
      items,
    };
  } catch (error) {
    return buildErrorResult("youtube", username, "Failed to read the public YouTube channel pages.", error);
  }
}

function extractYouTubeVideoItems(
  data: unknown,
  forcedType: "video" | "live",
): DashboardItem[] {
  const rawVideos = extractObjects(data, "videoRenderer");

  return rawVideos.map((video, index) => {
    const videoId = getString(video, "videoId") ?? `video-${index}`;
    const publishedLabel = getText(video.publishedTimeText) ?? undefined;
    const contentType = forcedType;
    const title =
      getText(video.title) ?? `${contentType === "live" ? "Live" : "Video"} ${index + 1}`;
    const viewLabel =
      getText(video.viewCountText) ??
      getText(video.shortViewCountText) ??
      "Views unavailable";

    return {
      id: `${contentType}-${videoId}`,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnailUrl: getThumbnailUrl(video.thumbnail),
      contentType,
      views: parseCount(viewLabel),
      viewsLabel: viewLabel,
      publishedLabel,
    };
  });
}

function extractYouTubeShortItems(data: unknown): DashboardItem[] {
  const rawShorts = extractObjects(data, "shortsLockupViewModel");

  return rawShorts.map((short, index) => {
    const videoId =
      getString(short, "onTap.innertubeCommand.reelWatchEndpoint.videoId") ??
      getString(
        short,
        "onTap.innertubeCommand.commandExecutorCommand.commands.0.reelWatchEndpoint.videoId",
      ) ??
      `${index}`;
    const title =
      getString(short, "overlayMetadata.primaryText.content") ??
      getString(short, "accessibilityText") ??
      `Short ${index + 1}`;
    const viewLabel =
      getString(short, "overlayMetadata.secondaryText.content") ??
      "Views unavailable";

    return {
      id: `short-${videoId}`,
      title,
      url: `https://www.youtube.com/shorts/${videoId}`,
      thumbnailUrl:
        getString(short, "thumbnail.sources.0.url") ??
        getString(short, "thumbnail.sources.1.url") ??
        undefined,
      contentType: "short",
      views: parseCount(viewLabel),
      viewsLabel: viewLabel,
      publishedLabel: undefined,
    };
  });
}

function mergeYouTubeItems(items: DashboardItem[]): DashboardItem[] {
  const uniqueItems = new Map<string, DashboardItem>();

  for (const item of items) {
    const normalizedUrl = item.url.replace("/shorts/", "/watch?v=");
    if (!uniqueItems.has(normalizedUrl)) {
      uniqueItems.set(normalizedUrl, item);
    }
  }

  return Array.from(uniqueItems.values());
}

function withYouTubeSortMeta(
  items: DashboardItem[],
  sourceType: NonNullable<DashboardItem["contentType"]>,
) {
  return items.map((item, index) => ({
    ...item,
    contentType: item.contentType ?? sourceType,
    sortAgeSeconds: parsePublishedAgeSeconds(item.publishedLabel),
    sourceIndex: index,
  }));
}

function mergeSortedYouTubeItems(
  items: Array<DashboardItem & { sortAgeSeconds: number | null; sourceIndex: number }>,
): DashboardItem[] {
  const deduped = mergeYouTubeItems(items);

  return deduped
    .map((item) => item as DashboardItem & { sortAgeSeconds?: number | null; sourceIndex?: number })
    .sort((left, right) => {
      const leftAge = left.sortAgeSeconds;
      const rightAge = right.sortAgeSeconds;
      const leftHasAge = leftAge != null;
      const rightHasAge = rightAge != null;

      if (leftHasAge && rightHasAge && leftAge !== rightAge) {
        return leftAge - rightAge;
      }

      if (leftHasAge !== rightHasAge) {
        return leftHasAge ? -1 : 1;
      }

      return (left.sourceIndex ?? 0) - (right.sourceIndex ?? 0);
    })
    .map((item) => {
      const cleanedItem = { ...item };
      delete cleanedItem.sortAgeSeconds;
      delete cleanedItem.sourceIndex;
      return cleanedItem;
    });
}

function buildYouTubeDetailMap(items: DashboardItem[]) {
  const detailMap = new Map<string, DashboardItem>();

  for (const item of items) {
    const videoId = getYouTubeVideoId(item.url);
    if (videoId) {
      detailMap.set(videoId, item);
    }
  }

  return detailMap;
}

async function buildYouTubeItemsFromFeed(
  channelId: string,
  detailMap: Map<string, DashboardItem>,
  limit: number,
  fallbackItems: DashboardItem[],
): Promise<DashboardItem[]> {
  try {
    const feedXml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    const feedEntries = parseYouTubeFeed(feedXml);

    const items = feedEntries
      .map((entry) => {
        const detailItem = detailMap.get(entry.videoId);

        return {
          id: detailItem?.id ?? `video-${entry.videoId}`,
          title: detailItem?.title ?? entry.title,
          url: detailItem?.url ?? `https://www.youtube.com/watch?v=${entry.videoId}`,
          thumbnailUrl:
            detailItem?.thumbnailUrl ??
            `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
          contentType: detailItem?.contentType ?? "video",
          views: detailItem?.views ?? null,
          viewsLabel: detailItem?.viewsLabel ?? "Unavailable",
          publishedLabel: formatPublishedLabel(entry.publishedAt),
        } satisfies DashboardItem;
      })
      .slice(0, limit);

    return items.length > 0 ? items : fallbackItems.slice(0, limit);
  } catch {
    return fallbackItems.slice(0, limit);
  }
}

function parseYouTubeFeed(xml: string) {
  const entries = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g));

  return entries.map(([, entryXml]) => ({
    videoId: decodeXml(extractXmlValue(entryXml, "yt:videoId") ?? ""),
    title: decodeXml(extractXmlValue(entryXml, "title") ?? "Untitled content"),
    publishedAt: extractXmlValue(entryXml, "published") ?? "",
  }));
}

function extractXmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? null;
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatPublishedLabel(value: string) {
  if (!value) {
    return undefined;
  }

  const publishedDate = new Date(value);
  if (Number.isNaN(publishedDate.getTime())) {
    return undefined;
  }

  const secondsAgo = Math.max(0, Math.floor((Date.now() - publishedDate.getTime()) / 1000));
  const intervals = [
    { label: "year", seconds: 60 * 60 * 24 * 365 },
    { label: "month", seconds: 60 * 60 * 24 * 30 },
    { label: "week", seconds: 60 * 60 * 24 * 7 },
    { label: "day", seconds: 60 * 60 * 24 },
    { label: "hour", seconds: 60 * 60 },
    { label: "minute", seconds: 60 },
  ];

  for (const interval of intervals) {
    if (secondsAgo >= interval.seconds) {
      const amount = Math.floor(secondsAgo / interval.seconds);
      return `${amount} ${interval.label}${amount > 1 ? "s" : ""} ago`;
    }
  }

  return "Just now";
}

function getYouTubeVideoId(url: string) {
  const shortsMatch = url.match(/\/shorts\/([^/?]+)/);
  if (shortsMatch) {
    return shortsMatch[1];
  }

  const watchMatch = url.match(/[?&]v=([^&]+)/);
  return watchMatch?.[1] ?? null;
}

function parsePublishedAgeSeconds(label?: string) {
  if (!label) {
    return null;
  }

  const normalized = label.toLowerCase().replace(/^streamed\s+/, "").trim();
  const match = normalized.match(/(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago/);

  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  if (Number.isNaN(amount)) {
    return null;
  }

  const unit = match[2];
  const multipliers: Record<string, number> = {
    minute: 60,
    minutes: 60,
    hour: 60 * 60,
    hours: 60 * 60,
    day: 60 * 60 * 24,
    days: 60 * 60 * 24,
    week: 60 * 60 * 24 * 7,
    weeks: 60 * 60 * 24 * 7,
    month: 60 * 60 * 24 * 30,
    months: 60 * 60 * 24 * 30,
    year: 60 * 60 * 24 * 365,
    years: 60 * 60 * 24 * 365,
  };

  return amount * multipliers[unit];
}

async function getInstagramData(username: string, limit: number): Promise<PlatformResult> {
  const profileUrl = `https://www.instagram.com/${username}/`;

  try {
    const html = await fetchText(profileUrl);
    const profileImageUrl = extractMetaTag(html, "og:image");
    const accountName = decodeHtmlEntities(
      extractMetaTag(html, "og:title")?.split(" (@")[0] ?? username,
    );
    const description = decodeHtmlEntities(
      extractMetaTag(html, "og:description") ??
        extractNamedMetaTag(html, "description") ??
        "",
    );

    const followersLabel = description.match(/^([^,]+ Followers)/i)?.[1];
    const userId = html.match(/"id":"(\d+)"/)?.[1];
    const items = userId ? await tryInstagramFeed(userId, profileUrl, limit) : [];
    const warnings: string[] = [];

    if (items.length === 0) {
      warnings.push(
        "Instagram exposes profile metadata publicly, but recent post view counts are frequently blocked for logged-out requests.",
      );
    }

    return {
      platform: "instagram",
      username,
      accountName,
      profileImageUrl: profileImageUrl ?? undefined,
      totalViews: sumViews(items),
      totalViewsLabel:
        items.length > 0
          ? `${formatNumber(sumViews(items))} across fetched posts`
          : "Unavailable from public Instagram metadata",
      followersLabel,
      source: "Instagram public profile metadata",
      status: items.length > 0 ? "partial" : "partial",
      warnings,
      items,
    };
  } catch (error) {
    return buildErrorResult(
      "instagram",
      username,
      "Failed to read the public Instagram profile page.",
      error,
    );
  }
}

async function tryInstagramFeed(userId: string, referer: string, limit: number): Promise<DashboardItem[]> {
  const response = await fetch(
    `https://www.instagram.com/api/v1/feed/user/${userId}/username/?count=${limit}`,
    {
      headers: {
        ...REQUEST_HEADERS,
        referer,
        "x-ig-app-id": "936619743392459",
        "x-requested-with": "XMLHttpRequest",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as {
    items?: Array<Record<string, unknown>>;
  };

  return (data.items ?? []).slice(0, limit).map((item, index) => {
    const code = getString(item, "code") ?? `instagram-${index}`;
    const viewCount = getNumber(item, "view_count");
    const playCount = getNumber(item, "play_count");

    return {
      id: code,
      title:
        getString(item, "caption.text") ??
        getString(item, "accessibility_caption") ??
        `Instagram post ${index + 1}`,
      url: `https://www.instagram.com/p/${code}/`,
      thumbnailUrl:
        getString(item, "image_versions2.candidates.0.url") ??
        getString(item, "thumbnail_url") ??
        undefined,
      views: viewCount ?? playCount ?? null,
      viewsLabel:
        viewCount != null || playCount != null
          ? formatNumber(viewCount ?? playCount ?? 0)
          : "Unavailable",
      publishedLabel: undefined,
    };
  });
}

async function getTikTokData(username: string): Promise<PlatformResult> {
  const desktopUrl = `https://www.tiktok.com/@${username}?lang=en`;
  const shareUrl = `https://m.tiktok.com/h5/share/usr/${username}.html`;

  try {
    const [desktopHtml, shareHtml] = await Promise.all([
      fetchText(desktopUrl),
      fetchText(shareUrl),
    ]);

    const universalData =
      extractJsonFromScript(desktopHtml, "__UNIVERSAL_DATA_FOR_REHYDRATION__") ?? {};
    const shareData =
      extractJsonFromScript(shareHtml, "__INIT_PROPS__") ?? {};

    const desktopUser =
      extractObject(universalData, "webapp.user-detail.userInfo.user") ?? {};
    const desktopStats =
      extractObject(universalData, "webapp.user-detail.userInfo.statsV2") ??
      extractObject(universalData, "webapp.user-detail.userInfo.stats") ??
      {};
    const shareUser =
      extractObject(shareData, "sharing.user.user_state.userInfo.user") ?? {};
    const shareStats =
      extractObject(shareData, "sharing.user.user_state.userInfo.stats") ?? {};

    const accountName =
      getString(desktopUser, "nickname") ??
      getString(shareUser, "nickname") ??
      username;
    const followerLabel =
      `${formatNumber(
        parseCount(String(getString(desktopStats, "followerCount") ?? "")) ??
          getNumber(shareStats, "followerCount") ??
          0,
      )} followers`;
    const warning =
      "TikTok no longer exposes a stable logged-out list of recent post view counts on the public web pages used here, so this card shows account-level metadata only.";

    return {
      platform: "tiktok",
      username,
      accountName,
      profileImageUrl:
        getString(desktopUser, "avatarMedium") ??
        getString(shareUser, "avatarMedium") ??
        undefined,
      totalViews: null,
      totalViewsLabel: "Unavailable from public TikTok profile pages",
      followersLabel: followerLabel,
      source: "TikTok public profile pages",
      status: "partial",
      warnings: [warning],
      items: [],
    };
  } catch (error) {
    return buildErrorResult("tiktok", username, "Failed to read the public TikTok profile page.", error);
  }
}

function buildErrorResult(
  platform: PlatformKey,
  username: string,
  message: string,
  error: unknown,
): PlatformResult {
  return {
    platform,
    username,
    accountName: username,
    totalViews: null,
    totalViewsLabel: "Unavailable",
    source: "Public profile pages",
    status: "error",
    warnings: [],
    items: [],
    error: `${message} ${error instanceof Error ? error.message : ""}`.trim(),
  };
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request to ${url} failed with ${response.status}`);
  }

  return response.text();
}

function normalizeUsername(value: string | null, keepAt = false) {
  if (!value) {
    return "";
  }

  const trimmed = value.trim().replace(/^https?:\/\/(www\.)?/, "");
  const withoutPath = trimmed
    .replace(/^(youtube\.com\/@|youtube\.com\/channel\/|instagram\.com\/|tiktok\.com\/@)/i, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "");

  return keepAt ? withoutPath : withoutPath;
}

function clampLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "5", 10);

  if (Number.isNaN(parsed)) {
    return 5;
  }

  return Math.min(Math.max(parsed, 5), 20);
}

function extractJsonFromScript(html: string, scriptId: string) {
  const pattern = new RegExp(
    `<script[^>]*id=["']${scriptId}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i",
  );
  const match = html.match(pattern);

  if (!match) {
    return null;
  }

  return safeJsonParse(match[1]);
}

function extractJsonAfter(html: string, marker: string) {
  const markerIndex = html.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const startIndex = html.indexOf("{", markerIndex);
  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < html.length; i += 1) {
    const char = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return safeJsonParse(html.slice(startIndex, i + 1));
      }
    }
  }

  return null;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractObjects(root: unknown, key: string) {
  const results: Record<string, unknown>[] = [];

  visit(root, (node) => {
    if (node && typeof node === "object" && key in node) {
      const found = (node as Record<string, unknown>)[key];
      if (found && typeof found === "object" && !Array.isArray(found)) {
        results.push(found as Record<string, unknown>);
      }
    }
  });

  return results;
}

function extractObject(root: unknown, path: string) {
  const direct = getByPath(root, path);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const key = path.split(".").pop() ?? path;
  return extractObjects(root, key)[0] ?? null;
}

function getByPath(input: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, input);
}

function visit(input: unknown, callback: (value: Record<string, unknown>) => void) {
  if (!input || typeof input !== "object") {
    return;
  }

  if (Array.isArray(input)) {
    input.forEach((value) => visit(value, callback));
    return;
  }

  callback(input as Record<string, unknown>);
  Object.values(input).forEach((value) => visit(value, callback));
}

function getText(input: unknown): string | null {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    return input;
  }

  if (typeof input !== "object") {
    return null;
  }

  if ("simpleText" in input && typeof (input as { simpleText?: unknown }).simpleText === "string") {
    return (input as { simpleText: string }).simpleText;
  }

  if ("text" in input && typeof (input as { text?: unknown }).text === "string") {
    return (input as { text: string }).text;
  }

  if ("runs" in input && Array.isArray((input as { runs?: unknown }).runs)) {
    return ((input as { runs: Array<{ text?: string }> }).runs ?? [])
      .map((run) => run.text ?? "")
      .join("")
      .trim();
  }

  return null;
}

function getThumbnailUrl(input: unknown) {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const thumbnails = getByPath(input, "thumbnails");
  if (!Array.isArray(thumbnails)) {
    return undefined;
  }

  const lastThumbnail = thumbnails[thumbnails.length - 1];
  if (!lastThumbnail || typeof lastThumbnail !== "object") {
    return undefined;
  }

  return getString(lastThumbnail, "url") ?? undefined;
}

function getString(input: unknown, path: string) {
  const value = getByPath(input, path);
  return typeof value === "string" ? value : null;
}

function getNumber(input: unknown, path: string) {
  const value = getByPath(input, path);
  return typeof value === "number" ? value : null;
}

function parseCount(value: string) {
  if (!value) {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .replace(/x ditonton|views?|followers?|subscribers?|likes?|across fetched posts/g, "")
    .replace(/,/g, ".")
    .replace(/\u00a0/g, " ")
    .trim();

  const match = normalized.match(/([\d.]+)\s*(k|m|b|jt|rb)?/i);
  if (!match) {
    return null;
  }

  const base = Number.parseFloat(match[1]);
  if (Number.isNaN(base)) {
    return null;
  }

  const multiplier = match[2]?.toLowerCase();

  if (multiplier === "k" || multiplier === "rb") {
    return Math.round(base * 1_000);
  }

  if (multiplier === "m" || multiplier === "jt") {
    return Math.round(base * 1_000_000);
  }

  if (multiplier === "b") {
    return Math.round(base * 1_000_000_000);
  }

  const digits = normalized.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }

  return Number.parseInt(digits, 10);
}

function sumViews(items: DashboardItem[]) {
  return items.reduce((sum, item) => sum + (item.views ?? 0), 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function extractMetaTag(html: string, property: string) {
  const pattern = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return html.match(pattern)?.[1] ?? null;
}

function extractNamedMetaTag(html: string, name: string) {
  const pattern = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return html.match(pattern)?.[1] ?? null;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
