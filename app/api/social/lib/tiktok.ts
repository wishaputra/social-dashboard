import { DashboardItem, PlatformResult } from "./types";
import {
  REQUEST_HEADERS,
  buildErrorResult,
  extractJsonFromScript,
  extractObject,
  fetchRapidApiJson,
  fetchText,
  formatNumber,
  getArrayByPath,
  getFirstNumber,
  getFirstString,
  getNumber,
  getRapidApiConfig,
  getString,
  parseCount,
  readCookieHeader,
  sumViews,
} from "./utils";

export async function getTikTokData(
  username: string,
  limit: number,
): Promise<PlatformResult> {
  const debug: string[] = [];
  const rapidApiConfigured = Boolean(getRapidApiConfig("tiktok"));
  debug.push(
    rapidApiConfigured
      ? "debug: RapidAPI TikTok config detected"
      : "debug: RapidAPI TikTok config missing",
  );

  const rapidApiResult = await tryTikTokRapidApi(username, limit, debug);
  if (rapidApiResult) {
    rapidApiResult.debug = debug;
    return rapidApiResult;
  }

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
    const secUid =
      getString(desktopUser, "secUid") ??
      getString(shareUser, "secUid") ??
      undefined;
    const items = secUid
      ? await tryTikTokPublicItemList(secUid, username, limit, debug)
      : [];
    if (!secUid) {
      debug.push("debug: TikTok secUid not found on public page");
    }
    const warnings =
      items.length > 0
        ? []
        : [
            "TikTok public pages currently expose account metadata more reliably than recent post data. Configure RapidAPI for a more consistent recent-post feed.",
          ];

    if (!getRapidApiConfig("tiktok")) {
      warnings.push(
        "RapidAPI TikTok credentials are not configured in this environment, so the app is limited to public web fallbacks.",
      );
    }

    return {
      platform: "tiktok",
      username,
      accountName,
      profileImageUrl:
        getString(desktopUser, "avatarMedium") ??
        getString(shareUser, "avatarMedium") ??
        undefined,
      totalViews: items.length > 0 ? sumViews(items) : null,
      totalViewsLabel:
        items.length > 0
          ? `${formatNumber(sumViews(items))} across fetched posts`
          : "Unavailable from public TikTok profile pages",
      followersLabel: followerLabel,
      source: "TikTok public profile pages",
      status: items.length > 0 ? "success" : "partial",
      warnings,
      debug,
      items,
    };
  } catch (error) {
    debug.push(
      `debug: TikTok public profile fetch failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return buildErrorResult(
      "tiktok",
      username,
      `Failed to read the public TikTok profile page. ${debug.join(" | ")}`,
      error,
    );
  }
}

async function tryTikTokRapidApi(
  username: string,
  limit: number,
  debug: string[],
): Promise<PlatformResult | null> {
  const config = getRapidApiConfig("tiktok");
  if (!config) {
    debug.push("debug: skip TikTok RapidAPI because env is incomplete");
    return null;
  }

  try {
    const profileData = await fetchRapidApiJson(config.profileUrl, config.host, {
      username,
      limit,
    });
    debug.push("debug: TikTok RapidAPI profile request succeeded");

    const secUid =
      getFirstString(profileData, [
        "data.userInfo.user.secUid",
        "userInfo.user.secUid",
        "data.user.secUid",
        "user.secUid",
        "secUid",
      ]) ?? null;

    let postsData: unknown = null;
    if (config.postsUrl && secUid) {
      postsData = await fetchRapidApiJson(config.postsUrl, config.host, {
        username,
        limit,
        secUid,
      }).catch(() => null);
    }

    if (postsData) {
      debug.push("debug: TikTok RapidAPI posts request succeeded");
    } else if (config.postsUrl) {
      debug.push(
        secUid
          ? "debug: TikTok RapidAPI posts request returned null"
          : "debug: TikTok RapidAPI posts skipped because secUid was missing from profile response",
      );
    }

    const accountName =
      getFirstString(profileData, [
        "data.userInfo.user.nickname",
        "userInfo.user.nickname",
        "data.user.nickname",
        "user.nickname",
        "data.nickname",
        "nickname",
        "data.user.uniqueId",
        "user.uniqueId",
      ]) ?? username;
    const profileImageUrl =
      getFirstString(profileData, [
        "data.userInfo.user.avatarLarger",
        "data.userInfo.user.avatarMedium",
        "userInfo.user.avatarLarger",
        "userInfo.user.avatarMedium",
        "data.user.avatarLarger",
        "data.user.avatarMedium",
        "user.avatarLarger",
        "user.avatarMedium",
      ]) ?? undefined;
    const followersCount = getFirstNumber(profileData, [
      "data.userInfo.stats.followerCount",
      "data.userInfo.statsV2.followerCount",
      "userInfo.stats.followerCount",
      "userInfo.statsV2.followerCount",
      "data.stats.followerCount",
      "stats.followerCount",
      "data.followerCount",
      "followerCount",
    ]);
    const items = extractTikTokRapidApiItems(postsData ?? profileData, username, limit);

    return {
      platform: "tiktok",
      username,
      accountName,
      profileImageUrl,
      totalViews: items.length > 0 ? sumViews(items) : null,
      totalViewsLabel:
        items.length > 0
          ? `${formatNumber(sumViews(items))} across fetched posts`
          : "Unavailable from RapidAPI response",
      followersLabel:
        followersCount != null ? `${formatNumber(followersCount)} followers` : undefined,
      source: `RapidAPI (${config.host})`,
      status: items.length > 0 ? "success" : "partial",
      warnings:
        items.length > 0
          ? []
          : ["RapidAPI profile data loaded, but recent TikTok post views were unavailable."],
      debug,
      items,
    };
  } catch (error) {
    debug.push(
      `debug: TikTok RapidAPI failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return null;
  }
}

function extractTikTokRapidApiItems(
  data: unknown,
  username: string,
  limit: number,
): DashboardItem[] {
  const postArrays = [
    getArrayByPath(data, "data.itemList"),
    getArrayByPath(data, "itemList"),
    getArrayByPath(data, "data.aweme_list"),
    getArrayByPath(data, "aweme_list"),
    getArrayByPath(data, "data.items"),
    getArrayByPath(data, "data.data.items"),
    getArrayByPath(data, "items"),
    getArrayByPath(data, "videos"),
    getArrayByPath(data, "data.videos"),
  ].filter(Array.isArray) as unknown[][];

  const rawItems = postArrays.flat().slice(0, limit);

  return rawItems.map((item, index) => {
    const videoId =
      getFirstString(item, ["aweme_id", "id", "video.id", "videoId"]) ?? `tiktok-${index}`;
    const viewCount = getFirstNumber(item, [
      "statistics.playCount",
      "stats.play_count",
      "stats.playCount",
      "play_count",
      "view_count",
      "views",
    ]);

    return {
      id: videoId,
      title:
        getFirstString(item, ["desc", "title", "video_description"]) ?? `TikTok video ${index + 1}`,
      url:
        getFirstString(item, ["share_url", "shareUrl"]) ??
        `https://www.tiktok.com/@${username}/video/${videoId}`,
      thumbnailUrl:
        getFirstString(item, [
          "video.cover",
          "video.dynamicCover",
          "video.originCover",
          "cover",
        ]) ?? undefined,
      contentType: "video",
      views: viewCount,
      viewsLabel: viewCount != null ? formatNumber(viewCount) : "Unavailable",
      publishedLabel: undefined,
      } satisfies DashboardItem;
  });
}

async function tryTikTokPublicItemList(
  secUid: string,
  username: string,
  limit: number,
  debug: string[],
): Promise<DashboardItem[]> {
  const profileUrl = `https://www.tiktok.com/@${username}?lang=en`;
  const initialResponse = await fetch(profileUrl, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });
  const setCookie = initialResponse.headers.get("set-cookie") ?? "";
  const cookieHeader =
    readCookieHeader(["ttcookies.txt", "tiktok-cookies.txt"]) ??
    extractCookieSubset(setCookie, ["ttwid", "tt_csrf_token", "msToken"]);
  debug.push(
    cookieHeader
      ? "debug: TikTok cookie header prepared for item list request"
      : "debug: TikTok item list request has no cookie header",
  );
  const msToken = extractCookieValue(cookieHeader, "msToken");

  const url = new URL("https://www.tiktok.com/api/post/item_list/");
  url.searchParams.set("aid", "1988");
  url.searchParams.set("count", String(limit));
  url.searchParams.set("cursor", "0");
  url.searchParams.set("secUid", secUid);
  url.searchParams.set("WebIdLastTime", "0");

  if (msToken) {
    url.searchParams.set("msToken", msToken);
  }

  const response = await fetch(url.toString(), {
    headers: {
      ...REQUEST_HEADERS,
      accept: "application/json,text/plain,*/*",
      referer: profileUrl,
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    debug.push(`debug: TikTok item_list returned ${response.status}`);
    return [];
  }

  const text = await response.text();
  if (!text.trim()) {
    debug.push("debug: TikTok item_list returned empty body");
    return [];
  }

  const parsed = JSON.parse(text) as unknown;
  const items = extractTikTokRapidApiItems(parsed, username, limit);
  debug.push(`debug: TikTok item_list returned ${items.length} parsed item(s)`);
  return items;
}

function extractCookieSubset(cookieHeader: string, names: string[]) {
  const parts = names
    .map((name) => {
      const value = extractCookieValue(cookieHeader, name);
      return value ? `${name}=${value}` : null;
    })
    .filter(Boolean);

  return parts.length > 0 ? parts.join("; ") : undefined;
}

function extractCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}
