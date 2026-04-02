"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  debug?: string[];
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
  const didLoadInitialData = useRef(false);
  const latestFormRef = useRef(form);

  const activeCards = useMemo(
    () =>
      (["tiktok", "youtube", "instagram"] as PlatformKey[]).map(
        (platform) => data?.platforms?.[platform] ?? null,
      ),
    [data],
  );

  useEffect(() => {
    latestFormRef.current = form;
  }, [form]);

  const dashboardSummary = useMemo(() => {
    const platforms = activeCards.filter(Boolean) as PlatformResult[];

    return {
      activePlatforms: platforms.length,
      totalItems: platforms.reduce((sum, platform) => sum + platform.items.length, 0),
      healthyPlatforms: platforms.filter((platform) => platform.status === "success").length,
    };
  }, [activeCards]);

  const fetchDashboard = useCallback(async (nextForm: typeof DEFAULT_USERNAMES, nextLimit: number) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams(nextForm);
      params.set("limit", String(nextLimit));
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
  }, []);

  useEffect(() => {
    async function loadInitialDashboard() {
      await fetchDashboard(DEFAULT_USERNAMES, DEFAULT_LIMIT);
      didLoadInitialData.current = true;
    }

    void loadInitialDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (!didLoadInitialData.current) {
      return;
    }

    void fetchDashboard(latestFormRef.current, limit);
  }, [limit, fetchDashboard]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void fetchDashboard(form, limit);
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_55%,_#f8fafc_100%)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="space-y-4">
              <span className="inline-flex rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-sky-700">
                Social Media Dashboard
              </span>
              <div className="space-y-3">
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
                  Satu dashboard untuk melihat performa tiga akun sekaligus.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                  Masukkan username TikTok, YouTube, dan Instagram, lalu lihat profil,
                  total views, dan konten terbaru dalam tampilan yang ringkas dan mudah dibaca.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard label="Platform aktif" value={String(dashboardSummary.activePlatforms)} />
                <SummaryCard label="Konten tampil" value={String(dashboardSummary.totalItems)} />
                <SummaryCard label="Status siap" value={String(dashboardSummary.healthyPlatforms)} />
              </div>
            </div>

            <div className="grid gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Ringkasan
                </p>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  Dashboard ini cocok untuk demo technical test karena datanya bisa
                  di-refresh langsung tanpa reload halaman dan limitasi tiap platform tetap terlihat jelas.
                </p>
              </div>
              <div className="grid gap-2 text-sm text-slate-600">
                <p>1. YouTube punya coverage public paling lengkap.</p>
                <p>2. Instagram dan TikTok tetap ditampilkan dengan pendekatan best-effort.</p>
                <p>3. Jumlah konten bisa diubah dan otomatis refresh.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <form className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_180px_auto]" onSubmit={handleSubmit}>
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
                  className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
                className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
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
                className="h-12 rounded-2xl bg-sky-600 px-5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Refreshing..." : "Refresh data"}
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Refresh tanpa reload halaman
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Server-side aggregation
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5">
              Menampilkan hingga {data?.limit ?? limit} konten per platform
            </span>
            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">
              Auto refresh saat jumlah konten berubah
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
    <article className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
      <div className={`h-2 bg-gradient-to-r ${meta.accent}`} />
      <div className="grid gap-5 p-5 sm:p-6">
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
            <div className="flex items-center gap-4 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
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
                help={`Showing ${result.items.length} item${result.items.length === 1 ? "" : "s"}`}
              />
            </div>

            {result.error ? (
              <div className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                {result.error}
              </div>
            ) : null}

            {result.warnings.length > 0 ? (
              <div className="rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                {result.warnings.slice(0, 3).map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            {result.debug && result.debug.length > 0 ? (
              <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
                {result.debug.slice(0, 6).map((entry) => (
                  <p key={entry}>{entry}</p>
                ))}
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
                      className="grid grid-cols-[72px_1fr] gap-3 rounded-[1.25rem] border border-slate-200 bg-white p-3 transition hover:border-sky-200 hover:bg-sky-50/40 hover:shadow-sm"
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
                            <span className="rounded-full bg-sky-100 px-2 py-1 font-medium text-sky-700">
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
    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
      <p className="mt-2 text-xs text-slate-500">{help}</p>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
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
