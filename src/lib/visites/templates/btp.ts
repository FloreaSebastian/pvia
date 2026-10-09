/**
 * Visite technique BTP multi-lots (visit_type = "btp").
 *
 * Template composé : socle commun (site, zones, documents, points d'attention,
 * conclusion) + un module de relevés par lot retenu. Les lots PV / PAC
 * réutilisent les étapes métier des templates historiques, préfixées par le lot
 * (« photovoltaique.toiture ») pour ne jamais entrer en collision.
 *
 * Aucun calcul ni avis de conformité n'est produit : la visite consigne des
 * constats. Chaque relevé accepte Inconnu / Non vérifié / Non applicable.
 * Les clés ne doivent jamais être renommées (données enregistrées).
 */
import type { PhotoSlot, VisitField, VisitLot, VisitSection, VisitTemplate, VisibleIf } from "../types";
import { PHOTOVOLTAIQUE_TEMPLATE } from "./photovoltaique";
import { PAC_AIR_AIR_TEMPLATE } from "./pac-air-air";
import { PAC_AIR_EAU_TEMPLATE } from "./pac-air-eau";

const OUI_NON = [
  { value: "oui", label: "Oui" },
  { value: "non", label: "Non" },
];

const ETAT = [
  { value: "bon", label: "Bon état" },
  { value: "usage", label: "Usage normal" },
  { value: "degrade", label: "Dégradé" },
  { value: "tres_degrade", label: "Très dégradé" },
];

export const LOT_META: Record<VisitLot, { label: string; short: string; chantierType: string }> = {
  photovoltaique: { label: "Photovoltaïque", short: "PV", chantierType: "Photovoltaïque" },
  pac_air_air: { label: "PAC air-air", short: "PAC A/A", chantierType: "Climatisation / PAC Air-Air" },
  pac_air_eau: { label: "PAC air-eau", short: "PAC A/E", chantierType: "Pompe à chaleur Air-Eau" },
  electricite: { label: "Électricité", short: "Élec.", chantierType: "Électricité" },
  plomberie: { label: "Plomberie", short: "Plomb.", chantierType: "Plomberie" },
  ventilation: { label: "Ventilation", short: "VMC", chantierType: "Ventilation" },
  isolation_facade: { label: "Isolation / façade", short: "Isol.", chantierType: "Isolation / façade" },
  toiture: { label: "Toiture", short: "Toit.", chantierType: "Toiture" },
  renovation: { label: "Rénovation générale / maçonnerie", short: "Rénov.", chantierType: "Rénovation / maçonnerie" },
};

// ---------------------------------------------------------------------------
// Socle commun
// ---------------------------------------------------------------------------

const SITE: VisitSection = {
  key: "btp_site",
  title: "Site, accès et logistique",
  short: "Site",
  phase: "etat_des_lieux",
  description: "Accès, stationnement, livraison, occupation et moyens d'accès.",
  fields: [
    { key: "btp_occupation", label: "Occupation du site pendant les travaux", type: "select", required: true, options: [
      { value: "occupe", label: "Occupé" },
      { value: "inoccupe", label: "Inoccupé" },
      { value: "partiel", label: "Occupation partielle" },
      { value: "activite", label: "Activité en cours (commerce, ERP, bureaux)" },
    ] },
    { key: "btp_acces_vehicule", label: "Accès véhicule", type: "select", required: true, options: [
      { value: "facile", label: "Facile" },
      { value: "limite", label: "Limité (gabarit, voie étroite)" },
      { value: "difficile", label: "Difficile / impossible" },
    ] },
    { key: "btp_stationnement", label: "Stationnement", type: "select", required: true, options: [
      { value: "sur_site", label: "Sur la parcelle" },
      { value: "voie_publique", label: "Voie publique libre" },
      { value: "autorisation", label: "Autorisation de voirie nécessaire" },
      { value: "aucun", label: "Aucun à proximité" },
    ] },
    { key: "btp_distance_stationnement", label: "Distance stationnement → zone de travail", type: "number", unit: "m", min: 0, max: 2000, step: 1 },
    { key: "btp_livraison", label: "Livraison des matériaux", type: "select", options: [
      { value: "camion_grue", label: "Camion grue possible" },
      { value: "porteur", label: "Porteur / plateau" },
      { value: "manuelle", label: "Manutention manuelle uniquement" },
    ] },
    { key: "btp_stockage", label: "Zone de stockage disponible", type: "select", options: OUI_NON },
    { key: "btp_moyens_acces", label: "Moyens d'accès nécessaires", type: "multiselect", options: [
      { value: "plain_pied", label: "Plain-pied" },
      { value: "escalier", label: "Escalier intérieur" },
      { value: "echelle", label: "Échelle" },
      { value: "echafaudage", label: "Échafaudage" },
      { value: "nacelle", label: "Nacelle" },
      { value: "cordiste", label: "Travail sur cordes" },
    ] },
    { key: "btp_hauteur_travail", label: "Hauteur de travail maximale", type: "number", unit: "m", min: 0, max: 200, step: 0.1,
      visibleIf: [{ field: "btp_moyens_acces", in: ["echelle", "echafaudage", "nacelle", "cordiste"] }] },
    { key: "btp_protections", label: "Protections à prévoir", type: "multiselect", options: [
      { value: "sols", label: "Protection des sols" },
      { value: "mobilier", label: "Protection du mobilier" },
      { value: "poussiere", label: "Confinement poussière" },
      { value: "vegetation", label: "Protection végétation / abords" },
      { value: "balisage", label: "Balisage / sécurisation voie publique" },
      { value: "garde_corps", label: "Garde-corps / protections collectives" },
    ] },
    { key: "btp_amiante", label: "Matériaux susceptibles de contenir de l'amiante", type: "select", options: [
      { value: "non_observe", label: "Non observé" },
      { value: "suspect", label: "Suspect — repérage à demander" },
      { value: "rapport_existant", label: "Rapport de repérage existant" },
    ], help: "Simple observation visuelle : seul un repérage par un opérateur certifié fait foi." },
    { key: "btp_horaires", label: "Contraintes horaires / accès", type: "text", placeholder: "Ex. accès 8h–17h, badge, gardien" },
    { key: "btp_zones_count", label: "Nombre de pièces / zones à relever", type: "number", required: true, min: 1, max: 20, step: 1 },
  ],
  photos: [
    { key: "btp_photo_facade", label: "Vue générale du bâtiment", instruction: "Façade principale, adresse visible si possible.", category: "Site et accès", required: true },
    { key: "btp_photo_acces", label: "Accès et stationnement", instruction: "Voie d'accès, portail, zone de stationnement.", category: "Site et accès", multiple: true },
  ],
};

const ZONES: VisitSection = {
  key: "btp_zones",
  title: "Pièces et zones",
  short: "Zones",
  phase: "etat_des_lieux",
  description: "Dimensions et état existant de chaque zone concernée.",
  repeat: { countField: "btp_zones_count", itemLabel: "Zone", min: 1, max: 20 },
  fields: [
    { key: "zone_nom", label: "Nom de la zone", type: "text", required: true, placeholder: "Ex. Cuisine, Façade nord, Combles" },
    { key: "zone_niveau", label: "Niveau", type: "select", options: [
      { value: "sous_sol", label: "Sous-sol" },
      { value: "rdc", label: "Rez-de-chaussée" },
      { value: "etage", label: "Étage" },
      { value: "combles", label: "Combles" },
      { value: "exterieur", label: "Extérieur" },
      { value: "toiture", label: "Toiture" },
    ] },
    { key: "zone_longueur", label: "Longueur", type: "number", unit: "m", min: 0, max: 500, step: 0.01 },
    { key: "zone_largeur", label: "Largeur", type: "number", unit: "m", min: 0, max: 500, step: 0.01 },
    { key: "zone_hauteur", label: "Hauteur sous plafond", type: "number", unit: "m", min: 0, max: 50, step: 0.01 },
    { key: "zone_surface", label: "Surface relevée", type: "number", unit: "m²", min: 0, max: 100000, step: 0.01, help: "Valeur mesurée sur place, non calculée par l'application." },
    { key: "zone_etat", label: "État existant", type: "select", required: true, options: ETAT },
    { key: "zone_humidite", label: "Humidité visible", type: "select", options: [
      { value: "aucune", label: "Aucune trace" },
      { value: "traces", label: "Traces anciennes" },
      { value: "active", label: "Humidité active" },
    ] },
    { key: "zone_observations", label: "Observations", type: "textarea", wide: true },
  ],
  photos: [
    { key: "zone_photo", label: "Photos de la zone", instruction: "Vue d'ensemble puis détails utiles.", category: "Zones", multiple: true },
  ],
};

const POINTS: VisitSection = {
  key: "btp_points",
  title: "Photos et points d'attention",
  short: "Points",
  phase: "photos_points",
  kind: "constraints",
  description: "Constats nécessitant une action avant ou pendant les travaux.",
  fields: [{ key: "btp_points_synthese", label: "Commentaire général", type: "textarea", wide: true }],
  photos: [
    { key: "btp_photo_points", label: "Photos complémentaires", instruction: "Une photo par point d'attention, avec légende.", category: "Points d'attention", multiple: true },
  ],
};

const DOCUMENTS: VisitSection = {
  key: "btp_documents",
  title: "Documents et travaux préparatoires",
  short: "Préparation",
  phase: "synthese",
  fields: [
    { key: "btp_documents", label: "Documents à obtenir", type: "multiselect", options: [
      { value: "plans", label: "Plans du bâtiment" },
      { value: "diag_amiante", label: "Repérage amiante avant travaux" },
      { value: "diag_plomb", label: "Constat plomb" },
      { value: "dpe", label: "DPE / audit énergétique" },
      { value: "urbanisme", label: "Déclaration préalable / permis" },
      { value: "copropriete", label: "Accord de copropriété" },
      { value: "voirie", label: "Autorisation de voirie" },
      { value: "facture_energie", label: "Factures d'énergie" },
      { value: "attestation_elec", label: "Attestation / diagnostic électrique" },
      { value: "autre", label: "Autre (préciser)" },
    ] },
    { key: "btp_documents_autres", label: "Autres documents", type: "text", visibleIf: [{ field: "btp_documents", in: ["autre"] }] },
    { key: "btp_travaux_prep", label: "Travaux préparatoires", type: "multiselect", options: [
      { value: "deplacement_mobilier", label: "Déplacement de mobilier" },
      { value: "depose_existant", label: "Dépose de l'existant" },
      { value: "consignation_elec", label: "Consignation électrique" },
      { value: "coupure_eau", label: "Coupure d'eau" },
      { value: "elagage", label: "Élagage / dégagement des abords" },
      { value: "desamiantage", label: "Désamiantage (entreprise certifiée)" },
      { value: "echafaudage", label: "Montage d'échafaudage" },
      { value: "renfort", label: "Renfort de structure (à faire valider)" },
    ] },
    { key: "btp_travaux_prep_detail", label: "Détail des travaux préparatoires", type: "textarea", wide: true },
  ],
  photos: [],
};

const CONCLUSION: VisitSection = {
  key: "btp_conclusion",
  title: "Conclusion de la visite",
  short: "Conclusion",
  phase: "synthese",
  description: "Constat de visite avant travaux : ne vaut ni réception ni levée de réserves.",
  fields: [
    { key: "btp_conclusion", label: "Conclusion du technicien", type: "select", required: true, options: [
      { value: "faisable", label: "Faisable en l'état" },
      { value: "sous_conditions", label: "Faisable sous conditions" },
      { value: "complement", label: "Complément nécessaire avant décision" },
    ] },
    { key: "btp_conditions", label: "Conditions à lever", type: "textarea", wide: true, required: true,
      visibleIf: [{ field: "btp_conclusion", equals: "sous_conditions" }] },
    { key: "btp_complements", label: "Compléments nécessaires", type: "textarea", wide: true, required: true,
      visibleIf: [{ field: "btp_conclusion", equals: "complement" }] },
    { key: "btp_prochaines_etapes", label: "Prochaines étapes", type: "textarea", wide: true },
  ],
  photos: [],
};

const REVIEW: VisitSection = {
  key: "verification",
  title: "Vérification finale",
  short: "Vérification",
  phase: "synthese",
  kind: "review",
  fields: [],
  photos: [],
};

// ---------------------------------------------------------------------------
// Modules de relevés des nouveaux lots (clés locales, préfixées à la composition)
// ---------------------------------------------------------------------------

function lotSection(key: string, title: string, short: string, fields: VisitField[], photos: PhotoSlot[]): VisitSection {
  return { key, title, short, fields, photos };
}

const NEW_LOT_SECTIONS: Partial<Record<VisitLot, VisitSection[]>> = {
  electricite: [
    lotSection("releves", "Relevés électricité", "Électricité", [
      { key: "alimentation", label: "Alimentation", type: "select", required: true, options: [
        { value: "monophase", label: "Monophasé" }, { value: "triphase", label: "Triphasé" } ] },
      { key: "puissance_souscrite", label: "Puissance souscrite", type: "number", unit: "kVA", min: 0, max: 250 },
      { key: "tableau_etat", label: "État apparent du tableau", type: "select", required: true, options: [
        { value: "recent", label: "Récent" }, { value: "ancien", label: "Ancien" }, { value: "vetuste", label: "Vétuste" } ] },
      { key: "modules_libres", label: "Modules libres au tableau", type: "number", min: 0, max: 120, step: 1 },
      { key: "differentiel_30ma", label: "Différentiel 30 mA présent", type: "select", options: OUI_NON },
      { key: "terre", label: "Prise de terre présente", type: "select", options: OUI_NON },
      { key: "liaison_equipotentielle", label: "Liaison équipotentielle visible (salle d'eau)", type: "select", options: OUI_NON },
      { key: "travaux", label: "Travaux envisagés", type: "multiselect", options: [
        { value: "renovation_partielle", label: "Rénovation partielle" },
        { value: "renovation_complete", label: "Rénovation complète" },
        { value: "tableau", label: "Remplacement du tableau" },
        { value: "circuits", label: "Ajout de circuits" },
        { value: "irve", label: "Borne de recharge (IRVE)" } ] },
      { key: "circuits_a_creer", label: "Circuits à créer", type: "number", min: 0, max: 100, step: 1 },
      { key: "observations", label: "Observations électriques", type: "textarea", wide: true },
    ], [
      { key: "photo_tableau", label: "Tableau électrique", instruction: "Capot retiré si possible, protections lisibles.", category: "Électricité", required: true },
      { key: "photo_compteur", label: "Compteur / disjoncteur d'abonné", category: "Électricité" },
    ]),
  ],
  plomberie: [
    lotSection("releves", "Relevés plomberie", "Plomberie", [
      { key: "production_ecs", label: "Production d'eau chaude existante", type: "select", options: [
        { value: "cumulus", label: "Ballon électrique" }, { value: "chaudiere", label: "Chaudière" },
        { value: "thermodynamique", label: "Ballon thermodynamique" }, { value: "instantane", label: "Instantané" }, { value: "aucune", label: "Aucune" } ] },
      { key: "ecs_capacite", label: "Capacité du ballon", type: "number", unit: "L", min: 0, max: 5000, step: 1,
        visibleIf: [{ field: "production_ecs", in: ["cumulus", "thermodynamique"] }] },
      { key: "materiaux", label: "Matériaux de distribution", type: "multiselect", options: [
        { value: "cuivre", label: "Cuivre" }, { value: "per", label: "PER" }, { value: "multicouche", label: "Multicouche" },
        { value: "acier", label: "Acier galvanisé" }, { value: "plomb", label: "Plomb (à signaler)" } ] },
      { key: "compteur_accessible", label: "Compteur / vanne générale accessible", type: "select", required: true, options: OUI_NON },
      { key: "evacuations", label: "Évacuations", type: "select", options: [
        { value: "pvc", label: "PVC" }, { value: "fonte", label: "Fonte" }, { value: "mixte", label: "Mixte" } ] },
      { key: "assainissement", label: "Assainissement", type: "select", options: [
        { value: "collectif", label: "Tout-à-l'égout" }, { value: "individuel", label: "Assainissement individuel" } ] },
      { key: "appareils", label: "Appareils à poser / remplacer", type: "multiselect", options: [
        { value: "wc", label: "WC" }, { value: "lavabo", label: "Lavabo / vasque" }, { value: "douche", label: "Douche" },
        { value: "baignoire", label: "Baignoire" }, { value: "evier", label: "Évier" }, { value: "ballon", label: "Ballon d'eau chaude" } ] },
      { key: "fuites", label: "Fuites ou traces visibles", type: "select", options: OUI_NON },
      { key: "observations", label: "Observations plomberie", type: "textarea", wide: true },
    ], [
      { key: "photo_arrivee", label: "Arrivée d'eau / compteur", category: "Plomberie", required: true },
      { key: "photo_ecs", label: "Production d'eau chaude", category: "Plomberie" },
      { key: "photo_evacuations", label: "Évacuations", category: "Plomberie", multiple: true },
    ]),
  ],
  ventilation: [
    lotSection("releves", "Relevés ventilation", "Ventilation", [
      { key: "systeme", label: "Ventilation existante", type: "select", required: true, options: [
        { value: "aucune", label: "Aucune" }, { value: "naturelle", label: "Naturelle (grilles)" },
        { value: "simple_flux", label: "VMC simple flux" }, { value: "hygro", label: "VMC hygroréglable" }, { value: "double_flux", label: "VMC double flux" } ] },
      { key: "pieces_humides", label: "Pièces humides à extraire", type: "number", min: 0, max: 30, step: 1 },
      { key: "entrees_air", label: "Entrées d'air sur menuiseries", type: "select", options: OUI_NON },
      { key: "detalonnage", label: "Portes détalonnées", type: "select", options: OUI_NON },
      { key: "emplacement_caisson", label: "Emplacement du caisson possible", type: "select", options: [
        { value: "combles", label: "Combles" }, { value: "placard", label: "Placard / local technique" },
        { value: "faux_plafond", label: "Faux plafond" }, { value: "aucun", label: "Aucun identifié" } ] },
      { key: "passage_gaines", label: "Passage des gaines", type: "select", options: [
        { value: "facile", label: "Facile" }, { value: "contraint", label: "Contraint" }, { value: "impossible", label: "Impossible" } ] },
      { key: "rejet", label: "Rejet extérieur", type: "select", options: [
        { value: "toiture", label: "Sortie de toiture" }, { value: "facade", label: "Façade" }, { value: "existant", label: "Conduit existant" } ] },
      { key: "observations", label: "Observations ventilation", type: "textarea", wide: true },
    ], [
      { key: "photo_existant", label: "Caisson / bouches existants", category: "Ventilation", multiple: true },
      { key: "photo_emplacement", label: "Emplacement envisagé", category: "Ventilation" },
    ]),
  ],
  isolation_facade: [
    lotSection("releves", "Relevés isolation / façade", "Isolation", [
      { key: "ouvrages", label: "Ouvrages concernés", type: "multiselect", required: true, options: [
        { value: "ite", label: "Murs par l'extérieur (ITE)" }, { value: "iti", label: "Murs par l'intérieur (ITI)" },
        { value: "combles_perdus", label: "Combles perdus" }, { value: "rampants", label: "Rampants" }, { value: "plancher_bas", label: "Plancher bas" } ] },
      { key: "surface_murs", label: "Surface de murs relevée", type: "number", unit: "m²", min: 0, max: 100000, step: 0.1,
        visibleIf: [{ field: "ouvrages", in: ["ite", "iti"] }] },
      { key: "surface_combles", label: "Surface de combles / rampants relevée", type: "number", unit: "m²", min: 0, max: 100000, step: 0.1,
        visibleIf: [{ field: "ouvrages", in: ["combles_perdus", "rampants"] }] },
      { key: "surface_plancher", label: "Surface de plancher bas relevée", type: "number", unit: "m²", min: 0, max: 100000, step: 0.1,
        visibleIf: [{ field: "ouvrages", in: ["plancher_bas"] }] },
      { key: "isolant_existant", label: "Isolant existant", type: "select", options: [
        { value: "aucun", label: "Aucun" }, { value: "laine_minerale", label: "Laine minérale" },
        { value: "polystyrene", label: "Polystyrène" }, { value: "autre", label: "Autre" } ] },
      { key: "epaisseur_existante", label: "Épaisseur d'isolant existante", type: "number", unit: "cm", min: 0, max: 100, step: 0.5,
        visibleIf: [{ field: "isolant_existant", in: ["laine_minerale", "polystyrene", "autre"] }] },
      { key: "support", label: "Support de façade", type: "select", visibleIf: [{ field: "ouvrages", in: ["ite"] }], options: [
        { value: "enduit", label: "Enduit" }, { value: "brique", label: "Brique" }, { value: "pierre", label: "Pierre" },
        { value: "beton", label: "Béton" }, { value: "bardage", label: "Bardage" } ] },
      { key: "etat_support", label: "État du support", type: "select", options: ETAT },
      { key: "debord_toit", label: "Débord de toiture", type: "number", unit: "cm", min: 0, max: 300, step: 1, visibleIf: [{ field: "ouvrages", in: ["ite"] }] },
      { key: "menuiseries", label: "Menuiseries à traiter (nombre)", type: "number", min: 0, max: 500, step: 1 },
      { key: "observations", label: "Observations isolation / façade", type: "textarea", wide: true },
    ], [
      { key: "photo_facades", label: "Façades", instruction: "Une photo par façade concernée.", category: "Isolation / façade", multiple: true },
      { key: "photo_combles", label: "Combles / isolant existant", category: "Isolation / façade", multiple: true },
    ]),
  ],
  toiture: [
    lotSection("releves", "Relevés toiture", "Toiture", [
      { key: "couverture", label: "Type de couverture", type: "select", required: true, options: [
        { value: "tuile_terre", label: "Tuile terre cuite" }, { value: "tuile_beton", label: "Tuile béton" },
        { value: "ardoise", label: "Ardoise" }, { value: "bac_acier", label: "Bac acier" }, { value: "fibrociment", label: "Fibrociment" },
        { value: "terrasse", label: "Toit-terrasse / étanchéité" }, { value: "zinc", label: "Zinc" } ] },
      { key: "etat", label: "État apparent de la couverture", type: "select", required: true, options: ETAT },
      { key: "pente", label: "Pente relevée", type: "number", unit: "°", min: 0, max: 90, step: 1 },
      { key: "surface", label: "Surface relevée", type: "number", unit: "m²", min: 0, max: 100000, step: 0.1 },
      { key: "hauteur_egout", label: "Hauteur à l'égout", type: "number", unit: "m", min: 0, max: 100, step: 0.1 },
      { key: "charpente", label: "Charpente", type: "select", options: [
        { value: "traditionnelle", label: "Traditionnelle" }, { value: "fermettes", label: "Fermettes" },
        { value: "metallique", label: "Métallique" }, { value: "beton", label: "Béton" } ] },
      { key: "ecran_sous_toiture", label: "Écran sous toiture", type: "select", options: OUI_NON },
      { key: "zinguerie", label: "État de la zinguerie", type: "select", options: ETAT },
      { key: "infiltrations", label: "Traces d'infiltration", type: "select", options: OUI_NON },
      { key: "observations", label: "Observations toiture", type: "textarea", wide: true },
    ], [
      { key: "photo_couverture", label: "Couverture", category: "Toiture", required: true, multiple: true },
      { key: "photo_charpente", label: "Charpente / combles", category: "Toiture" },
    ]),
  ],
  renovation: [
    lotSection("releves", "Relevés rénovation / maçonnerie", "Rénovation", [
      { key: "nature", label: "Nature des travaux", type: "multiselect", required: true, options: [
        { value: "demolition", label: "Démolition" }, { value: "maconnerie", label: "Maçonnerie" },
        { value: "ouverture", label: "Création d'ouverture" }, { value: "cloisons", label: "Cloisons / doublages" },
        { value: "chape", label: "Chape / dalle" }, { value: "revetements", label: "Revêtements de sol" },
        { value: "menuiseries", label: "Menuiseries" }, { value: "peinture", label: "Peinture" } ] },
      { key: "mur_porteur", label: "Mur porteur concerné", type: "select", options: OUI_NON,
        help: "Toute intervention sur un mur porteur nécessite une étude structure : aucun dimensionnement n'est fait ici." },
      { key: "ouverture_largeur", label: "Largeur d'ouverture envisagée", type: "number", unit: "m", min: 0, max: 50, step: 0.01,
        visibleIf: [{ field: "nature", in: ["ouverture"] }] },
      { key: "fissures", label: "Fissures visibles", type: "select", options: [
        { value: "aucune", label: "Aucune" }, { value: "fines", label: "Fines (< 2 mm apparent)" }, { value: "importantes", label: "Importantes" } ] },
      { key: "planeite", label: "Planéité des sols", type: "select", options: [
        { value: "correcte", label: "Correcte" }, { value: "a_reprendre", label: "À reprendre" } ] },
      { key: "evacuation_gravats", label: "Évacuation des gravats", type: "select", options: [
        { value: "benne", label: "Benne sur site" }, { value: "big_bag", label: "Big bags" }, { value: "a_definir", label: "À définir" } ] },
      { key: "observations", label: "Observations rénovation", type: "textarea", wide: true },
    ], [
      { key: "photo_existant", label: "Existant à modifier", category: "Rénovation", required: true, multiple: true },
      { key: "photo_fissures", label: "Fissures / désordres", category: "Rénovation", multiple: true },
    ]),
  ],
};

const LEGACY_LOT_TEMPLATES: Partial<Record<VisitLot, VisitTemplate>> = {
  photovoltaique: PHOTOVOLTAIQUE_TEMPLATE,
  pac_air_air: PAC_AIR_AIR_TEMPLATE,
  pac_air_eau: PAC_AIR_EAU_TEMPLATE,
};

/** Sections de relevés d'un lot (avant préfixage). */
function rawLotSections(lot: VisitLot): VisitSection[] {
  const legacy = LEGACY_LOT_TEMPLATES[lot];
  if (legacy) return legacy.sections.filter((s) => s.kind !== "constraints" && s.kind !== "review");
  return NEW_LOT_SECTIONS[lot] ?? [];
}

const p = (lot: VisitLot, key: string) => `${lot}.${key}`;

function prefixConditions(lot: VisitLot, conds: VisibleIf[] | undefined): VisibleIf[] | undefined {
  return conds?.map((c) => ({ ...c, field: p(lot, c.field) }));
}

function withStatus(f: VisitField): VisitField {
  return f.type === "textarea" ? f : { ...f, allowStatus: true };
}

function prefixSection(lot: VisitLot, s: VisitSection): VisitSection {
  const meta = LOT_META[lot];
  return {
    ...s,
    key: p(lot, s.key),
    title: NEW_LOT_SECTIONS[lot] ? s.title : `${meta.label} — ${s.title}`,
    short: s.short,
    phase: "releves",
    lot,
    visibleIf: prefixConditions(lot, s.visibleIf),
    repeat: s.repeat ? { ...s.repeat, countField: p(lot, s.repeat.countField) } : undefined,
    fields: s.fields.map((f) => withStatus({ ...f, key: p(lot, f.key), visibleIf: prefixConditions(lot, f.visibleIf) })),
    photos: s.photos.map((ph) => ({
      ...ph,
      key: p(lot, ph.key),
      category: `${meta.label} · ${ph.category}`,
      visibleIf: prefixConditions(lot, ph.visibleIf),
    })),
  };
}

/** Champs de décision : jamais « Inconnu / N/A » (la conclusion doit être explicite). */
const NO_STATUS = new Set(["btp_conclusion", "btp_zones_count"]);

function commonWithStatus(s: VisitSection): VisitSection {
  return { ...s, fields: s.fields.map((f) => (NO_STATUS.has(f.key) ? f : withStatus(f))) };
}

/** Ordre canonique et dédoublonnage des lots. */
export function normalizeLots(lots: readonly string[] | null | undefined): VisitLot[] {
  const set = new Set(lots ?? []);
  return (Object.keys(LOT_META) as VisitLot[]).filter((l) => set.has(l));
}

/** Template composé d'une visite BTP pour les lots donnés. */
export function composeBtpTemplate(lotsInput: readonly string[] | null | undefined): VisitTemplate {
  const lots = normalizeLots(lotsInput);
  const lotSections = lots.flatMap((lot) => rawLotSections(lot).map((s) => prefixSection(lot, s)));
  const photoCategories = [
    "Site et accès",
    "Zones",
    ...lotSections.flatMap((s) => s.photos.map((ph) => ph.category)),
    "Points d'attention",
  ].filter((c, i, arr) => arr.indexOf(c) === i);
  const labels = lots.map((l) => LOT_META[l].label);
  return {
    type: "btp",
    label: labels.length ? `Visite BTP — ${labels.join(", ")}` : "Visite BTP multi-lots",
    chantierType: lots.length === 1 ? LOT_META[lots[0]].chantierType : "Travaux multi-lots",
    tagline: "Site, zones, relevés par lot, points d'attention et conclusion",
    lots,
    photoCategories,
    sections: [
      commonWithStatus(SITE),
      commonWithStatus(ZONES),
      ...lotSections,
      commonWithStatus(POINTS),
      commonWithStatus(DOCUMENTS),
      commonWithStatus(CONCLUSION),
      REVIEW,
    ],
  };
}

export const BTP_LOT_OPTIONS = (Object.keys(LOT_META) as VisitLot[]).map((value) => ({ value, ...LOT_META[value] }));
