import { DashboardItem, PlatformResult } from "./types";
import {
  REQUEST_HEADERS,
  buildErrorResult,
  decodeHtmlEntities,
  extractMetaTag,
  extractNamedMetaTag,
  fetchRapidApiJson,
  fetchText,
  formatNumber,
  getArrayByPath,
  getByPath,
  getFirstNumber,
  getFirstString,
  getNumber,
  getRapidApiConfig,
  getString,
  readCookieHeader,
  sumViews,
} from "./utils";

export async function getInstagramData(
  username: string,
  limit: number,
): Promise<PlatformResult> {
  const debug: string[] = [];
  const rapidApiConfigured = Boolean(getRapidApiConfig("instagram"));
  debug.push(
    rapidApiConfigured
      ? "debug: RapidAPI Instagram config detected"
      : "debug: RapidAPI Instagram config missing",
  );

  const rapidApiResult = await tryInstagramRapidApi(username, limit, debug);
  if (rapidApiResult) {
    rapidApiResult.debug = debug;
    return rapidApiResult;
  }

  const webProfileInfoResult = await tryInstagramWebProfileInfo(username, limit, debug);
  if (webProfileInfoResult) {
    webProfileInfoResult.debug = debug;
    return webProfileInfoResult;
  }

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

    if (!getRapidApiConfig("instagram")) {
      warnings.push(
        "RapidAPI Instagram credentials are not configured in this environment, so richer post data can only come from public web fallbacks.",
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
      status: "partial",
      warnings,
      debug,
      items,
    };
  } catch (error) {
    debug.push(
      `debug: public profile fetch failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return buildErrorResult(
      "instagram",
      username,
      `Failed to read the public Instagram profile page. ${debug.join(" | ")}`,
      error,
    );
  }
}

async function tryInstagramFeed(
  userId: string,
  referer: string,
  limit: number,
  debug?: string[],
): Promise<DashboardItem[]> {
  const cookieHeader = readCookieHeader(["igcookies.txt", "instagram-cookies.txt"]);
  debug?.push(
    cookieHeader
      ? "debug: Instagram cookie file loaded for feed request"
      : "debug: Instagram cookie file not found for feed request",
  );
  const response = await fetch(
    `https://www.instagram.com/api/v1/feed/user/${userId}/username/?count=${limit}`,
    {
      headers: {
        ...REQUEST_HEADERS,
        accept: "*/*",
        referer,
        ...(cookieHeader ? { cookie: cookieHeader, "x-csrftoken": extractCookieValue(cookieHeader, "csrftoken") ?? "" } : {}),
        "x-ig-app-id": "936619743392459",
        "x-asbd-id": "129477",
        "x-requested-with": "XMLHttpRequest",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    debug?.push(`debug: Instagram feed endpoint returned ${response.status}`);
    return [];
  }

  const data = (await response.json()) as {
    items?: Array<Record<string, unknown>>;
    profile_grid_items?: Array<Record<string, unknown>>;
  };

  const rawItems = (data.items ?? data.profile_grid_items ?? []).slice(0, limit);
  debug?.push(`debug: Instagram feed endpoint returned ${rawItems.length} item(s)`);

  return rawItems.map((item, index) => {
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

async function tryInstagramRapidApi(
  username: string,
  limit: number,
  debug: string[],
): Promise<PlatformResult | null> {
  const config = getRapidApiConfig("instagram");
  if (!config) {
    debug.push("debug: skip Instagram RapidAPI because env is incomplete");
    return null;
  }

  try {
    const [profileData, postsData] = await Promise.all([
      fetchRapidApiJson(config.profileUrl, config.host, { username, limit }),
      config.postsUrl
        ? fetchRapidApiJson(config.postsUrl, config.host, { username, limit }).catch(() => null)
        : Promise.resolve(null),
    ]);
    debug.push("debug: Instagram RapidAPI profile request succeeded");
    if (postsData) {
      debug.push("debug: Instagram RapidAPI posts request succeeded");
    } else if (config.postsUrl) {
      debug.push("debug: Instagram RapidAPI posts request returned null");
    }

    const accountName =
      getFirstString(profileData, [
        "data.user.full_name",
        "user.full_name",
        "data.full_name",
        "full_name",
        "data.user.username",
        "user.username",
        "data.username",
        "username",
      ]) ?? username;
    const profileImageUrl =
      getFirstString(profileData, [
        "data.user.profile_pic_url_hd",
        "data.user.profile_pic_url",
        "user.profile_pic_url_hd",
        "user.profile_pic_url",
        "data.profile_pic_url_hd",
        "data.profile_pic_url",
        "profile_pic_url_hd",
        "profile_pic_url",
      ]) ?? undefined;
    const followersCount = getFirstNumber(profileData, [
      "data.user.edge_followed_by.count",
      "user.edge_followed_by.count",
      "data.user.follower_count",
      "data.user.followers_count",
      "data.user.follower_count",
      "user.follower_count",
      "user.followers_count",
      "data.follower_count",
      "data.followers_count",
      "follower_count",
      "followers_count",
    ]);
    const items = extractInstagramRapidApiItems(postsData ?? profileData, limit);

    return {
      platform: "instagram",
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
          : ["RapidAPI profile data loaded, but recent Instagram post views were unavailable."],
      debug,
      items,
    };
  } catch (error) {
    debug.push(
      `debug: Instagram RapidAPI failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return null;
  }
}

async function tryInstagramWebProfileInfo(
  username: string,
  limit: number,
  debug: string[],
): Promise<PlatformResult | null> {
  const profileUrl = `https://www.instagram.com/${username}/`;
  const cookieHeader = readCookieHeader(["igcookies.txt", "instagram-cookies.txt"]);
  debug.push(
    cookieHeader
      ? "debug: Instagram cookie file loaded for web_profile_info"
      : "debug: Instagram cookie file not found for web_profile_info",
  );

  try {
    const response = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        headers: {
          ...REQUEST_HEADERS,
          accept: "*/*",
          referer: profileUrl,
          origin: "https://www.instagram.com",
          ...(cookieHeader ? { cookie: cookieHeader, "x-csrftoken": extractCookieValue(cookieHeader, "csrftoken") ?? "" } : {}),
          "x-asbd-id": "129477",
          "x-ig-app-id": "936619743392459",
          "x-requested-with": "XMLHttpRequest",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      debug.push(`debug: Instagram web_profile_info returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    const user =
      getByPath(data, "data.user") ??
      getByPath(data, "user") ??
      getByPath(data, "graphql.user");

    if (!user || typeof user !== "object") {
      debug.push("debug: Instagram web_profile_info response had no user object");
      return null;
    }

    const items = extractInstagramRapidApiItems(data, limit);
    debug.push(`debug: Instagram web_profile_info returned ${items.length} parsed item(s)`);
    const followersCount = getFirstNumber(user, [
      "edge_followed_by.count",
      "follower_count",
      "followers_count",
    ]);

    return {
      platform: "instagram",
      username,
      accountName:
        getFirstString(user, ["full_name", "username"]) ?? username,
      profileImageUrl:
        getFirstString(user, ["profile_pic_url_hd", "profile_pic_url"]) ?? undefined,
      totalViews: items.length > 0 ? sumViews(items) : null,
      totalViewsLabel:
        items.length > 0
          ? `${formatNumber(sumViews(items))} across fetched posts`
          : "Unavailable from Instagram web profile info",
      followersLabel:
        followersCount != null ? `${formatNumber(followersCount)} followers` : undefined,
      source: "Instagram web profile info endpoint",
      status: items.length > 0 ? "success" : "partial",
      warnings:
        items.length > 0
          ? []
          : ["Instagram profile info loaded, but recent post view data was unavailable in the web payload."],
      debug,
      items,
    };
  } catch (error) {
    debug.push(
      `debug: Instagram web_profile_info failed (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return null;
  }
}

function extractInstagramRapidApiItems(data: unknown, limit: number): DashboardItem[] {
  const postArrays = [
    getArrayByPath(data, "data.items"),
    getArrayByPath(data, "data.data.items"),
    getArrayByPath(data, "items"),
    getArrayByPath(data, "data.user.edge_owner_to_timeline_media.edges"),
    getArrayByPath(data, "graphql.user.edge_owner_to_timeline_media.edges"),
    getArrayByPath(data, "data.user.edge_owner_to_timeline_media.edges"),
    getArrayByPath(data, "user.edge_owner_to_timeline_media.edges"),
    getArrayByPath(data, "data.user.edge_felix_video_timeline.edges"),
    getArrayByPath(data, "user.edge_felix_video_timeline.edges"),
    getArrayByPath(data, "data.user.timeline_media.edges"),
    getArrayByPath(data, "profile_grid_items"),
  ].filter(Array.isArray) as unknown[][];

  const rawItems = postArrays.flat().slice(0, limit);

  return rawItems
    .map((rawItem, index) => {
      const item = getByPath(rawItem, "node") ?? rawItem;
      const viewCount = getFirstNumber(item, [
        "video_view_count",
        "play_count",
        "view_count",
        "media_preview_like_count",
      ]);
      const shortcodeSource = getFirstString(item, ["shortcode", "code"]);
      const mediaId = getFirstString(item, ["id", "pk"]) ?? `instagram-${index}`;
      const shortcode = shortcodeSource ?? mediaId;
      const isReel =
        getByPath(item, "media_type") === 2 ||
        getByPath(item, "product_type") === "clips";

      return {
        id: shortcode,
        title:
          getFirstString(item, [
            "edge_media_to_caption.edges.0.node.text",
            "caption.text",
            "caption",
            "accessibility_caption",
            "title",
          ]) ?? `Instagram post ${index + 1}`,
        url: `https://www.instagram.com/${isReel ? "reel" : "p"}/${shortcode}/`,
        thumbnailUrl:
          getFirstString(item, [
            "display_url",
            "thumbnail_src",
            "thumbnail_url",
            "image_versions2.candidates.0.url",
            "display_resources.0.src",
          ]) ?? undefined,
        views: viewCount,
        viewsLabel: viewCount != null ? formatNumber(viewCount) : "Unavailable",
        publishedLabel: undefined,
      } satisfies DashboardItem;
    })
    .filter((item) => Boolean(item.url));
}

function extractCookieValue(cookieHeader: string, name: string) {
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}
