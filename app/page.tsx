"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";

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

type ApiResponse = {
  requestedAt: string;
  limit: number;
  platforms: Partial<Record<PlatformKey, PlatformResult | null>>;
};

const DEFAULT_USERNAMES = {
  tiktok: "tiktok",
  youtube: "YouTube",
  instagram: "instagram",
};
const DEFAULT_LIMIT = 5;
const LIMIT_OPTIONS = [5, 10, 15, 20];

const PLATFORM_META: Record<
  PlatformKey,
  { label: string; accent: string; helper: string }
> = {
  tiktok: {
    label: "TikTok",
    accent: "from-cyan-400 to-sky-500",
    helper: "Public profile scraping with account-level metadata.",
  },
  youtube: {
    label: "YouTube",
    accent: "from-rose-500 to-orange-400",
    helper: "Public channel pages for videos, shorts, live, plus the About tab.",
  },
  instagram: {
    label: "Instagram",
    accent: "from-fuchsia-500 to-amber-400",
    helper: "Public profile metadata with best-effort post fetching.",
  },
};

export default function Home() {
  const [form, setForm] = useState(DEFAULT_USERNAMES);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCards = useMemo(
    () =>
      (["tiktok", "youtube", "instagram"] as PlatformKey[]).map(
        (platform) => data?.platforms?.[platform] ?? null,
      ),
    [data],
  );

  async function fetchDashboard(nextForm = form) {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams(nextForm);
      params.set("limit", String(limit));
      const response = await fetch(`/api/social?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Request failed.");
      }

      const payload = (await response.json()) as ApiResponse;
      setData(payload);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Unexpected error while refreshing dashboard data.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function loadInitialDashboard() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams(DEFAULT_USERNAMES);
        params.set("limit", String(DEFAULT_LIMIT));
        const response = await fetch(`/api/social?${params.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Request failed.");
        }

        const payload = (await response.json()) as ApiResponse;
        setData(payload);
      } catch (fetchError) {
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Unexpected error while refreshing dashboard data.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadInitialDashboard();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void fetchDashboard(form);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(244,63,94,0.16),_transparent_24%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-10">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="space-y-4">
              <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
                Technical Test Dashboard
              </span>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                  Social media views dashboard for three platforms in one screen.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                  Built with Next.js and TypeScript. The app fetches public data
                  server-side, then refreshes in place without reloading the page.
                  It also surfaces platform limitations directly in the UI so the
                  tradeoffs are easy to explain during the technical test.
                </p>
              </div>
            </div>

            <div className="grid gap-4 rounded-[1.5rem] bg-slate-950 p-5 text-slate-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">
                  What this demo covers
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Input usernames, fetch profile metadata, display overall views,
                  list latest content, and refresh live data on demand.
                </p>
              </div>
              <div className="grid gap-2 text-sm text-slate-300">
                <p>1. YouTube: strongest public coverage.</p>
                <p>2. Instagram: profile metadata plus best-effort post data.</p>
                <p>3. TikTok: account metadata with transparent limitations.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <form className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={handleSubmit}>
            {(Object.keys(form) as PlatformKey[]).map((platform) => (
              <label key={platform} className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">
                  {PLATFORM_META[platform].label} username or handle
                </span>
                <input
                  value={form[platform]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [platform]: event.target.value,
                    }))
                  }
                  className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
                  placeholder={`Enter ${PLATFORM_META[platform].label} username`}
                />
              </label>
            ))}

            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">
                Latest content count
              </span>
              <select
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value))}
                className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-200/60"
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option} items
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end gap-3">
              <button
                type="submit"
                disabled={loading}
                className="h-12 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Refreshing..." : "Refresh data"}
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">
              No full-page reload
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1">
              Server-side aggregation
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1">
              Showing up to {data?.limit ?? limit} items per platform
            </span>
          </div>

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-3">
          {(["tiktok", "youtube", "instagram"] as PlatformKey[]).map((platform, index) => (
            <PlatformCard
              key={platform}
              platform={platform}
              result={activeCards[index]}
              loading={loading && !data}
            />
          ))}
        </section>
      </div>
    </main>
  );
}

function PlatformCard({
  platform,
  result,
  loading,
}: {
  platform: PlatformKey;
  result: PlatformResult | null;
  loading: boolean;
}) {
  const meta = PLATFORM_META[platform];

  return (
    <article className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_22px_70px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className={`h-2 bg-gradient-to-r ${meta.accent}`} />
      <div className="grid gap-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {meta.label}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">{meta.helper}</p>
          </div>
          <StatusPill status={result?.status ?? (loading ? "partial" : "error")} />
        </div>

        {result ? (
          <>
            <div className="flex items-center gap-4 rounded-[1.5rem] bg-slate-50 p-4">
              {result.profileImageUrl ? (
                <Image
                  src={result.profileImageUrl}
                  alt={result.accountName}
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-2xl object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-200 text-sm font-semibold text-slate-600">
                  {meta.label.slice(0, 1)}
                </div>
              )}

              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-slate-950">
                  {result.accountName}
                </p>
                <p className="text-sm text-slate-500">@{result.username}</p>
                {result.followersLabel ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {result.followersLabel}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <MetricCard
                label="Total views"
                value={result.totalViewsLabel}
                help={result.totalViews == null ? "Public data limitation" : "Parsed live"}
              />
              <MetricCard
                label="Latest content"
                value={String(result.items.length)}
                help={`Up to ${result.items.length > 0 ? result.items.length : 0} returned`}
              />
            </div>

            {result.error ? (
              <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                {result.error}
              </div>
            ) : null}

            {result.warnings.length > 0 ? (
              <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                {result.warnings[0]}
              </div>
            ) : null}

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800">
                  Latest content
                </h2>
                <span className="text-xs text-slate-500">{result.source}</span>
              </div>

              {result.items.length > 0 ? (
                <div className="grid gap-3">
                  {result.items.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="grid grid-cols-[72px_1fr] gap-3 rounded-[1.25rem] border border-slate-200 bg-white p-3 transition hover:border-slate-300 hover:shadow-sm"
                    >
                      {item.thumbnailUrl ? (
                        <Image
                          src={item.thumbnailUrl}
                          alt={item.title}
                          width={72}
                          height={72}
                          className="h-[72px] w-[72px] rounded-xl object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="h-[72px] w-[72px] rounded-xl bg-slate-100" />
                      )}

                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium leading-6 text-slate-900">
                          {item.title}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                          {item.contentType ? (
                            <span className="rounded-full bg-slate-900 px-2 py-1 font-medium text-white">
                              {item.contentType === "short"
                                ? "Short"
                                : item.contentType === "live"
                                  ? "Live"
                                  : "Video"}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-slate-100 px-2 py-1">
                            {item.viewsLabel}
                          </span>
                          {item.publishedLabel ? (
                            <span className="rounded-full bg-slate-100 px-2 py-1">
                              {item.publishedLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm leading-6 text-slate-500">
                  No recent content view data could be parsed from the current public
                  endpoint for this platform.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-[1.5rem] bg-slate-50 p-5 text-sm text-slate-500">
            {loading
              ? "Loading public profile data..."
              : "Enter a username and refresh to load this platform."}
          </div>
        )}
      </div>
    </article>
  );
}

function MetricCard({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{help}</p>
    </div>
  );
}

function StatusPill({ status }: { status: PlatformResult["status"] }) {
  if (status === "success") {
    return (
      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
        Ready
      </span>
    );
  }

  if (status === "partial") {
    return (
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
        Partial
      </span>
    );
  }

  return (
    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
      Error
    </span>
  );
}
