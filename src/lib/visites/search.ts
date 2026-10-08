/** Recherche texte des visites (référence, chantier, adresse, client) puis pagination. */
export interface SearchableVisit {
  reference?: string | null;
  chantier?: {
    name?: string | null;
    reference?: string | null;
    address?: string | null;
    city?: string | null;
    postal_code?: string | null;
  } | null;
  client?: { name?: string | null; company_name?: string | null } | null;
}

export function searchVisits<T extends SearchableVisit>(
  rows: T[],
  search: string,
  offset: number,
  limit: number,
) {
  const term = search.trim().toLowerCase();
  const matched = !term
    ? rows
    : rows.filter((r) =>
        [
          r.reference,
          r.chantier?.name,
          r.chantier?.reference,
          r.chantier?.address,
          r.chantier?.city,
          r.chantier?.postal_code,
          r.client?.name,
          r.client?.company_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term),
      );
  return {
    page: matched.slice(offset, offset + limit),
    total: matched.length,
    hasMore: matched.length > offset + limit,
  };
}
