/** Conversions date/heure locales <-> ISO pour la planification des visites (module pur). */

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** "2026-10-12" + "14:30" (heure locale de l'appareil) -> ISO UTC, ou null si invalide. */
export function localInputToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (hh > 23 || mm > 59) return null;
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime()) || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt.toISOString();
}

/** ISO -> champs date/heure locaux (vides si absent). */
export function isoToLocalInputs(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return { date: "", time: "" };
  return {
    date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  };
}
