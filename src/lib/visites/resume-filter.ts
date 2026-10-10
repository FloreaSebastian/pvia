import { z } from "zod";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { VISIT_DRAFT_STATUSES } from "../dashboard";

export const VISIT_RESUME_SEARCH = { group: "a_reprendre" } as const;
export const visitListSearchValidator = zodValidator(z.object({
  group: fallback(z.string(), "all").default("all"),
}));
export function visitGroupStatuses(group?: string | null): string[] | undefined {
  return group === VISIT_RESUME_SEARCH.group ? VISIT_DRAFT_STATUSES : undefined;
}

/** Merge already ordered, independently paginated status streams before global pagination. */
export async function groupedVisitPage<T extends { id: string; scheduled_at: string | null; created_at: string }>(
  statuses: string[], offset: number, limit: number,
  read: (status: string, offset: number, limit: number) => Promise<{ rows: T[]; total: number }>,
) {
  const streams = await Promise.all(statuses.map(async (status) => {
    const first = await read(status, 0, limit);
    return { status, rows: first.rows, total: first.total, fetched: first.rows.length };
  }));
  const page: T[] = [];
  const total = streams.reduce((sum, s) => sum + s.total, 0);
  for (let index = 0; index < Math.min(total, offset + limit); index++) {
    await Promise.all(streams.map(async (s) => {
      if (!s.rows.length && s.fetched < s.total) {
        const next = await read(s.status, s.fetched, limit);
        s.rows = next.rows;
        s.fetched += next.rows.length;
      }
    }));
    const next = streams.filter((s) => s.rows.length).sort((a, b) => {
      const x = a.rows[0], y = b.rows[0];
      if (x.scheduled_at !== y.scheduled_at) {
        if (!x.scheduled_at) return 1;
        if (!y.scheduled_at) return -1;
        return y.scheduled_at.localeCompare(x.scheduled_at);
      }
      return y.created_at.localeCompare(x.created_at) || x.id.localeCompare(y.id);
    })[0];
    if (!next) throw new Error("Lecture des visites impossible.");
    const row = next.rows.shift();
    if (row && index >= offset) page.push(row);
  }
  return { page, total };
}