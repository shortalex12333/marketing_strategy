export type Checkpoint = "30m" | "60m" | "6h" | "24h";

export interface ScheduledPost {
  id: string;
  url: string;
  published_at: string;
  captures: Partial<Record<Checkpoint, CaptureSummary>>;
}

export interface CaptureSummary {
  captured_at: string;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves?: number | null;
  clicks?: number | null;
  error?: string | null;
}

export interface CaptureRow {
  captured_at_utc: string;
  post_id: string;
  post_url: string;
  minutes_since_publish: number;
  checkpoint: Checkpoint | string;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  saves: number | null;
  clicks: number | null;
  raw_text: string;
  error: string;
}

export interface BankEntry {
  id: string;
  hook: string;
  usp: string;
  targets: string;
  scenario: string;
  angle: string;
  why_it_lands: string;
  anchor: string;
}

export interface AugmentedPost extends ScheduledPost {
  _latest_capture: CaptureSummary | null;
  _captures_count: number;
  _eqs: number | null;
}
