import { existsSync } from "node:fs";

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

    const desktopData = extractTikTokPageData(desktopHtml);
    const shareData =
      extractJsonFromScript(shareHtml, "__INIT_PROPS__") ?? {};

    const desktopUser =
      extractObject(desktopData, "webapp.user-detail.userInfo.user") ??
      extractObject(desktopData, "UserModule") ??
      {};
    const desktopStats =
      extractObject(desktopData, "webapp.user-detail.userInfo.statsV2") ??
      extractObject(desktopData, "webapp.user-detail.userInfo.stats") ??
      extractObject(desktopData, "UserModule.stats") ??
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
    let items = extractTikTokRapidApiItems(desktopData, username, limit);
    if (items.length > 0) {
      debug.push(`debug: TikTok HTML rehydration yielded ${items.length} parsed item(s)`);
    }

    if (items.length === 0) {
      const browserResult = await tryTikTokBrowserItemList(username, limit, debug);
      if (browserResult) {
        items = browserResult.items;
      }
    }

    if (items.length === 0 && secUid) {
      items = await tryTikTokPublicItemList(secUid, username, limit, debug);
    }

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

    if (items.length === 0) {
      debug.push("debug: using fallback mock TikTok data");

      return {
        platform: "tiktok",
        username,
        accountName: accountName || username,
        profileImageUrl:
          getString(desktopUser, "avatarMedium") ??
          getString(shareUser, "avatarMedium") ??
          undefined,

        totalViews: 0,
        totalViewsLabel: "Unavailable (TikTok restrictions)",

        followersLabel: followerLabel,

        source: "Fallback (TikTok public data restricted)",

        status: "partial",

        warnings: [
          "TikTok restricts public access to video data without authentication or signed requests.",
          "Displaying limited profile data as fallback.",
        ],

        debug,

        items: [
          {
            id: "fallback-1",
            title: "TikTok data unavailable",
            url: `https://www.tiktok.com/@${username}`,
            thumbnailUrl: undefined,
            contentType: "video",
            views: null,
            viewsLabel: "N/A",
            publishedLabel: undefined,
          },
        ],
      };
    }
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

function extractTikTokPageData(html: string) {
  const sigiState = extractJsonFromScript(html, "SIGI_STATE");
  if (sigiState) {
    return sigiState;
  }

  return extractJsonFromScript(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__") ?? {};
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
  const itemModule = getByPath(data, "ItemModule");

  if (!itemModule || typeof itemModule !== "object") {
    return [];
  }

  const rawItems = Object.values(itemModule).slice(0, limit);

  return rawItems.map((item: any, index) => {
    const videoId = item.id ?? `tiktok-${index}`;
    const viewCount = item.stats?.playCount ?? null;

    return {
      id: videoId,
      title: item.desc ?? `TikTok video ${index + 1}`,
      url: `https://www.tiktok.com/@${username}/video/${videoId}`,
      thumbnailUrl:
        item.video?.cover ||
        item.video?.originCover ||
        item.video?.dynamicCover,
      contentType: "video",
      views: viewCount,
      viewsLabel: viewCount ? viewCount.toString() : "0",
      publishedLabel: undefined,
    };
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

async function tryTikTokBrowserItemList(
  username: string,
  limit: number,
  debug: string[],
): Promise<{ items: DashboardItem[] } | null> {
  const executablePath = getTikTokBrowserExecutablePath();
  if (!executablePath) {
    debug.push("debug: TikTok browser fallback skipped because no Chromium/Edge executable was found");
    return null;
  }

  let puppeteer: typeof import("puppeteer-core") | null = null;
  try {
    puppeteer = await import("puppeteer-core");
  } catch (error) {
    debug.push(
      `debug: TikTok browser fallback skipped because puppeteer-core could not load (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return null;
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    );
    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9",
    });
    let capturedPayload: unknown = null;
    let resolveCapture: (() => void) | null = null;
    const capturePromise = new Promise<void>((resolve) => {
      resolveCapture = resolve;
    });

    page.on("response", async (response) => {
      if (capturedPayload || !response.url().includes("/api/post/item_list/")) {
        return;
      }

      try {
        const text = await response.text();
        if (!text.trim()) {
          return;
        }

        capturedPayload = JSON.parse(text) as unknown;
        resolveCapture?.();
      } catch {
        // Ignore parsing failures and keep listening for the next matching response.
      }
    });

    await page.goto(`https://www.tiktok.com/@${username}?lang=en`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await Promise.race([
      capturePromise,
      new Promise((resolve) => setTimeout(resolve, 20000)),
    ]);

    if (!capturedPayload) {
      debug.push("debug: TikTok browser fallback did not capture a usable item_list response");
      return null;
    }

    const items = extractTikTokRapidApiItems(capturedPayload, username, limit);
    debug.push(`debug: TikTok browser fallback captured ${items.length} parsed item(s)`);
    return { items };
  } finally {
    await browser.close();
  }
}

function getTikTokBrowserExecutablePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
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
