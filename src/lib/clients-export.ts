/**
 * Client export helpers (CSV).
 *
 * Generates an RFC-4180-compliant CSV string for a set of clients and
 * triggers a browser download. Kept dependency-free so the bundle stays
 * small; Excel can open the produced CSV natively.
 */

export type ExportClient = {
  id: string;
  name: string;
  contact_name?: string | null;
  company_name?: string | null;
  client_type?: "particulier" | "entreprise" | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  address_line1?: string | null;
  postal_code?: string | null;
  city?: string | null;
  siret?: string | null;
  siren?: string | null;
  vat_number?: string | null;
  naf_code?: string | null;
  notes?: string | null;
  created_at?: string | null;
  archived_at?: string | null;
};

const COLUMNS: { key: keyof ExportClient | "statut"; label: string }[] = [
  { key: "name", label: "Nom" },
  { key: "contact_name", label: "Prénom / Contact" },
  { key: "company_name", label: "Société" },
  { key: "client_type", label: "Type" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "address", label: "Adresse" },
  { key: "postal_code", label: "Code postal" },
  { key: "city", label: "Ville" },
  { key: "siret", label: "SIRET" },
  { key: "siren", label: "SIREN" },
  { key: "vat_number", label: "TVA" },
  { key: "naf_code", label: "NAF" },
  { key: "notes", label: "Notes" },
  { key: "created_at", label: "Date de création" },
  { key: "statut", label: "Statut" },
];

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildClientsCsv(clients: ExportClient[]): string {
  const header = COLUMNS.map((c) => escapeCsv(c.label)).join(",");
  const rows = clients.map((c) =>
    COLUMNS.map((col) => {
      if (col.key === "statut") return escapeCsv(c.archived_at ? "archivé" : "actif");
      return escapeCsv(c[col.key as keyof ExportClient]);
    }).join(","),
  );
  // UTF-8 BOM so Excel detects encoding correctly with accents.
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

export function downloadClientsCsv(clients: ExportClient[], filename = "clients.csv"): void {
  const csv = buildClientsCsv(clients);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
