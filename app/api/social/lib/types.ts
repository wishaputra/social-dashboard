export type PlatformKey = "tiktok" | "youtube" | "instagram";

export type DashboardItem = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  contentType?: "video" | "short" | "live";
  views: number | null;
  viewsLabel: string;
  publishedLabel?: string;
};

export type PlatformResult = {
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
