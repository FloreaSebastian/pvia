/**
 * Contrôle d'accès partagé des tâches planifiées (`x-cron-secret`).
 *
 * Deux noms sont acceptés :
 *  - `CRON_SECRET` : historique ;
 *  - `CRON_SECRET_V2` : secret partagé effectivement présent dans le coffre de
 *    la base, utilisé par pg_cron pour signer les appels.
 *
 * Comparaison à temps constant pour ne rien révéler par la durée de réponse.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isValidCronSecret(provided: string | null | undefined): boolean {
  if (!provided) return false;
  const expected = [process.env["CRON_SECRET_V2"], process.env["CRON_SECRET"]].filter(
    (v): v is string => Boolean(v),
  );
  return expected.some((e) => safeEqual(provided, e));
}
