import { DashboardItem, PlatformResult } from "./types";
import {
  REQUEST_HEADERS,
  buildErrorResult,
  decodeHtmlEntities,
  extractMetaTag,
  fetchRapidApiJson,
  formatNumber,
  getArrayByPath,
  getByPath,
  getFirstNumber,
  getFirstString,
  getNumber,
  getRapidApiConfig,
  getString,
  parseCount,
  readCookieHeader,
  sumViews,
} from "./utils";

const INSTAGRAM_PROFILE_HEADERS: HeadersInit = {
  ...REQUEST_HEADERS,
  "user-agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

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

  const profileUrl = `https://www.instagram.com/${username}/`;

  try {
    const html = await fetchInstagramHtml(profileUrl);
    const preloadedHtmlResult = await extractInstagramPreloadedPageData(
      html,
      username,
      limit,
      debug,
    );
    if (preloadedHtmlResult) {
      preloadedHtmlResult.debug = debug;
      return preloadedHtmlResult;
    }

    const webProfileInfoResult = await tryInstagramWebProfileInfo(username, limit, debug);
    if (webProfileInfoResult) {
      webProfileInfoResult.debug = debug;
      return webProfileInfoResult;
    }

    const userId = html.match(/"id":"(\d+)"/)?.[1];
    const items = userId ? await tryInstagramFeed(userId, profileUrl, limit, debug) : [];
    const totalViews = items.length > 0 ? sumViews(items) : null;

    return {
      platform: "instagram",
      username,
      accountName:
        decodeHtmlEntities(extractMetaTag(html, "og:title")?.split(" (@")[0] ?? username),
      profileImageUrl: extractMetaTag(html, "og:image") ?? undefined,
      totalViews,
      totalViewsLabel:
        totalViews != null
          ? `${formatNumber(totalViews)} across fetched posts`
          : "Unavailable from public Instagram metadata",
      followersLabel: buildFollowersLabel(extractInstagramFollowersFromHtml(html)),
      source: "Instagram public profile page",
      status: items.length >= Math.min(limit, 5) ? "success" : "partial",
      warnings: [
        "Instagram changed its public page shape, so the API is using minimal fallbacks for this request.",
      ],
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

async function extractInstagramPreloadedPageData(
  html: string,
  username: string,
  limit: number,
  debug: string[],
): Promise<PlatformResult | null> {
  const profileData = extractInstagramPreloadedDataScript(html, "xig_user_by_igid_v2", debug);
  const timelineData = extractInstagramPreloadedDataScript(
    html,
    "polaris_timeline_connection",
    debug,
  );

  const user =
    getByPath(profileData, "xig_user_by_igid_v2") ??
    getByPath(timelineData, "xig_user_by_igid_v2");

  if (!user || typeof user !== "object") {
    debug.push("debug: Instagram preloaded HTML had no usable user object");
    return null;
  }

  const followersCount =
    getFirstNumber(user, ["follower_count", "followers_count"]) ??
    extractInstagramFollowersFromHtml(html);
  const rawItems = extractInstagramRapidApiItems(timelineData ?? profileData, limit);

  if (rawItems.length === 0) {
    debug.push("debug: Instagram preloaded HTML had no timeline items");
    return null;
  }

  const { items: enrichedItems, usedLikeFallback } = await enrichInstagramItems(rawItems, debug);
  const hasViewMetrics = enrichedItems.some(
    (item) => item.contentType === "video" && item.views != null,
  );
  const shouldUseFollowersProxy = usedLikeFallback || !hasViewMetrics;

  debug.push(`debug: Instagram preloaded HTML yielded ${enrichedItems.length} item(s)`);

  return {
    platform: "instagram",
    username: getFirstString(user, ["username"]) ?? username,
    accountName:
      getFirstString(user, ["full_name", "username"]) ??
      decodeHtmlEntities(extractMetaTag(html, "og:title")?.split(" (@")[0] ?? username),
    profileImageUrl:
      getFirstString(user, ["profile_pic_url_hd", "profile_pic_url"]) ??
      extractMetaTag(html, "og:image") ??
      undefined,
    totalViews: shouldUseFollowersProxy ? followersCount ?? null : sumViews(enrichedItems),
    totalViewsLabel:
      shouldUseFollowersProxy
        ? followersCount != null
          ? `${formatNumber(followersCount)} followers used as a public proxy`
          : "Unavailable from public Instagram data"
        : `${formatNumber(sumViews(enrichedItems))} across fetched posts`,
    followersLabel: buildFollowersLabel(followersCount),
    source: "Instagram preloaded mobile profile HTML",
    status: enrichedItems.length >= Math.min(limit, 5) ? "success" : "partial",
    warnings:
      shouldUseFollowersProxy
        ? [
            "Instagram hides most public view counts for logged-out requests, so followers are used as the profile-level proxy and post metrics fall back to public like counts where needed.",
          ]
        : [],
    debug,
    items: enrichedItems,
  };
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
        ...(cookieHeader
          ? {
              cookie: cookieHeader,
              "x-csrftoken": extractCookieValue(cookieHeader, "csrftoken") ?? "",
            }
          : {}),
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
      followersLabel: buildFollowersLabel(followersCount),
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
          ...(cookieHeader
            ? {
                cookie: cookieHeader,
                "x-csrftoken": extractCookieValue(cookieHeader, "csrftoken") ?? "",
              }
            : {}),
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
      accountName: getFirstString(user, ["full_name", "username"]) ?? username,
      profileImageUrl:
        getFirstString(user, ["profile_pic_url_hd", "profile_pic_url"]) ?? undefined,
      totalViews: items.length > 0 ? sumViews(items) : null,
      totalViewsLabel:
        items.length > 0
          ? `${formatNumber(sumViews(items))} across fetched posts`
          : "Unavailable from Instagram web profile info",
      followersLabel: buildFollowersLabel(followersCount),
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
    getArrayByPath(data, "xig_user_by_igid_v2.polaris_timeline_connection.edges"),
    getArrayByPath(data, "data.items"),
    getArrayByPath(data, "data.data.items"),
    getArrayByPath(data, "items"),
    getArrayByPath(data, "data.xdt_api__v1__feed__user_timeline_graphql_connection.edges"),
    getArrayByPath(data, "xdt_api__v1__feed__user_timeline_graphql_connection.edges"),
    getArrayByPath(data, "data.user.edge_owner_to_timeline_media.edges"),
    getArrayByPath(data, "graphql.user.edge_owner_to_timeline_media.edges"),
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
      const metricCount = getFirstNumber(item, [
        "video_view_count",
        "play_count",
        "view_count",
        "like_count",
        "edge_liked_by.count",
        "edge_media_preview_like.count",
        "media_preview_like_count",
      ]);
      const mediaId = getFirstString(item, ["pk", "id"]) ?? `instagram-${index}`;
      const shortcode =
        getFirstString(item, ["shortcode", "code"]) ??
        (/^\d+$/.test(mediaId) ? instagramMediaIdToShortcode(mediaId) : mediaId);
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
            "display_uri",
          ]) ?? undefined,
        contentType: isReel ? "video" : undefined,
        views: metricCount,
        viewsLabel: metricCount != null ? formatNumber(metricCount) : "Unavailable",
        publishedLabel: undefined,
      } satisfies DashboardItem;
    })
    .filter((item) => Boolean(item.url));
}

async function enrichInstagramItems(items: DashboardItem[], debug: string[]) {
  const enrichedItems = await Promise.all(
    items.map(async (item) => {
      const metric = await extractInstagramMetricFromPostPage(item.url, debug);
      if (!metric) {
        return { item, usedLikeFallback: false };
      }

      return {
        item: {
          ...item,
          views: metric.count,
          viewsLabel: formatNumber(metric.count),
          contentType: metric.type === "views" ? "video" : item.contentType,
        } satisfies DashboardItem,
        usedLikeFallback: metric.type === "likes",
      };
    }),
  );

  return {
    items: enrichedItems.map((entry) => entry.item),
    usedLikeFallback: enrichedItems.some((entry) => entry.usedLikeFallback),
  };
}

async function extractInstagramMetricFromPostPage(url: string, debug: string[]) {
  try {
    const html = await fetchInstagramHtml(url);
    const description = decodeHtmlEntities(extractMetaTag(html, "og:description") ?? "");
    const metricMatch = description.match(/^([^,]+?)\s+(views?|likes?)/i);

    if (!metricMatch) {
      return null;
    }

    const count = parseCount(`${metricMatch[1]} ${metricMatch[2]}`);
    if (count == null) {
      return null;
    }

    return {
      count,
      type: metricMatch[2].toLowerCase().startsWith("view") ? "views" : "likes",
    } as const;
  } catch (error) {
    debug.push(
      `debug: Instagram post page metric fetch failed for ${url} (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return null;
  }
}

function extractInstagramPreloadedDataScript(
  html: string,
  marker: string,
  debug?: string[],
) {
  const scripts = getInstagramApplicationJsonScripts(html);

  for (const script of scripts) {
    if (!script.includes(marker)) {
      continue;
    }

    const markerIndex = script.indexOf(marker);
    const dataAnchor = '"result":{"data":';
    const dataIndex = script.lastIndexOf(dataAnchor, markerIndex);

    if (dataIndex === -1) {
      continue;
    }

    const parsed = extractObjectAt(script, dataIndex + dataAnchor.length);
    if (parsed) {
      debug?.push(`debug: Instagram preloaded data matched marker "${marker}"`);
      return parsed;
    }
  }

  return null;
}

function getInstagramApplicationJsonScripts(html: string) {
  return Array.from(
    html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1],
  );
}

function extractObjectAt(input: string, startIndex: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];

    if (char === "\"" && !escaped) {
      inString = !inString;
    }

    if (inString) {
      escaped = char === "\\" && !escaped;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(input.slice(startIndex, index + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }

    escaped = false;
  }

  return null;
}

async function fetchInstagramHtml(url: string) {
  const response = await fetch(url, {
    headers: INSTAGRAM_PROFILE_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request to ${url} failed with ${response.status}`);
  }

  return response.text();
}

function extractInstagramFollowersFromHtml(html: string) {
  const description = decodeHtmlEntities(extractMetaTag(html, "og:description") ?? "");
  const match = description.match(/^([^,]+)\s+Followers/i);
  return match ? parseCount(`${match[1]} followers`) : null;
}

function buildFollowersLabel(count: number | null) {
  return count != null ? `${formatNumber(count)} followers` : undefined;
}

function instagramMediaIdToShortcode(mediaId: string) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let value = BigInt(mediaId);
  let shortcode = "";

  while (value > 0n) {
    shortcode = alphabet[Number(value % 64n)] + shortcode;
    value /= 64n;
  }

  return shortcode || mediaId;
}

function extractCookieValue(cookieHeader: string, name: string) {
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? null;
}
