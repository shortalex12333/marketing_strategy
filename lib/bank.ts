import fs from "node:fs";
import path from "node:path";
import type { BankEntry } from "./types";

/**
 * Parse the post bank markdown into structured entries.
 * Bank ships with the repo at data/post_bank.md.
 */

let _cache: BankEntry[] | null = null;
let _cacheMtime = 0;

export function parseBank(text: string): BankEntry[] {
  const entries: BankEntry[] = [];
  let current: BankEntry | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const m = /^P-(\d+)\s*·\s*(.+)$/.exec(line.trim());
    if (m) {
      if (current?.id) entries.push(current);
      current = {
        id: `P-${m[1]}`,
        hook: m[2].replace(/^[*"]+|[*"]+$/g, "").trim(),
        usp: "",
        targets: "",
        scenario: "",
        angle: "",
        why_it_lands: "",
        anchor: "",
      };
      continue;
    }
    if (!current) continue;
    const f = /^\s*(USP|Targets|Scenario|Angle|Why it lands|Anchor):\s*(.+)$/.exec(line);
    if (f) {
      const key = f[1].toLowerCase().replace(/\s+/g, "_") as keyof BankEntry;
      (current as unknown as Record<string, string>)[key] = f[2].trim();
    }
  }
  if (current?.id) entries.push(current);
  return entries;
}

export function loadBank(): BankEntry[] {
  const filePath = path.join(process.cwd(), "data", "post_bank.md");
  try {
    const stat = fs.statSync(filePath);
    if (_cache && stat.mtimeMs === _cacheMtime) return _cache;
    const text = fs.readFileSync(filePath, "utf8");
    _cache = parseBank(text);
    _cacheMtime = stat.mtimeMs;
    return _cache;
  } catch {
    return [];
  }
}
