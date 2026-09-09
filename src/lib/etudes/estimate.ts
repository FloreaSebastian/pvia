/**
 * Cahiers des charges — pré-dimensionnement indicatif.
 *
 * Module PUR (aucun import serveur ni React) : chaque valeur produite ici est
 * une ESTIMATION d'avant-vente destinée à cadrer le besoin. Elle n'engage pas
 * l'entreprise et sera confirmée par la visite technique.
 */
import type { AnswerMap, AnswerValue } from "../visites/types";
import type { StudyEstimate, StudyType } from "./types";

export const ESTIMATE_DISCLAIMER =
  "Estimation indicative issue des éléments déclarés. Elle ne constitue ni un devis, ni un dimensionnement définitif : seule la visite technique fait foi.";

function num(answers: AnswerMap, key: string): number | null {
  const v: AnswerValue | undefined = answers[key];
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function str(answers: AnswerMap, key: string): string | null {
  const v = answers[key];
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.join(",");
  const s = String(v).trim();
  return s ? s : null;
}

function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function fmt(value: number, decimals = 0): string {
  return round(value, decimals).toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function range(value: number, spread = 0.15, decimals = 0): string {
  return `${fmt(value * (1 - spread), decimals)} – ${fmt(value * (1 + spread), decimals)}`;
}

/* ------------------------------- Photovoltaïque ------------------------------ */

const PV_ORIENTATION_FACTOR: Record<string, number> = {
  sud: 1,
  sud_est: 0.95,
  sud_ouest: 0.95,
  est: 0.85,
  ouest: 0.85,
  est_ouest: 0.85,
  nord: 0.6,
};

const PV_SHADE_FACTOR: Record<string, number> = {
  aucun: 1,
  faible: 0.93,
  moyen: 0.82,
  fort: 0.65,
};

/** Surface de toiture nécessaire pour 1 kWc, modules actuels. */
export const PV_M2_PER_KWC = 5;
/** Productible de référence en France, plein sud, sans ombrage. */
export const PV_KWH_PER_KWC = 1100;

function estimatePv(answers: AnswerMap): StudyEstimate {
  const missing: string[] = [];
  const warnings: string[] = [];

  const surface = num(answers, "surface_disponible");
  const conso = num(answers, "consommation_annuelle");
  const orientation = str(answers, "orientation");
  const ombrage = str(answers, "ombrage");
  const objectif = str(answers, "objectif");

  if (surface === null) missing.push("Surface de toiture exploitable");
  if (conso === null) missing.push("Consommation annuelle");
  if (!orientation) missing.push("Orientation principale");
  if (!ombrage) missing.push("Ombrage");

  const orientationFactor = PV_ORIENTATION_FACTOR[orientation ?? ""] ?? 0.9;
  const shadeFactor = PV_SHADE_FACTOR[ombrage ?? ""] ?? 0.9;

  if (surface === null) {
    return { headline: null, items: [], warnings, missing };
  }

  const kwcFromRoof = surface / PV_M2_PER_KWC;
  // En autoconsommation on ne surdimensionne pas au-delà du besoin réel.
  const kwcFromNeed =
    conso !== null && objectif !== "vente_totale"
      ? conso / (PV_KWH_PER_KWC * orientationFactor * shadeFactor) * 0.9
      : kwcFromRoof;

  const raw = Math.min(kwcFromRoof, Math.max(kwcFromNeed, 1));
  const kwc = Math.max(1.5, round(raw * 2, 0) / 2);
  const production = kwc * PV_KWH_PER_KWC * orientationFactor * shadeFactor;
  const modules = Math.ceil((kwc * 1000) / 500);
  const surfaceUtilisee = kwc * PV_M2_PER_KWC;
  const pricePerKwc = kwc <= 9 ? 2200 : kwc <= 36 ? 1600 : 1100;
  const budget = kwc * pricePerKwc;
  const autoconsoRate = objectif === "vente_totale" ? 0 : objectif === "autoconsommation" ? 0.8 : 0.6;
  const economie = production * autoconsoRate * 0.25;

  if (ombrage === "fort") warnings.push("Ombrage fort déclaré : une étude d'ombrage et des optimiseurs sont probablement nécessaires.");
  if (orientation === "nord") warnings.push("Orientation nord : productible fortement dégradé, à reconsidérer.");
  if (str(answers, "couverture_etat") === "degrade") warnings.push("Couverture dégradée : reprise de toiture à chiffrer avant pose.");
  if (str(answers, "amiante_suspecte") === "oui") warnings.push("Amiante suspectée : diagnostic obligatoire avant toute intervention.");
  if (str(answers, "zone_protegee") === "oui") warnings.push("Zone protégée / copropriété : autorisation externe à obtenir.");
  if (kwc > 9) warnings.push("Puissance supérieure à 9 kWc : démarches de raccordement renforcées.");
  if (num(answers, "puissance_souscrite") !== null && kwc > (num(answers, "puissance_souscrite") ?? 0)) {
    warnings.push("Puissance envisagée supérieure à la puissance souscrite : raccordement à vérifier.");
  }

  return {
    headline: { label: "Puissance indicative", value: `${fmt(kwc, 1)} kWc` },
    items: [
      { key: "puissance", label: "Puissance envisagée", value: `${fmt(kwc, 1)} kWc` },
      { key: "modules", label: "Nombre de modules (500 Wc)", value: `≈ ${modules}` },
      { key: "surface", label: "Surface de toiture mobilisée", value: `≈ ${fmt(surfaceUtilisee)} m²`, help: `Toiture exploitable déclarée : ${fmt(surface)} m²` },
      { key: "production", label: "Production annuelle estimée", value: `${range(production, 0.12)} kWh` },
      ...(autoconsoRate > 0
        ? [{ key: "economie", label: "Économie annuelle estimée", value: `${range(economie, 0.2)} €`, help: "Base 0,25 €/kWh autoconsommé." }]
        : []),
      { key: "budget", label: "Budget indicatif", value: `${range(budget, 0.2)} € HT` },
    ],
    warnings,
    missing,
  };
}

/* --------------------------------- PAC air/eau -------------------------------- */

/** Besoin surfacique en W/m² selon l'isolation. */
export const AE_W_PER_M2: Record<string, number> = {
  faible: 100,
  moyenne: 75,
  bonne: 55,
  rt2012: 40,
};

export const ZONE_FACTOR: Record<string, number> = { h1: 1.1, h2: 1, h3: 0.85 };

const AE_COP: Record<string, number> = {
  plancher_chauffant: 4,
  radiateurs_bt: 3.5,
  radiateurs_ht: 2.7,
  mixte: 3.2,
  aucun: 3.5,
};

function estimatePacAirEau(answers: AnswerMap): StudyEstimate {
  const missing: string[] = [];
  const warnings: string[] = [];

  const surface = num(answers, "surface_chauffee");
  const isolation = str(answers, "isolation");
  const zone = str(answers, "zone_climatique");
  const emetteurs = str(answers, "emetteurs");
  const occupants = num(answers, "nb_occupants");
  const hauteur = num(answers, "hauteur_plafond") ?? 2.5;

  if (surface === null) missing.push("Surface chauffée");
  if (!isolation) missing.push("Niveau d'isolation");
  if (!zone) missing.push("Zone climatique");
  if (!emetteurs) missing.push("Émetteurs existants");

  if (surface === null || !isolation || !zone) {
    return { headline: null, items: [], warnings, missing };
  }

  const wPerM2 = AE_W_PER_M2[isolation] ?? 75;
  const heightFactor = Math.min(1.3, Math.max(1, hauteur / 2.5));
  const altitude = num(answers, "altitude") ?? 0;
  const altitudeFactor = altitude > 800 ? 1.1 : 1;
  const puissance = (surface * wPerM2 * (ZONE_FACTOR[zone] ?? 1) * heightFactor * altitudeFactor) / 1000;
  const cop = AE_COP[emetteurs ?? ""] ?? 3.3;
  const besoinAnnuel = puissance * 1600; // kWh utiles / an
  const consoElec = besoinAnnuel / cop;
  const ecs = answers["production_ecs"] === true;
  const ballon = ecs ? Math.max(150, (occupants ?? 3) * 50) : null;
  const budget = puissance * 900 + (ecs ? 1500 : 0);

  if (emetteurs === "radiateurs_ht") warnings.push("Radiateurs haute température : COP dégradé, vérifier la température de départ ou prévoir un remplacement d'émetteurs.");
  if (isolation === "faible") warnings.push("Isolation faible : envisager des travaux d'isolation pour éviter un surdimensionnement.");
  if (str(answers, "local_technique") === "non") warnings.push("Aucun local technique : implantation du module intérieur à définir en visite.");
  if (answers["evacuation_condensats"] === false) warnings.push("Évacuation des condensats à créer.");
  if (answers["voisinage_sensible"] === true) warnings.push("Voisinage sensible : étude acoustique et distance d'implantation à respecter.");
  if (puissance > 16) warnings.push("Puissance élevée : raccordement triphasé probablement nécessaire.");

  return {
    headline: { label: "Puissance indicative", value: `${fmt(puissance, 1)} kW` },
    items: [
      { key: "puissance", label: "Puissance de chauffage estimée", value: `${fmt(puissance, 1)} kW`, help: `${wPerM2} W/m² × ${fmt(surface)} m², zone ${zone.toUpperCase()}` },
      { key: "cop", label: "COP moyen attendu", value: fmt(cop, 1) },
      { key: "besoin", label: "Besoin de chauffage annuel", value: `${range(besoinAnnuel, 0.15)} kWh` },
      { key: "conso", label: "Consommation électrique estimée", value: `${range(consoElec, 0.15)} kWh/an` },
      ...(ballon ? [{ key: "ecs", label: "Ballon ECS recommandé", value: `${fmt(ballon)} L` }] : []),
      { key: "budget", label: "Budget indicatif", value: `${range(budget, 0.2)} € HT` },
    ],
    warnings,
    missing,
  };
}

/* --------------------------------- PAC air/air -------------------------------- */

export const AA_W_PER_M2: Record<string, number> = {
  faible: 110,
  moyenne: 90,
  bonne: 70,
  rt2012: 55,
};

function estimatePacAirAir(answers: AnswerMap): StudyEstimate {
  const missing: string[] = [];
  const warnings: string[] = [];

  const nbPieces = num(answers, "nb_pieces");
  const isolation = str(answers, "isolation");
  const zone = str(answers, "zone_climatique");

  if (nbPieces === null) missing.push("Nombre de pièces à traiter");
  if (!isolation) missing.push("Niveau d'isolation");
  if (!zone) missing.push("Zone climatique");

  const count = Math.max(0, Math.min(12, Math.round(nbPieces ?? 0)));
  const rooms: { label: string; surface: number }[] = [];
  for (let i = 0; i < count; i++) {
    const s = num(answers, `piece_surface__${i}`);
    if (s !== null && s > 0) rooms.push({ label: str(answers, `piece_nom__${i}`) ?? `Pièce ${i + 1}`, surface: s });
  }

  if (rooms.length === 0) missing.push("Surface d'au moins une pièce");
  if (rooms.length === 0 || !isolation || !zone) {
    return { headline: null, items: [], warnings, missing };
  }

  const wPerM2 = AA_W_PER_M2[isolation] ?? 90;
  const zoneFactor = ZONE_FACTOR[zone] ?? 1;
  const hauteur = num(answers, "hauteur_plafond") ?? 2.5;
  const heightFactor = Math.min(1.3, Math.max(1, hauteur / 2.5));

  const perRoom = rooms.map((r) => ({
    ...r,
    kw: (r.surface * wPerM2 * zoneFactor * heightFactor) / 1000,
  }));
  const totalSurface = rooms.reduce((s, r) => s + r.surface, 0);
  const totalKw = perRoom.reduce((s, r) => s + r.kw, 0);
  // Foisonnement : toutes les unités ne fonctionnent jamais à pleine charge.
  const groupeKw = totalKw * 0.85;
  const typeInstall = str(answers, "type_installation");
  const budget = totalKw * 950 + rooms.length * 350;

  if (rooms.length !== count) warnings.push(`Surface renseignée pour ${rooms.length} pièce(s) sur ${count} déclarée(s).`);
  if (rooms.length > 1 && typeInstall === "mono_split") warnings.push("Plusieurs pièces à traiter avec un mono-split : un multi-split ou un gainable est plus adapté.");
  if (answers["copropriete"] === true) warnings.push("Copropriété : autorisation d'installation du groupe extérieur à obtenir.");
  if (answers["voisinage_sensible"] === true) warnings.push("Voisinage sensible : implantation et niveau sonore du groupe à valider.");
  if (str(answers, "tableau_etat") === "a_remplacer") warnings.push("Tableau électrique à remplacer : à intégrer au chiffrage.");
  for (let i = 0; i < count; i++) {
    if (answers[`piece_mur_ext__${i}`] === false) {
      warnings.push(`${str(answers, `piece_nom__${i}`) ?? `Pièce ${i + 1}`} sans mur extérieur : cheminement des liaisons à étudier.`);
    }
  }

  return {
    headline: { label: "Puissance indicative", value: `${fmt(totalKw, 1)} kW` },
    items: [
      { key: "puissance", label: "Puissance totale estimée", value: `${fmt(totalKw, 1)} kW`, help: `${wPerM2} W/m², zone ${zone.toUpperCase()}` },
      { key: "surface", label: "Surface traitée", value: `${fmt(totalSurface)} m²` },
      { key: "unites", label: "Unités intérieures", value: `${rooms.length}` },
      { key: "groupe", label: "Groupe extérieur", value: `≈ ${fmt(groupeKw, 1)} kW`, help: "Foisonnement de 15 % appliqué." },
      ...perRoom.map((r, i) => ({
        key: `piece_${i}`,
        label: r.label,
        value: `${fmt(r.surface)} m² → ${fmt(r.kw, 1)} kW`,
      })),
      { key: "budget", label: "Budget indicatif", value: `${range(budget, 0.2)} € HT` },
    ],
    warnings,
    missing,
  };
}

/** Point d'entrée unique du pré-dimensionnement. */
export function computeStudyEstimate(type: StudyType, answers: AnswerMap): StudyEstimate {
  switch (type) {
    case "photovoltaique":
      return estimatePv(answers);
    case "pac_air_eau":
      return estimatePacAirEau(answers);
    case "pac_air_air":
      return estimatePacAirAir(answers);
    default:
      return { headline: null, items: [], warnings: [], missing: [] };
  }
}
