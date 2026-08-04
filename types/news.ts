export type NewsItem = {
  id: string;
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt: string;
  category: string;
};

export type NewsFeedResponse = {
  ok: boolean;
  items: NewsItem[];
  fetchedAt: string;
  message?: string;
};
