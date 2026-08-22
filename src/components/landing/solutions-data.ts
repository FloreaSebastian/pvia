/**
 * Contenu des pages métier publiques.
 * Aucun chiffre inventé, aucune fonctionnalité qui n'existe pas dans PVIA :
 * seule la mise en situation change d'un métier à l'autre.
 */

export type Solution = {
  slug: string;
  label: string;
  title: string;
  intro: string;
  /** Situations concrètes du métier. */
  context: string[];
  /** Ce que PVIA apporte, formulé pour ce métier. */
  withPvia: { title: string; text: string }[];
  /** Exemples de réserves typiques du métier. */
  reserves: string[];
  seoTitle: string;
  seoDescription: string;
};

export const SOLUTIONS: Solution[] = [
  {
    slug: "photovoltaique",
    label: "Photovoltaïque",
    title: "Réception d'installation photovoltaïque",
    intro:
      "Entre la pose des modules, le raccordement et la mise en service, la réception se joue souvent sur des détails à photographier et à faire valider.",
    context: [
      "Photos de toiture, de calepinage et de câblage à conserver après le démontage des échafaudages.",
      "Réception client à faire signer sur place, souvent le jour de la mise en service.",
      "Points de reprise repérés en fin de chantier : étanchéité, fixations, repérage électrique.",
      "Documents à retrouver plusieurs mois plus tard en cas de question du client.",
    ],
    withPvia: [
      {
        title: "Toutes les photos rattachées à l'installation",
        text: "Les photos prises sur le toit ou au coffret restent liées au chantier et au procès-verbal, pas dispersées dans une galerie.",
      },
      {
        title: "Signature le jour de la mise en service",
        text: "Le PV est complété sur place et signé par le client sur votre appareil, avec le PDF envoyé dans la foulée.",
      },
      {
        title: "Réserves suivies jusqu'à la reprise",
        text: "Chaque point de reprise reçoit une gravité, un responsable et une photo après correction.",
      },
    ],
    reserves: [
      "Étanchéité au niveau d'une fixation",
      "Repérage manquant sur le coffret DC",
      "Cheminement de câble à reprendre",
      "Nettoyage de fin de chantier",
    ],
    seoTitle: "Logiciel de réception photovoltaïque — PV et réserves | PVIA",
    seoDescription:
      "PVIA structure la réception de vos installations photovoltaïques : photos, PV signé sur place, réserves suivies jusqu'à la levée et espace client.",
  },
  {
    slug: "climatisation",
    label: "Climatisation & PAC",
    title: "Réception de climatisation et de pompe à chaleur",
    intro:
      "Une installation de climatisation ou de PAC se réceptionne unité par unité, avec une mise en service à documenter et un client à rassurer.",
    context: [
      "Plusieurs unités intérieures à contrôler dans des pièces différentes.",
      "Mise en service, mise en route et explications au client le même jour.",
      "Petites reprises fréquentes : habillage, condensats, fixation, finition.",
      "Le client rappelle quelques semaines après pour un point déjà traité.",
    ],
    withPvia: [
      {
        title: "Une réception détaillée, unité par unité",
        text: "Photos et commentaires sont ajoutés au fil de la visite, dans l'ordre du passage.",
      },
      {
        title: "Le client signe et repart avec le PDF",
        text: "Le procès-verbal signé est envoyé au client et reste disponible dans son espace.",
      },
      {
        title: "Les reprises ne se perdent plus",
        text: "Chaque réserve reste ouverte tant qu'elle n'est pas levée puis validée par le client.",
      },
    ],
    reserves: [
      "Évacuation des condensats à reprendre",
      "Habillage de liaison frigorifique",
      "Fixation d'unité extérieure",
      "Télécommande / paramétrage à finaliser",
    ],
    seoTitle: "Logiciel de réception climatisation et PAC — PVIA",
    seoDescription:
      "PVIA vous aide à réceptionner vos installations de climatisation et de pompe à chaleur : photos, PV signé, réserves suivies et espace client.",
  },
  {
    slug: "electricite",
    label: "Électricité",
    title: "Réception de travaux électriques",
    intro:
      "Tableaux, circuits, appareillages : la réception électrique repose sur des vérifications nombreuses et des reprises à tracer.",
    context: [
      "Contrôles à consigner pièce par pièce et circuit par circuit.",
      "Photos de tableau utiles longtemps après la fin du chantier.",
      "Reprises transmises oralement puis oubliées.",
      "Réception à faire signer alors que tout le monde est pressé de partir.",
    ],
    withPvia: [
      {
        title: "Un PV qui suit votre méthode",
        text: "Vous consignez les points contrôlés et joignez les photos au fur et à mesure.",
      },
      {
        title: "Chaque reprise a un responsable",
        text: "Une réserve électrique est assignée, photographiée, corrigée puis validée.",
      },
      {
        title: "Un dossier retrouvable",
        text: "Le chantier conserve son historique complet : PV, réserves, photos et documents.",
      },
    ],
    reserves: [
      "Repérage de circuit manquant au tableau",
      "Appareillage à remplacer",
      "Prise non alimentée",
      "Serrage / finition de goulotte",
    ],
    seoTitle: "Logiciel de réception de travaux électriques — PVIA",
    seoDescription:
      "PVIA structure vos réceptions électriques : contrôles consignés, photos de tableau, réserves suivies jusqu'à la levée et PV signé sur place.",
  },
  {
    slug: "plomberie",
    label: "Plomberie",
    title: "Réception de travaux de plomberie",
    intro:
      "Équipements posés, essais réalisés, finitions à reprendre : la réception plomberie se joue sur des points précis, souvent invisibles quelques jours plus tard.",
    context: [
      "Contrôles d'étanchéité et de bon fonctionnement à documenter.",
      "Photos avant fermeture des trappes et des coffrages.",
      "Petites finitions repoussées en fin de chantier.",
      "Le client demande une preuve de ce qui a été fait.",
    ],
    withPvia: [
      {
        title: "Les photos prises au bon moment",
        text: "Ce qui sera caché derrière un coffrage reste documenté dans le chantier.",
      },
      {
        title: "Les finitions restent visibles",
        text: "Une réserve reste ouverte jusqu'à la reprise et la validation client.",
      },
      {
        title: "Une réception nette",
        text: "Le PV est signé sur place et le client reçoit son PDF sans relance.",
      },
    ],
    reserves: [
      "Fuite au niveau d'un raccord",
      "Joint de finition à reprendre",
      "Robinetterie à régler",
      "Évacuation à ajuster",
    ],
    seoTitle: "Logiciel de réception plomberie — PV et réserves | PVIA",
    seoDescription:
      "PVIA structure vos réceptions de plomberie : photos avant fermeture, réserves suivies jusqu'à la levée, PV signé et espace client.",
  },
  {
    slug: "renovation",
    label: "Rénovation",
    title: "Réception de chantier de rénovation",
    intro:
      "Une rénovation, c'est plusieurs lots, plusieurs intervenants et une réception qui doit dire clairement qui reprend quoi.",
    context: [
      "Plusieurs corps d'état sur le même chantier.",
      "Réserves nombreuses et dispersées entre les lots.",
      "Suivi par messages, difficile à consolider.",
      "Réception finale qui traîne faute de vue claire sur ce qui reste.",
    ],
    withPvia: [
      {
        title: "Toutes les réserves au même endroit",
        text: "Vous voyez d'un coup d'œil ce qui reste ouvert, par gravité et par responsable.",
      },
      {
        title: "Une levée documentée",
        text: "Photo avant, photo après, date de levée : la reprise est prouvée.",
      },
      {
        title: "Un client tenu informé",
        text: "Le client suit l'avancement depuis son espace et valide les levées.",
      },
    ],
    reserves: [
      "Reprise de peinture",
      "Plinthe manquante",
      "Menuiserie à régler",
      "Nettoyage de fin de chantier",
    ],
    seoTitle: "Logiciel de réception de chantier de rénovation — PVIA",
    seoDescription:
      "PVIA centralise la réception de vos chantiers de rénovation : réserves par lot, responsables, photos avant/après et validation client.",
  },
  {
    slug: "construction",
    label: "Construction",
    title: "Réception de chantier de construction",
    intro:
      "Sur une opération de construction, la réception génère beaucoup de réserves et mobilise plusieurs équipes jusqu'à la levée complète.",
    context: [
      "Visites de réception longues, avec de nombreux points relevés.",
      "Réserves à répartir entre les équipes et les entreprises.",
      "Levées échelonnées dans le temps.",
      "Besoin de garder une trace précise de chaque étape.",
    ],
    withPvia: [
      {
        title: "Une visite de réception structurée",
        text: "Les réserves sont créées sur place, avec photo et gravité, sans reprise au bureau.",
      },
      {
        title: "Des équipes alignées",
        text: "Chaque réserve est assignée à un responsable, avec son état visible par tous.",
      },
      {
        title: "Un historique complet",
        text: "Création, signature, levée, validation : tout reste consultable et exportable.",
      },
    ],
    reserves: [
      "Reprise d'enduit",
      "Porte à régler",
      "Défaut de finition en façade",
      "Équipement manquant en partie commune",
    ],
    seoTitle: "Logiciel de réception de chantier de construction — PVIA",
    seoDescription:
      "PVIA structure vos réceptions de construction : réserves nombreuses, responsables, levées échelonnées, signature et historique complet.",
  },
];

export function getSolution(slug: string): Solution | undefined {
  return SOLUTIONS.find((s) => s.slug === slug);
}
