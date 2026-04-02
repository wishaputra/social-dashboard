import { DashboardItem, PlatformResult } from "./types";
import {
  buildErrorResult,
  extractJsonAfter,
  extractObject,
  extractObjects,
  fetchText,
  formatNumber,
  getString,
  getText,
  getThumbnailUrl,
  parseCount,
  sumViews,
} from "./utils";

export async function getYouTubeData(
  username: string,
  limit: number,
): Promise<PlatformResult> {
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
    const fallbackItems = mixLatestYouTubeItems(videoItems, shortItems, liveItems, limit);
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
        getString(short, "onTap.innertubeCommand.reelWatchEndpoint.thumbnail.thumbnails.0.url") ??
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

function mixLatestYouTubeItems(
  videoItems: DashboardItem[],
  shortItems: DashboardItem[],
  liveItems: DashboardItem[],
  limit: number,
) {
  const queues = [
    [...videoItems],
    [...shortItems],
    [...liveItems],
  ];
  const mixedItems: DashboardItem[] = [];

  while (mixedItems.length < limit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const nextItem = queue.shift();
      if (!nextItem) {
        continue;
      }

      mixedItems.push(nextItem);
      if (mixedItems.length >= limit) {
        break;
      }
    }
  }

  return mergeYouTubeItems(mixedItems).slice(0, limit);
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
    const feedItems = feedEntries.map((entry) => {
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
    });

    const feedItemMap = new Map<string, DashboardItem>();
    for (const item of feedItems) {
      const videoId = getYouTubeVideoId(item.url);
      if (videoId) {
        feedItemMap.set(videoId, item);
      }
    }

    const enrichedFallbackItems = fallbackItems.map((item) => {
      const videoId = getYouTubeVideoId(item.url);
      const feedItem = videoId ? feedItemMap.get(videoId) : null;

      if (!feedItem) {
        return item;
      }

      return {
        ...item,
        publishedLabel: item.publishedLabel ?? feedItem.publishedLabel,
        thumbnailUrl: item.thumbnailUrl ?? feedItem.thumbnailUrl,
        title: item.title || feedItem.title,
      } satisfies DashboardItem;
    });

    const feedOnlyItems = feedItems.filter((item) => {
      const videoId = getYouTubeVideoId(item.url);
      return videoId ? !detailMap.has(videoId) : true;
    });

    const mergedItems = mergeYouTubeItems([
      ...enrichedFallbackItems,
      ...feedOnlyItems,
    ]).slice(0, limit);

    return mergedItems.length > 0 ? mergedItems : fallbackItems.slice(0, limit);
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
