import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DashboardItem, PlatformKey, PlatformResult } from "./types";

type RapidApiConfig = {
  key: string;
  host: string;
  profileUrl: string;
  postsUrl: string | null;
};

export const REQUEST_HEADERS: HeadersInit = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  pragma: "no-cache",
  "cache-control": "no-cache",
};

export async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Request to ${url} failed with ${response.status}`);
  }

  return response.text();
}

export function normalizeUsername(value: string | null, keepAt = false) {
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

export function clampLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "5", 10);

  if (Number.isNaN(parsed)) {
    return 5;
  }

  return Math.min(Math.max(parsed, 5), 20);
}

export function extractJsonFromScript(html: string, scriptId: string) {
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

export function extractJsonAfter(html: string, marker: string) {
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

export function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function extractObjects(root: unknown, key: string) {
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

export function extractObject(root: unknown, path: string) {
  const direct = getByPath(root, path);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const key = path.split(".").pop() ?? path;
  return extractObjects(root, key)[0] ?? null;
}

export function getByPath(input: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, input);
}

export function getArrayByPath(input: unknown, path: string) {
  const value = getByPath(input, path);
  return Array.isArray(value) ? value : null;
}

export function getFirstString(input: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getByPath(input, path);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

export function getFirstNumber(input: unknown, paths: string[]) {
  for (const path of paths) {
    const value = getByPath(input, path);
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

export function visit(input: unknown, callback: (value: Record<string, unknown>) => void) {
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

export function getText(input: unknown): string | null {
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

export function getThumbnailUrl(input: unknown) {
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

export function getString(input: unknown, path: string) {
  const value = getByPath(input, path);
  return typeof value === "string" ? value : null;
}

export function getNumber(input: unknown, path: string) {
  const value = getByPath(input, path);
  return typeof value === "number" ? value : null;
}

export function parseCount(value: string) {
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

export function sumViews(items: DashboardItem[]) {
  return items.reduce((sum, item) => sum + (item.views ?? 0), 0);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function extractMetaTag(html: string, property: string) {
  const pattern = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return html.match(pattern)?.[1] ?? null;
}

export function extractNamedMetaTag(html: string, name: string) {
  const pattern = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  return html.match(pattern)?.[1] ?? null;
}

export function decodeHtmlEntities(value: string) {
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

export function buildErrorResult(
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

export function getRapidApiConfig(platform: "instagram" | "tiktok"): RapidApiConfig | null {
  const key =
    process.env.RAPIDAPI_KEY ??
    process.env.RAPID_API_KEY ??
    null;

  if (!key) {
    return null;
  }

  if (platform === "instagram") {
    const host = process.env.RAPIDAPI_INSTAGRAM_HOST ?? null;
    const profileUrl = process.env.RAPIDAPI_INSTAGRAM_PROFILE_URL ?? null;
    const postsUrl = process.env.RAPIDAPI_INSTAGRAM_POSTS_URL ?? null;

    if (!host || !profileUrl) {
      return null;
    }

    return { key, host, profileUrl, postsUrl };
  }

  const host = process.env.RAPIDAPI_TIKTOK_HOST ?? null;
  const profileUrl = process.env.RAPIDAPI_TIKTOK_PROFILE_URL ?? null;
  const postsUrl = process.env.RAPIDAPI_TIKTOK_POSTS_URL ?? null;

  if (!host || !profileUrl) {
    return null;
  }

  return { key, host, profileUrl, postsUrl };
}

export async function fetchRapidApiJson(
  templateUrl: string,
  host: string,
  params: Record<string, string | number>,
) {
  const key =
    process.env.RAPIDAPI_KEY ??
    process.env.RAPID_API_KEY;

  if (!key) {
    throw new Error("Missing RapidAPI key");
  }

  const url = buildTemplatedUrl(templateUrl, params);
  const response = await fetch(url, {
    headers: {
      "x-rapidapi-key": key,
      "x-rapidapi-host": host,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`RapidAPI request failed with ${response.status}`);
  }

  return response.json();
}

export function buildTemplatedUrl(template: string, params: Record<string, string | number>) {
  let url = template;

  for (const [key, value] of Object.entries(params)) {
    url = url.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }

  return url;
}

export function readCookieHeader(fileNames: string[]) {
  for (const fileName of fileNames) {
    const filePath = path.join(process.cwd(), fileName);
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    const cookieHeader = parseNetscapeCookieFile(content);
    if (cookieHeader) {
      return cookieHeader;
    }
  }

  return undefined;
}

function parseNetscapeCookieFile(content: string) {
  const cookies = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 7)
    .map((parts) => `${parts[5]}=${parts[6]}`);

  return cookies.length > 0 ? cookies.join("; ") : undefined;
}
