import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { STATS_DEFINITIONS, STATS_TYPE_LABELS, rangeLabel, type CompanyStats } from "./stats-core";

export function statsExportRows(
  stats: CompanyStats,
  companyName: string,
): (string | number | null)[][] {
  const k = stats.kpis;
  const rows: (string | number | null)[][] = [
    ["PVIA - Statistiques", companyName],
    ["Période (Europe/Paris)", rangeLabel(stats.range)],
    ["Début inclus UTC", stats.range.start ?? "Tout historique"],
    ["Fin exclusive UTC", stats.range.end],
    ["Type de PV", stats.input.pvType ? STATS_TYPE_LABELS[stats.input.pvType] : "Tous"],
    ["Membre", stats.members.find((m) => m.user_id === stats.input.userId)?.name ?? "Tous"],
    [
      "Calculé le",
      new Date(stats.generatedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
    ],
    ...STATS_DEFINITIONS.map((definition) => ["Définition", definition]),
    [],
    ["Indicateur", "Période sélectionnée", ...(stats.previous ? ["Période précédente"] : [])],
  ];
  const metrics: {
    label: string;
    key:
      | "totalPv"
      | "signedPv"
      | "signatureRate"
      | "avgDelayHours"
      | "reservesTotal"
      | "reservesOpen"
      | "photosTotal"
      | "emailsSent"
      | "emailsFailed"
      | "pdfGenerated"
      | "sentToClient";
  }[] = [
    { label: "PV créés", key: "totalPv" },
    { label: "PV déjà signés parmi les PV créés", key: "signedPv" },
    { label: "Taux de signature (%)", key: "signatureRate" },
    { label: "Délai moyen création-signature (h)", key: "avgDelayHours" },
    { label: "Réserves enregistrées", key: "reservesTotal" },
    { label: "Réserves ouvertes ou en cours", key: "reservesOpen" },
    { label: "Photos ajoutées", key: "photosTotal" },
    { label: "Emails envoyés", key: "emailsSent" },
    { label: "Emails échoués", key: "emailsFailed" },
    { label: "PV avec dernière génération PDF sur la période", key: "pdfGenerated" },
    { label: "PV avec dernier envoi sur la période", key: "sentToClient" },
  ];
  if (stats.previousRange) rows.push(["Comparaison", rangeLabel(stats.previousRange)]);
  for (const metric of metrics)
    rows.push([
      metric.label,
      k[metric.key],
      ...(stats.previous ? [stats.previous[metric.key]] : []),
    ]);
  rows.push(["Signatures sans date exploitable (exclues du délai)", k.signaturesWithoutValidDate]);
  rows.push(
    [],
    ["À traiter aujourd’hui (hors période)", "Nombre"],
    ["Signatures en attente > 7 jours", stats.today.pendingOver7Days],
    ["Réserves majeures non clôturées", stats.today.reservesMajor],
    ["Réserves à valider", stats.today.reservesToValidate],
    ["Réserves à traiter", stats.today.reservesToProcess],
  );
  rows.push([], ["Évolution : cohorte de PV créés", "PV créés", "Déjà signés"]);
  for (const bucket of stats.buckets.rows) rows.push([bucket.label, bucket.created, bucket.signed]);
  rows.push([], ["État des réserves enregistrées", "Nombre"]);
  for (const status of k.reservesByStatus) rows.push([status.name, status.value]);
  for (const severity of k.reservesBySeverity) rows.push([severity.name, severity.value]);
  rows.push([], ["Journal d’actions par membre (pas un classement)", "Actions"]);
  for (const member of stats.activityByUser) rows.push([member.name, member.count]);
  return rows;
}
export function statsCsvCell(value: string | number | null) {
  let text =
    value === null
      ? "Non disponible"
      : typeof value === "number"
        ? value.toLocaleString("fr-FR", { useGrouping: false, maximumFractionDigits: 2 })
        : value;
  if (/^[\s]*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function buildStatsCsv(stats: CompanyStats, companyName: string) {
  return (
    "\uFEFF" +
    statsExportRows(stats, companyName)
      .map((row) => row.map(statsCsvCell).join(";"))
      .join("\r\n")
  );
}

/** WinAnsi-safe French report; wrap by measured glyph width, including long identities. */
export async function buildStatsPdf(stats: CompanyStats, companyName: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const safe = (s: string) =>
    [
      ...s
        .replace(/[’‘]/g, "'")
        .replace(/[–—]/g, "-")
        .replace(/→/g, "au")
        .replace(/•/g, "-")
        .replace(/\u202f|\u00a0/g, " "),
    ]
      .map((character) => {
        try {
          font.encodeText(character);
          return character;
        } catch {
          return "?";
        }
      })
      .join("");
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const draw = (value: string, heading = false) => {
    const size = heading ? 13 : 10;
    const face = heading ? bold : font;
    let line = "";
    const output = (text: string) => {
      if (y < 62) {
        page = pdf.addPage([595, 842]);
        y = 790;
      }
      page.drawText(text, { x: 44, y, size, font: face, color: rgb(0.12, 0.15, 0.18) });
      y -= size + 7;
    };
    // Character-level fallback wraps unbroken names/URLs as well as normal words.
    for (const character of safe(value)) {
      if (face.widthOfTextAtSize(line + character, size) > 507) {
        output(line);
        line = "";
      }
      line += character;
    }
    output(line);
  };
  for (const [index, row] of statsExportRows(stats, companyName).entries()) {
    if (!row.length) {
      y -= 12;
      continue;
    }
    draw(
      row
        .map((v) =>
          v === null
            ? "Non disponible"
            : typeof v === "number"
              ? v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })
              : v,
        )
        .join(" | "),
      index === 0 || row[0] === "Indicateur",
    );
  }
  for (const [index, p] of pdf.getPages().entries())
    p.drawText(`PVIA - Statistiques | ${index + 1} / ${pdf.getPageCount()}`, {
      x: 44,
      y: 28,
      size: 9,
      font,
    });
  pdf.setTitle(`Statistiques - ${safe(companyName)}`);
  return pdf.save();
}
