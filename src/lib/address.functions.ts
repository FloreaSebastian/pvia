/**
 * searchAddressSuggestions: server-side French address autocomplete.
 *
 * Uses api-adresse.data.gouv.fr (public, no API key required) and returns
 * normalized suggestions for the /pv/new chantier step. Wrapped in a
 * server function so the upstream URL and User-Agent stay off the client
 * (and so we keep a single place to add quotas later).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  query: z.string().trim().min(3).max(200),
});

export type AddressSuggestion = {
  label: string;
  address: string;
  postalCode: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
};

export const searchAddressSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data }): Promise<{ suggestions: AddressSuggestion[] }> => {
    const url = new URL("https://api-adresse.data.gouv.fr/search/");
    url.searchParams.set("q", data.query);
    url.searchParams.set("limit", "6");
    url.searchParams.set("autocomplete", "1");

    try {
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "PVIA-Autocomplete/1.0" },
      });
      if (!res.ok) return { suggestions: [] };
      const json = (await res.json()) as {
        features?: Array<{
          geometry?: { coordinates?: [number, number] };
          properties?: {
            label?: string;
            name?: string;
            postcode?: string;
            city?: string;
          };
        }>;
      };
      const suggestions: AddressSuggestion[] = (json.features ?? []).map((f) => {
        const coords = f.geometry?.coordinates;
        return {
          label: f.properties?.label ?? "",
          address: f.properties?.name ?? "",
          postalCode: f.properties?.postcode ?? "",
          city: f.properties?.city ?? "",
          longitude: Array.isArray(coords) ? coords[0] ?? null : null,
          latitude: Array.isArray(coords) ? coords[1] ?? null : null,
        };
      }).filter((s) => s.label.length > 0);
      return { suggestions };
    } catch (e) {
      console.error("searchAddressSuggestions: upstream error", e);
      return { suggestions: [] };
    }
  });
