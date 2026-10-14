/**
 * Wire format of the fictional "ExampleTasks API". These types describe the FOREIGN system only; they must never leave
 * the adapter (the mapping layer turns them into SDK models).
 */
export type RawState = "open" | "in_progress" | "blocked" | "closed";
export type RawClosedReason = "completed" | "cancelled" | "failed";

export interface RawItem {
  item_id: string;
  title: string;
  body?: string | null;
  state: RawState;
  /** 1 (highest) .. 5 (lowest). */
  prio: number;
  owner_bot: string | null;
  /** Completion in percent, null when unknown. */
  pct: number | null;
  /** Revision counter used for If-Match. */
  rev: number;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  due?: string | null;
  tags?: string[];
  closed_reason?: RawClosedReason | null;
}

export interface RawItemPage {
  items: RawItem[];
  next_page_token: string | null;
}

export type RawEventKind = "item.created" | "item.updated" | "item.progress" | "item.closed";

export interface RawEvent {
  seq: number;
  kind: RawEventKind;
  item: RawItem;
  message?: string;
}

export interface RawEventBatch {
  events: RawEvent[];
  last_seq: number;
}

export interface RawItemWrite {
  title?: string;
  body?: string;
  state?: RawState;
  closed_reason?: RawClosedReason;
  prio?: number;
  owner_bot?: string | null;
  due?: string | null;
  tags?: string[];
}
