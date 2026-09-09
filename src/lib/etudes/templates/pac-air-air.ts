/** Cahier des charges — PAC air/air (climatisation réversible). */
import type { StudyTemplate } from "../types";

export const STUDY_PAC_AIR_AIR_TEMPLATE: StudyTemplate = {
  type: "pac_air_air",
  label: "PAC air / air",
  tagline: "Pièces à traiter, split ou gainable, puissance indicative",
  chantierType: "PAC air/air",
  photoCategories: ["Bâtiment", "Pièces", "Extérieur", "Électricité"],
  docCategories: ["Facture d'énergie", "Plan / cadastre", "Devis existant"],
  sections: [
    {
      key: "besoin",
      title: "Besoin du client",
      short: "Besoin",
      fields: [
        {
          key: "usage",
          label: "Usage recherché",
          type: "select",
          required: true,
          options: [
            { value: "chauffage", label: "Chauffage principalement" },
            { value: "climatisation", label: "Climatisation principalement" },
            { value: "reversible", label: "Chaud et froid" },
          ],
        },
        {
          key: "type_installation",
          label: "Type d'installation envisagé",
          type: "select",
          required: true,
          options: [
            { value: "mono_split", label: "Mono-split" },
            { value: "multi_split", label: "Multi-split" },
            { value: "gainable", label: "Gainable" },
            { value: "a_definir", label: "À définir" },
          ],
        },
        { key: "nb_pieces", label: "Nombre de pièces à traiter", type: "number", min: 1, max: 12, required: true },
        { key: "contexte", label: "Contexte / attentes exprimées", type: "textarea", wide: true },
      ],
      photos: [],
    },
    {
      key: "batiment",
      title: "Bâtiment & isolation",
      short: "Bâtiment",
      fields: [
        { key: "surface_totale", label: "Surface totale du logement", type: "number", unit: "m²", min: 0, max: 3000 },
        { key: "hauteur_plafond", label: "Hauteur sous plafond", type: "number", unit: "m", min: 2, max: 8 },
        {
          key: "isolation",
          label: "Niveau d'isolation",
          type: "select",
          required: true,
          options: [
            { value: "faible", label: "Faible" },
            { value: "moyenne", label: "Moyenne" },
            { value: "bonne", label: "Bonne" },
            { value: "rt2012", label: "Très bonne (RT2012 / RE2020)" },
          ],
        },
        {
          key: "zone_climatique",
          label: "Zone climatique",
          type: "select",
          required: true,
          options: [
            { value: "h1", label: "H1 (Nord / Est)" },
            { value: "h2", label: "H2 (Ouest / Centre)" },
            { value: "h3", label: "H3 (Méditerranée)" },
          ],
        },
      ],
      photos: [{ key: "photo_facade", label: "Façade principale", category: "Bâtiment" }],
    },
    {
      key: "pieces",
      title: "Pièces à équiper",
      short: "Pièces",
      description: "Une fiche par pièce à traiter.",
      repeat: { countField: "nb_pieces", itemLabel: "Pièce", min: 1, max: 12 },
      fields: [
        { key: "piece_nom", label: "Nom de la pièce", type: "text", required: true, placeholder: "Séjour, chambre 1…" },
        { key: "piece_surface", label: "Surface", type: "number", unit: "m²", min: 0, max: 400, required: true },
        { key: "piece_exposition", label: "Exposition", type: "select", options: [
          { value: "nord", label: "Nord" },
          { value: "sud", label: "Sud" },
          { value: "est", label: "Est" },
          { value: "ouest", label: "Ouest" },
        ] },
        { key: "piece_niveau", label: "Niveau", type: "select", options: [
          { value: "rdc", label: "Rez-de-chaussée" },
          { value: "etage", label: "Étage" },
          { value: "combles", label: "Combles" },
        ] },
        { key: "piece_mur_ext", label: "Mur extérieur disponible pour l'unité", type: "boolean" },
      ],
      photos: [{ key: "photo_piece", label: "Vue de la pièce", category: "Pièces" }],
    },
    {
      key: "technique",
      title: "Implantation & électricité",
      short: "Technique",
      fields: [
        { key: "emplacement_groupe", label: "Emplacement du groupe extérieur", type: "text", wide: true },
        { key: "distance_liaisons", label: "Longueur estimée des liaisons frigorifiques", type: "number", unit: "m", min: 0, max: 200 },
        { key: "puissance_souscrite", label: "Puissance souscrite", type: "number", unit: "kVA", min: 0, max: 250 },
        { key: "tableau_etat", label: "État du tableau électrique", type: "select", options: [
          { value: "recent", label: "Récent / aux normes" },
          { value: "ancien", label: "Ancien mais fonctionnel" },
          { value: "a_remplacer", label: "À remplacer" },
        ] },
        { key: "voisinage_sensible", label: "Voisinage sensible (bruit)", type: "boolean" },
        { key: "copropriete", label: "Copropriété / autorisation nécessaire", type: "boolean" },
      ],
      photos: [
        { key: "photo_emplacement_ext", label: "Emplacement groupe extérieur", category: "Extérieur", required: true },
        { key: "photo_tableau", label: "Tableau électrique", category: "Électricité" },
      ],
    },
    {
      key: "vigilance",
      title: "Points de vigilance",
      short: "Vigilance",
      fields: [
        { key: "contraintes_identifiees", label: "Contraintes identifiées", type: "textarea", wide: true },
        { key: "questions_ouvertes", label: "Questions restant ouvertes", type: "textarea", wide: true },
      ],
      photos: [],
    },
  ],
};
