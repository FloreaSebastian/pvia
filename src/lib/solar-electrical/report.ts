/**
 * Solar Studio P2-A — sections PDF de la conception électrique (pur).
 * Client : référence onduleur + puissances. Technique : détail strings/MPPT.
 * Caractères limités au jeu WinAnsi (pas de « ≤ »).
 */
import type { PdfSection } from "../solar/pdf-doc";
import type { StoredElectricalDesign } from "./types";

export const TOPOLOGY_LABEL: Record<string, string> = {
  string: "Onduleur string",
  hybride: "Onduleur hybride (partie PV)",
  micro: "Micro-onduleurs",
};
export const DESIGN_STATUS_LABEL: Record<string, string> = {
  valide: "Conforme aux données disponibles",
  avertissement: "Conforme avec avertissements",
  non_verifiable: "Partiellement vérifiable (données manquantes)",
  invalide: "Non conforme",
};

const kw = (w: number | null) => (w == null ? "Non vérifiable" : `${(w / 1000).toFixed(2)} kW`);

export function electricalPdfSections(
  design: StoredElectricalDesign | null,
  variant: "client" | "technique",
  stale: boolean,
): PdfSection[] {
  if (!design) return [];
  if (stale) {
    return [
      {
        heading: "Conception électrique",
        text: "L'implantation a changé depuis le calcul électrique : le câblage enregistré est obsolète et n'est pas repris dans ce document.",
      },
    ];
  }
  const inv = design.inverter_snapshot;
  const s = design.summary;
  const name = [inv.manufacturer, inv.series, inv.model].filter(Boolean).join(" ");
  const rows = [
    { label: "Onduleur", value: `${design.inverter_count} x ${name}` },
    {
      label: "Type",
      value: `${TOPOLOGY_LABEL[design.topology] ?? design.topology}${inv.phase ? ` - ${inv.phase === "tri" ? "triphasé" : "monophasé"}` : ""}`,
    },
    { label: "Puissance AC", value: kw(s.ac_power_w) },
    { label: "Puissance DC", value: kw(s.dc_power_w) },
  ];
  if (variant === "client") return [{ heading: "Onduleur", rows }];

  const out: PdfSection[] = [
    {
      heading: "Conception électrique",
      rows: [
        ...rows,
        {
          label: "Ratio DC/AC",
          value: s.dc_ac_ratio == null ? "Non vérifiable" : String(s.dc_ac_ratio),
        },
        { label: "Statut", value: DESIGN_STATUS_LABEL[design.status] ?? design.status },
        {
          label: "Températures",
          value: `Tmin ${design.temp_min_c} °C / Tmax ${design.temp_max_c} °C - ${design.temp_source}`,
        },
        {
          label: "Fiche onduleur",
          value: `${inv.provenance} (révision ${inv.revision_id.slice(0, 8)})`,
        },
        {
          label: "Versions",
          value: `moteur ${design.engine_version} - implantation v${design.layout_version} - toiture v${design.geometry_version}`,
        },
        { label: "Panneaux non raccordés", value: String(s.unassigned) },
      ],
    },
  ];
  out.push({
    heading: design.topology === "micro" ? "Micro-onduleurs" : "Strings",
    table: {
      columns:
        design.topology === "micro"
          ? ["Micro", "Panneaux"]
          : ["String", "Onduleur", "MPPT", "Panneaux"],
      rows: design.groups.map((g) =>
        design.topology === "micro"
          ? [g.label.replace("µ", "Micro "), String(g.module_ids.length)]
          : [
              g.label,
              String(g.inverter_index + 1),
              g.mppt_index == null ? "-" : String(g.mppt_index + 1),
              String(g.module_ids.length),
            ],
      ),
    },
  });
  if (s.mppts.length) {
    out.push({
      heading: "MPPT",
      table: {
        columns: ["Onduleur/MPPT", "Strings", "Vmp STC (V)", "Imp (A)", "Isc (A)"],
        rows: s.mppts.map((m) => [
          `${m.inverter_index + 1}/${m.mppt_index + 1}`,
          String(m.strings),
          m.voltage_v == null ? "-" : String(m.voltage_v),
          m.imp_sum_a == null ? "-" : String(m.imp_sum_a),
          m.isc_sum_a == null ? "-" : String(m.isc_sum_a),
        ]),
      },
    });
  }
  if (design.warnings.length) {
    out.push({
      heading: "Contrôles électriques à surveiller",
      text: design.warnings
        .map((w) => `- ${w.scope} : ${w.message.replace(/≤/g, "<=").replace(/≥/g, ">=")}`)
        .join("\n"),
    });
  }
  return out;
}
