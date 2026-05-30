import type { BankEntry } from "./types";
import { listBank } from "./supabase";

/**
 * Post bank loader — reads from Supabase li_post_bank (populated 2026-05-30
 * from post_bank_2026_05_14.md, 68 entries marked status='pending-research').
 *
 * Returns a Promise now (changed from sync 2026-05-30 — Supabase REST is async).
 * Callers updated accordingly.
 */
export async function loadBank(): Promise<BankEntry[]> {
  try {
    return await listBank();
  } catch {
    return [];
  }
}
