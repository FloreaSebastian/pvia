/**
 * Solar Studio — recherche d'adresse et couvertures visuelles (Google Maps).
 *
 * Le fond cartographique sert au repérage. Aucune géométrie technique n'est
 * dérivée de ces réponses : seule la position choisie par l'utilisateur est
 * conservée, comme point de référence du projet.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSolarMember } from "./solar.server";

const GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

const SearchSchema = z.object({
  companyId: z.string().uuid(),
  query: z.string().trim().min(3).max(200),
});

const PointSchema = z.object({
  companyId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

function credentials(): { lovable: string; connection: string } | null {
  const lovable = process.env["LOVABLE_API_KEY"];
  const connection = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovable || !connection) return null;
  return { lovable, connection };
}

export interface MapPlaceCandidate {
  place_id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
}

export const searchMapPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SearchSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ candidates: MapPlaceCandidate[]; error: string | null }> => {
    await assertSolarMember(context.supabase, data.companyId, context.userId);
    const creds = credentials();
    if (!creds) return { candidates: [], error: "Recherche cartographique non configurée." };

    const res = await fetch(`${GATEWAY}/places/v1/places:searchText`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.lovable}`,
        "X-Connection-Api-Key": creds.connection,
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: data.query, languageCode: "fr", maxResultCount: 6 }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[solar-maps] searchText [${res.status}]: ${body}`);
      return { candidates: [], error: "Recherche d'adresse temporairement indisponible." };
    }
    const json = (await res.json()) as {
      places?: {
        id: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude: number; longitude: number };
      }[];
    };
    const candidates = (json.places ?? [])
      .filter((p) => p.location)
      .map((p) => ({
        place_id: p.id,
        label: p.displayName?.text ?? p.formattedAddress ?? "Adresse",
        address: p.formattedAddress ?? "",
        latitude: p.location!.latitude,
        longitude: p.location!.longitude,
      }));
    return { candidates, error: null };
  });

/** Disponibilité réelle de Street View : aucun bouton cassé n'est affiché. */
export const checkStreetViewCoverage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => PointSchema.parse(i))
  .handler(async ({ data, context }): Promise<{ available: boolean; detail: string }> => {
    await assertSolarMember(context.supabase, data.companyId, context.userId);
    const creds = credentials();
    if (!creds) return { available: false, detail: "Service cartographique non configuré." };

    const url = `${GATEWAY}/maps/api/streetview/metadata?location=${data.latitude},${data.longitude}&radius=60&source=outdoor`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.lovable}`, "X-Connection-Api-Key": creds.connection },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[solar-maps] streetview metadata [${res.status}]: ${body}`);
      return { available: false, detail: "Disponibilité Street View non vérifiable." };
    }
    const json = (await res.json()) as { status?: string };
    return json.status === "OK"
      ? { available: true, detail: "Vue de rue disponible à proximité." }
      : { available: false, detail: "Aucune vue de rue à cette adresse." };
  });
