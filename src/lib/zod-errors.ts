import { z } from "zod";

/**
 * Parse un schéma Zod et renvoie un message lisible par l'utilisateur au lieu
 * du tableau d'issues brut (qui expose les chemins de champs internes et les
 * codes de validation dans les toasts).
 */
export function parseInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const res = schema.safeParse(input);
  if (res.success) return res.data;
  const first = res.error.issues[0];
  const field = first?.path?.filter((p) => typeof p === "string" && p !== "data").slice(-1)[0];
  const msg =
    first?.message && !/^Invalid|^Required|^Expected/i.test(first.message)
      ? first.message
      : field
        ? `Champ invalide : ${String(field)}.`
        : "Données invalides.";
  throw new Error(msg);
}
