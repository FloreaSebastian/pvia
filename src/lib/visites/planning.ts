/**
 * Conversions date/heure <-> ISO pour la planification des visites (module pur).
 * Toujours en heure de Paris, comme l'affichage des fiches et du calendrier,
 * quel que soit le fuseau de l'appareil.
 */

export const PLANNING_TZ = "Europe/Paris";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function partsIn(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Décalage (ms) du fuseau à l'instant donné. */
function offsetAt(tz: string, utcMs: number) {
  const p = partsIn(tz, new Date(utcMs));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

/** "2026-10-12" + "14:30" (heure de Paris) -> ISO UTC, ou null si invalide. */
export function localInputToIso(date: string, time: string, tz = PLANNING_TZ): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (hh > 23 || mm > 59) return null;
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const check = new Date(naive);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  let ts = naive - offsetAt(tz, naive);
  ts = naive - offsetAt(tz, ts); // second passage : changements d'heure
  return new Date(ts).toISOString();
}

/** ISO -> champs date/heure en heure de Paris (vides si absent). */
export function isoToLocalInputs(iso: string | null | undefined, tz = PLANNING_TZ): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { date: "", time: "" };
  const p = partsIn(tz, dt);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}
