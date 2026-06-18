import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { enforceRateLimit, getClientIp, RateLimitError } from "@/lib/rate-limit.server";

export const Route = createFileRoute("/api/public/calendar/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const raw = params.token ?? "";
        const token = raw.endsWith(".ics") ? raw.slice(0, -4) : raw;
        if (!/^cal_[A-Za-z0-9_-]{10,}$/.test(token)) {
          return new Response("Not found", { status: 404 });
        }

        // F-07 — Rate limit per IP (calendar clients poll every few minutes).
        const ip = getClientIp(request);
        try {
          await enforceRateLimit({
            bucket: "calendar_ics",
            key: ip,
            limit: 60,
            windowSec: 600,
          });
        } catch (e) {
          if (e instanceof RateLimitError) {
            return new Response("Too many requests", {
              status: 429,
              headers: { "retry-after": String(e.retryAfterSec) },
            });
          }
          throw e;
        }

        const { data: t } = await supabaseAdmin
          .from("integration_calendar_tokens")
          .select("id,company_id,scope,revoked_at,expires_at")
          .eq("token", token).maybeSingle();
        if (!t || t.revoked_at) return new Response("Not found", { status: 404 });

        // F-07 — Reject expired tokens.
        const expiresAt = (t as { expires_at?: string | null }).expires_at;
        if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
          return new Response("Not found", { status: 404 });
        }

        await supabaseAdmin
          .from("integration_calendar_tokens")
          .update({ last_accessed_at: new Date().toISOString() })
          .eq("id", t.id);

        const { data: company } = await supabaseAdmin
          .from("companies").select("name").eq("id", t.company_id).maybeSingle();

        // F-07 — drop client_id / chantier_id from the feed (no relational PII leakage).
        let q = supabaseAdmin
          .from("pv")
          .select("id,numero,type,status,reception_date,signed_at,description,created_at")
          .eq("company_id", t.company_id)
          .order("created_at", { ascending: false })
          .limit(500);

        if (t.scope === "signed_only") q = q.eq("status", "signe");
        if (t.scope === "field_visits") q = q.not("reception_date", "is", null);

        const { data: rows } = await q;

        const ics = renderIcs(rows ?? [], (company?.name as string) ?? "PVIA");
        return new Response(ics, {
          status: 200,
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "cache-control": "private, max-age=300",
            "content-disposition": `inline; filename="pvia-${token.slice(0, 12)}.ics"`,
          },
        });
      },
    },
  },
});

function pad(n: number) { return n < 10 ? "0" + n : "" + n; }
function fmtDate(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function fmtDateOnly(s: string) {
  // YYYY-MM-DD → YYYYMMDD
  return s.replace(/-/g, "");
}
function escapeIcs(s: string) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
function fold(line: string) {
  if (line.length <= 73) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
    i += 73;
  }
  return out.join("\r\n");
}

type Row = {
  id: string; numero: string | null; type: string | null; status: string | null;
  reception_date: string | null; signed_at: string | null; description: string | null;
  created_at: string;
};

function renderIcs(rows: Row[], calName: string): string {
  const now = fmtDate(new Date());
  const out: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PVIA//Calendar//FR",
    `X-WR-CALNAME:${escapeIcs(calName + " — PVIA")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const r of rows) {
    const uid = `${r.id}@pvia`;
    const summary = `${r.type ?? "PV"} ${r.numero ?? ""}`.trim() + (r.status ? ` (${r.status})` : "");
    const desc = r.description ?? "";
    let dtStart = "";
    let dtEnd = "";
    if (r.signed_at) {
      const d = new Date(r.signed_at);
      dtStart = `DTSTART:${fmtDate(d)}`;
      dtEnd = `DTEND:${fmtDate(new Date(d.getTime() + 30 * 60 * 1000))}`;
    } else if (r.reception_date) {
      const day = fmtDateOnly(r.reception_date);
      dtStart = `DTSTART;VALUE=DATE:${day}`;
    } else {
      const d = new Date(r.created_at);
      dtStart = `DTSTART:${fmtDate(d)}`;
    }
    out.push("BEGIN:VEVENT");
    out.push(fold(`UID:${uid}`));
    out.push(`DTSTAMP:${now}`);
    out.push(fold(dtStart));
    if (dtEnd) out.push(fold(dtEnd));
    out.push(fold(`SUMMARY:${escapeIcs(summary)}`));
    if (desc) out.push(fold(`DESCRIPTION:${escapeIcs(desc.slice(0, 500))}`));
    out.push("END:VEVENT");
  }
  out.push("END:VCALENDAR");
  return out.join("\r\n") + "\r\n";
}
