/**
 * Cahier des charges — Photovoltaïque.
 * Les clés de champs ne doivent jamais être renommées (données historiques).
 */
import type { StudyTemplate } from "../types";

const OUI_NON = [
  { value: "oui", label: "Oui" },
  { value: "non", label: "Non" },
  { value: "inconnu", label: "À vérifier" },
];

export const STUDY_PV_TEMPLATE: StudyTemplate = {
  type: "photovoltaique",
  label: "Photovoltaïque",
  tagline: "Besoin, toiture, raccordement et puissance indicative",
  chantierType: "Photovoltaïque",
  photoCategories: ["Bâtiment", "Toiture", "Électricité", "Environnement"],
  docCategories: ["Facture d'énergie", "Plan / cadastre", "Photo toiture", "Photo tableau électrique"],
  sections: [
    {
      key: "besoin",
      title: "Besoin du client",
      short: "Besoin",
      description: "Ce que le client cherche à obtenir et son cadre budgétaire.",
      fields: [
        {
          key: "objectif",
          label: "Objectif principal",
          type: "select",
          required: true,
          options: [
            { value: "autoconsommation", label: "Autoconsommation" },
            { value: "autoconsommation_vente", label: "Autoconsommation + vente du surplus" },
            { value: "vente_totale", label: "Vente totale" },
          ],
        },
        { key: "consommation_annuelle", label: "Consommation annuelle", type: "number", unit: "kWh", min: 0, max: 500000, required: true },
        { key: "facture_mensuelle", label: "Facture d'électricité mensuelle", type: "number", unit: "€", min: 0, max: 20000 },
        {
          key: "budget",
          label: "Budget envisagé",
          type: "select",
          options: [
            { value: "moins_10k", label: "Moins de 10 000 €" },
            { value: "10_20k", label: "10 000 à 20 000 €" },
            { value: "20_40k", label: "20 000 à 40 000 €" },
            { value: "plus_40k", label: "Plus de 40 000 €" },
            { value: "a_definir", label: "À définir" },
          ],
        },
        {
          key: "echeance",
          label: "Échéance souhaitée",
          type: "select",
          options: [
            { value: "immediat", label: "Dès que possible" },
            { value: "3_mois", label: "Sous 3 mois" },
            { value: "6_mois", label: "Sous 6 mois" },
            { value: "indetermine", label: "Non déterminée" },
          ],
        },
        { key: "projets_lies", label: "Projets liés", type: "multiselect", wide: true, options: [
          { value: "borne_recharge", label: "Borne de recharge" },
          { value: "batterie", label: "Batterie de stockage" },
          { value: "pac", label: "Pompe à chaleur" },
          { value: "ballon_thermo", label: "Ballon thermodynamique" },
        ] },
        { key: "contexte", label: "Contexte / attentes exprimées", type: "textarea", wide: true },
      ],
      photos: [],
    },
    {
      key: "batiment",
      title: "Bâtiment",
      short: "Bâtiment",
      fields: [
        {
          key: "batiment_type",
          label: "Type de bâtiment",
          type: "select",
          required: true,
          options: [
            { value: "maison_individuelle", label: "Maison individuelle" },
            { value: "maison_mitoyenne", label: "Maison mitoyenne" },
            { value: "immeuble", label: "Immeuble" },
            { value: "batiment_agricole", label: "Bâtiment agricole" },
            { value: "batiment_industriel", label: "Bâtiment industriel / tertiaire" },
          ],
        },
        { key: "annee_construction", label: "Année de construction", type: "number", min: 1800, max: 2100 },
        { key: "nb_niveaux", label: "Nombre de niveaux", type: "number", min: 1, max: 12 },
        { key: "zone_protegee", label: "Zone protégée / ABF / copropriété", type: "select", options: OUI_NON, help: "Un avis externe peut être obligatoire." },
        {
          key: "acces_chantier",
          label: "Accès chantier",
          type: "select",
          options: [
            { value: "facile", label: "Facile (camion au pied du bâtiment)" },
            { value: "moyen", label: "Moyen (portage nécessaire)" },
            { value: "difficile", label: "Difficile (accès étroit, nacelle)" },
          ],
        },
      ],
      photos: [
        { key: "photo_facade", label: "Façade principale", category: "Bâtiment", instruction: "Reculez pour cadrer tout le bâtiment." },
        { key: "photo_environnement", label: "Environnement immédiat", category: "Environnement", multiple: true },
      ],
    },
    {
      key: "toiture",
      title: "Toiture",
      short: "Toiture",
      fields: [
        {
          key: "couverture_type",
          label: "Type de couverture",
          type: "select",
          required: true,
          options: [
            { value: "tuiles_mecaniques", label: "Tuiles mécaniques" },
            { value: "tuiles_canal", label: "Tuiles canal" },
            { value: "ardoises", label: "Ardoises" },
            { value: "bac_acier", label: "Bac acier" },
            { value: "fibro_ciment", label: "Fibro-ciment" },
            { value: "toit_terrasse", label: "Toit terrasse" },
          ],
        },
        { key: "couverture_etat", label: "État de la couverture", type: "select", options: [
          { value: "bon", label: "Bon" },
          { value: "moyen", label: "Moyen" },
          { value: "degrade", label: "Dégradé (reprise nécessaire)" },
        ] },
        {
          key: "amiante_suspecte",
          label: "Amiante suspectée",
          type: "select",
          options: OUI_NON,
          visibleIf: [{ field: "couverture_type", in: ["fibro_ciment"] }],
        },
        { key: "surface_disponible", label: "Surface de toiture exploitable", type: "number", unit: "m²", min: 0, max: 20000, required: true },
        {
          key: "orientation",
          label: "Orientation principale",
          type: "select",
          required: true,
          options: [
            { value: "sud", label: "Sud" },
            { value: "sud_est", label: "Sud-Est" },
            { value: "sud_ouest", label: "Sud-Ouest" },
            { value: "est", label: "Est" },
            { value: "ouest", label: "Ouest" },
            { value: "est_ouest", label: "Est / Ouest" },
            { value: "nord", label: "Nord" },
          ],
        },
        { key: "inclinaison", label: "Inclinaison", type: "number", unit: "°", min: 0, max: 60 },
        {
          key: "ombrage",
          label: "Ombrage",
          type: "select",
          required: true,
          options: [
            { value: "aucun", label: "Aucun" },
            { value: "faible", label: "Faible (matin ou soir)" },
            { value: "moyen", label: "Moyen" },
            { value: "fort", label: "Fort (arbres, bâtiment proche)" },
          ],
        },
        { key: "hauteur_gouttiere", label: "Hauteur de gouttière", type: "number", unit: "m", min: 0, max: 60 },
      ],
      photos: [
        { key: "photo_toiture", label: "Toiture", category: "Toiture", required: true, multiple: true },
        { key: "photo_combles", label: "Charpente / combles", category: "Toiture" },
      ],
    },
    {
      key: "electricite",
      title: "Raccordement électrique",
      short: "Électricité",
      fields: [
        { key: "compteur_linky", label: "Compteur Linky", type: "select", options: OUI_NON, required: true },
        { key: "puissance_souscrite", label: "Puissance souscrite", type: "number", unit: "kVA", min: 0, max: 250 },
        { key: "type_raccordement", label: "Type de raccordement", type: "select", options: [
          { value: "mono", label: "Monophasé" },
          { value: "tri", label: "Triphasé" },
        ] },
        { key: "tableau_etat", label: "État du tableau électrique", type: "select", options: [
          { value: "recent", label: "Récent / aux normes" },
          { value: "ancien", label: "Ancien mais fonctionnel" },
          { value: "a_remplacer", label: "À remplacer" },
        ] },
        { key: "emplacement_onduleur", label: "Emplacement envisagé onduleur", type: "text" },
        { key: "distance_tableau", label: "Distance toiture → tableau", type: "number", unit: "m", min: 0, max: 500 },
        { key: "batterie_souhaitee", label: "Batterie souhaitée", type: "boolean" },
        { key: "borne_recharge", label: "Borne de recharge à prévoir", type: "boolean" },
      ],
      photos: [
        { key: "photo_tableau", label: "Tableau électrique", category: "Électricité", required: true },
        { key: "photo_compteur", label: "Compteur", category: "Électricité" },
      ],
    },
    {
      key: "vigilance",
      title: "Points de vigilance",
      short: "Vigilance",
      description: "Éléments à confirmer lors de la visite technique.",
      fields: [
        { key: "contraintes_identifiees", label: "Contraintes identifiées", type: "textarea", wide: true },
        { key: "questions_ouvertes", label: "Questions restant ouvertes", type: "textarea", wide: true },
      ],
      photos: [],
    },
  ],
};
