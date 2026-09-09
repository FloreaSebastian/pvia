/** Cahier des charges — PAC air/eau. */
import type { StudyTemplate } from "../types";

export const STUDY_PAC_AIR_EAU_TEMPLATE: StudyTemplate = {
  type: "pac_air_eau",
  label: "PAC air / eau",
  tagline: "Déperditions, émetteurs, ECS et puissance indicative",
  chantierType: "PAC air/eau",
  photoCategories: ["Bâtiment", "Chaufferie", "Émetteurs", "Extérieur"],
  docCategories: ["Facture d'énergie", "Diagnostic / DPE", "Plan / cadastre", "Devis existant"],
  sections: [
    {
      key: "besoin",
      title: "Besoin du client",
      short: "Besoin",
      fields: [
        {
          key: "objectif",
          label: "Objectif principal",
          type: "select",
          required: true,
          options: [
            { value: "remplacement", label: "Remplacement d'une chaudière" },
            { value: "complement", label: "Complément de chauffage" },
            { value: "neuf", label: "Installation neuve" },
          ],
        },
        {
          key: "energie_actuelle",
          label: "Énergie de chauffage actuelle",
          type: "select",
          required: true,
          options: [
            { value: "fioul", label: "Fioul" },
            { value: "gaz", label: "Gaz" },
            { value: "electrique", label: "Électrique" },
            { value: "bois", label: "Bois" },
            { value: "aucune", label: "Aucune" },
          ],
        },
        { key: "budget_annuel_energie", label: "Budget énergie annuel actuel", type: "number", unit: "€", min: 0, max: 100000 },
        { key: "nb_occupants", label: "Nombre d'occupants", type: "number", min: 1, max: 30, required: true },
        { key: "contexte", label: "Contexte / attentes exprimées", type: "textarea", wide: true },
      ],
      photos: [],
    },
    {
      key: "batiment",
      title: "Bâtiment & isolation",
      short: "Bâtiment",
      fields: [
        { key: "surface_chauffee", label: "Surface chauffée", type: "number", unit: "m²", min: 0, max: 5000, required: true },
        { key: "hauteur_plafond", label: "Hauteur sous plafond", type: "number", unit: "m", min: 2, max: 8 },
        { key: "annee_construction", label: "Année de construction", type: "number", min: 1800, max: 2100 },
        {
          key: "isolation",
          label: "Niveau d'isolation",
          type: "select",
          required: true,
          options: [
            { value: "faible", label: "Faible (avant 1975, non rénové)" },
            { value: "moyenne", label: "Moyenne (isolation partielle)" },
            { value: "bonne", label: "Bonne (rénovation récente)" },
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
        { key: "altitude", label: "Altitude", type: "number", unit: "m", min: 0, max: 3000 },
      ],
      photos: [{ key: "photo_facade", label: "Façade principale", category: "Bâtiment" }],
    },
    {
      key: "hydraulique",
      title: "Émetteurs & hydraulique",
      short: "Hydraulique",
      fields: [
        {
          key: "emetteurs",
          label: "Émetteurs existants",
          type: "select",
          required: true,
          options: [
            { value: "plancher_chauffant", label: "Plancher chauffant" },
            { value: "radiateurs_bt", label: "Radiateurs basse température" },
            { value: "radiateurs_ht", label: "Radiateurs haute température (fonte)" },
            { value: "mixte", label: "Mixte" },
            { value: "aucun", label: "Aucun (à créer)" },
          ],
        },
        { key: "nb_radiateurs", label: "Nombre de radiateurs", type: "number", min: 0, max: 100, visibleIf: [{ field: "emetteurs", in: ["radiateurs_bt", "radiateurs_ht", "mixte"] }] },
        { key: "production_ecs", label: "Production d'eau chaude sanitaire à intégrer", type: "boolean" },
        { key: "local_technique", label: "Local technique disponible", type: "select", options: [
          { value: "oui", label: "Oui" },
          { value: "exigu", label: "Exigu" },
          { value: "non", label: "Non" },
        ] },
        { key: "evacuation_condensats", label: "Évacuation des condensats possible", type: "boolean" },
        { key: "distance_unite_ext", label: "Distance unité extérieure → local technique", type: "number", unit: "m", min: 0, max: 200 },
      ],
      photos: [
        { key: "photo_chaufferie", label: "Chaufferie / chaudière actuelle", category: "Chaufferie", required: true },
        { key: "photo_emetteurs", label: "Émetteurs", category: "Émetteurs", multiple: true },
      ],
    },
    {
      key: "electricite",
      title: "Électricité & implantation",
      short: "Électricité",
      fields: [
        { key: "puissance_souscrite", label: "Puissance souscrite", type: "number", unit: "kVA", min: 0, max: 250 },
        { key: "type_raccordement", label: "Type de raccordement", type: "select", options: [
          { value: "mono", label: "Monophasé" },
          { value: "tri", label: "Triphasé" },
        ] },
        { key: "emplacement_ext", label: "Emplacement unité extérieure", type: "text", wide: true },
        { key: "voisinage_sensible", label: "Voisinage sensible (bruit)", type: "boolean" },
      ],
      photos: [
        { key: "photo_tableau", label: "Tableau électrique", category: "Chaufferie" },
        { key: "photo_emplacement_ext", label: "Emplacement extérieur envisagé", category: "Extérieur", required: true },
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
