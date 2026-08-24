/**
 * Contenu éditorial des pages Solutions PVIA.
 *
 * Règles :
 * - aucune fonctionnalité inexistante, aucun chiffre inventé ;
 * - le vocabulaire reprend celui de l'application (chantier, PV, réserve,
 *   levée, validation, espace client, historique).
 */
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  Filter,
  History,
  Layers,
  ListChecks,
  Lock,
  Mail,
  MapPin,
  PenLine,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";

export type VisualKey =
  | "dashboard"
  | "phone"
  | "reserve"
  | "signature"
  | "clientspace"
  | "calendar"
  | "stats"
  | "chantier"
  | "team"
  | "history";

export type SolutionContent = {
  slug: string;
  navLabel: string;
  navDesc: string;
  navIcon: LucideIcon;
  navGroup: "Préparer" | "Réception" | "Terrain" | "Collaboration" | "Pilotage";
  eyebrow: string;
  h1: string;
  subtitle: string;
  heroBullets: string[];
  heroVisual: VisualKey;
  problem: { items: string[]; transition: string };
  answer: { title: string; text: string; points: string[]; visual: VisualKey };
  flow: { title: string; description: string; steps: string[] };
  features: { title: string; description: string; items: { icon: LucideIcon; title: string; text: string }[] };
  outcomes: { title: string; items: { title: string; text: string }[] };
  scenario: { title: string; intro: string; steps: { when: string; text: string }[] };
  compare?: boolean;
  /** Restriction commerciale : la solution n'est pas incluse dans toutes les formules. */
  plan?: { badge: string; title: string; text: string; bullets: string[] };
  related: string[];
  ctaTitle: string;
  seoTitle: string;
  seoDescription: string;
};

export const SOLUTION_PAGES: SolutionContent[] = [
  {
    slug: "visite-technique",
    navLabel: "Visite technique",
    navDesc: "Le relevé avant travaux, avant le devis et la pose",
    navIcon: ClipboardCheck,
    navGroup: "Préparer",
    plan: {
      badge: "Pro",
      title: "La Visite technique est disponible à partir de la formule Pro",
      text: "Elle n'est pas incluse dans la formule Essentiel. Les formules Pro, Business et Entreprise y donnent accès, et l'essai gratuit de 14 jours permet de la tester avant de choisir.",
      bullets: [
        "Essentiel : réception, réserves, signature sur site et PDF.",
        "Pro, Business, Entreprise : visites techniques photovoltaïque, PAC air/air et PAC air/eau incluses.",
        "Le passage d'une formule à l'autre se fait depuis l'espace Abonnement, sans perdre les visites déjà réalisées.",
      ],
    },
    eyebrow: "PVIA · Visite technique · À partir de Pro",
    h1: "La visite technique avant travaux, structurée comme une vraie étude terrain.",
    subtitle:
      "Avant de chiffrer et avant de poser, la visite technique fixe ce qui a été vu sur place : configuration, contraintes, photos repérées et points de vigilance. Le relevé est rattaché au chantier dès sa création, donc il reste disponible jusqu'à la réception.",
    heroBullets: [
      "Inclus à partir de Pro",
      "Photovoltaïque",
      "PAC air/air",
      "PAC air/eau",
      "Mode terrain",
      "Contraintes",
    ],
    heroVisual: "chantier",
    problem: {
      items: [
        "Le relevé se fait sur un carnet ou dans les notes du téléphone, puis se perd avant le chiffrage.",
        "Chaque technicien relève ce qu'il pense important : deux visites du même type ne contiennent pas les mêmes informations.",
        "Les photos de toiture, de tableau électrique ou d'emplacement de groupe restent sur le téléphone.",
        "Une contrainte vue sur place (accès, distance de liaison, nature de couverture) ressort en cours de pose.",
        "Le jour de la réception, personne ne retrouve ce qui avait été constaté avant travaux.",
      ],
      transition:
        "PVIA transforme la visite technique en étape complète du dossier : un questionnaire adapté au type d'installation, des photos attendues et des contraintes consignées, rattachés au chantier.",
    },
    answer: {
      title: "Un questionnaire par type d'installation, pas un formulaire générique",
      text: "Vous choisissez le type de visite : photovoltaïque, PAC air/air ou PAC air/eau. PVIA affiche alors les sections correspondantes, et masque les questions qui ne s'appliquent pas à la configuration relevée.",
      points: [
        "Photovoltaïque : bâtiment et toiture, pans, accès et sécurité, tableau électrique, cheminements, segments, contraintes.",
        "PAC air/air : configuration, pièces à traiter, emplacement du groupe extérieur, liaisons, électricité, contraintes.",
        "PAC air/eau : installation existante, émetteurs, logement, emplacement, hydraulique, eau chaude sanitaire, électricité, contraintes.",
        "Les questions dépendantes n'apparaissent que si elles ont un sens : le relevé reste court sur le terrain.",
      ],
      visual: "phone",
    },
    flow: {
      title: "Le déroulé d'une visite technique dans PVIA",
      description:
        "La visite est créée depuis le bureau ou depuis le terrain, puis exécutée sur mobile et clôturée par une validation.",
      steps: [
        "Créer la visite",
        "Choisir le type",
        "Rattacher le chantier",
        "Relever sur place",
        "Photos repérées",
        "Consigner les contraintes",
        "Terminer",
        "Valider",
      ],
    },
    features: {
      title: "Ce que couvre la visite technique",
      description:
        "Les fonctionnalités réellement disponibles dans le module Visites techniques de PVIA.",
      items: [
        {
          icon: ClipboardCheck,
          title: "Trois types de visites",
          text: "Photovoltaïque, PAC air/air et PAC air/eau, chacun avec ses sections et ses questions propres.",
        },
        {
          icon: Smartphone,
          title: "Mode terrain dédié",
          text: "Un parcours en étapes, pensé pour être rempli debout sur un chantier, avec la progression visible.",
        },
        {
          icon: Camera,
          title: "Photos attendues",
          text: "Les prises de vue à réaliser sont listées. Une photo peut être marquée comme impossible, avec sa raison.",
        },
        {
          icon: MapPin,
          title: "Repérage et compression",
          text: "Les photos sont compressées avant envoi et conservent les informations de prise de vue quand elles sont disponibles.",
        },
        {
          icon: ShieldCheck,
          title: "Contraintes techniques",
          text: "Chaque point bloquant ou à surveiller est consigné avec sa nature, pour être vu avant l'intervention.",
        },
        {
          icon: Building2,
          title: "Rattachement au chantier",
          text: "La visite est reliée au chantier dès sa création, et reste consultable dans son dossier.",
        },
        {
          icon: CheckCircle2,
          title: "Statuts et validation",
          text: "En cours, terminée puis validée : une visite validée n'est plus modifiable et sert de référence.",
        },
        {
          icon: Users,
          title: "Attribution",
          text: "La visite est affectée à un membre de l'équipe, qui la retrouve dans sa liste de visites.",
        },
      ],
    },
    outcomes: {
      title: "Ce que l'entreprise y gagne",
      items: [
        {
          title: "Des chiffrages appuyés sur du réel",
          text: "Le devis part d'un relevé structuré, pas d'un souvenir de visite.",
        },
        {
          title: "Moins de mauvaises surprises à la pose",
          text: "Les contraintes d'accès, d'électricité ou de liaison sont connues avant l'intervention.",
        },
        {
          title: "Des relevés homogènes",
          text: "Deux techniciens différents produisent la même qualité d'information sur le même type d'installation.",
        },
        {
          title: "Une continuité jusqu'à la réception",
          text: "La visite reste dans le dossier du chantier, à côté des interventions, du PV et des réserves.",
        },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro:
        "Une demande d'installation photovoltaïque sur une maison individuelle, avec une visite technique avant chiffrage.",
      steps: [
        {
          when: "Au bureau",
          text: "Le conducteur crée la visite technique pour le client, choisit le type photovoltaïque et l'affecte au technicien. Le chantier est créé ou rattaché à cette occasion.",
        },
        {
          when: "Sur place",
          text: "Le technicien ouvre le mode terrain et déroule les sections : toiture, pans, accès, tableau électrique, cheminements.",
        },
        {
          when: "Pendant le relevé",
          text: "Il prend les photos attendues. Le local technique n'est pas accessible : la photo est marquée comme impossible avec sa raison.",
        },
        {
          when: "Avant de partir",
          text: "Il consigne deux contraintes : accès nacelle nécessaire et tableau à mettre à niveau.",
        },
        {
          when: "Retour au bureau",
          text: "Le conducteur relit la visite, la marque terminée puis la valide. Elle devient la référence du dossier.",
        },
        {
          when: "Plus tard",
          text: "Le jour de la réception, la visite technique reste consultable dans le dossier du chantier, à côté du PV et des réserves.",
        },
      ],
    },
    related: ["chantiers", "terrain", "pv-reception"],
    ctaTitle: "Préparez vos poses à partir de ce qui a réellement été vu sur place.",
    seoTitle: "Visite technique PV et PAC — relevé avant travaux | PVIA",
    seoDescription:
      "Réalisez vos visites techniques photovoltaïque, PAC air/air et PAC air/eau dans PVIA : questionnaire par type d'installation, photos attendues, contraintes techniques et rattachement au chantier. Inclus à partir de la formule Pro.",
  },
  {
    slug: "pv-reception",
    navLabel: "PV de réception",
    navDesc: "Du premier constat au document signé",
    navIcon: FileText,
    navGroup: "Réception",
    eyebrow: "PVIA · PV de réception",
    h1: "Des réceptions de travaux structurées, signées et traçables.",
    subtitle:
      "Le procès-verbal se remplit pendant la visite, se signe sur place et repart au client avec ses photos, ses réserves et son historique. Une information saisie une fois, disponible partout où elle est utile.",
    heroBullets: ["Création guidée", "Photos et réserves", "Signature", "PDF", "Historique"],
    heroVisual: "dashboard",
    problem: {
      items: [
        "Le PV est repris dans un document Word, différent selon la personne qui le rédige.",
        "Les photos restent dans la galerie du téléphone du technicien.",
        "Les points à reprendre sont annoncés oralement puis oubliés.",
        "La signature arrive plusieurs jours après, parfois jamais.",
        "Le PDF est envoyé tardivement, sans lien avec la suite du dossier.",
      ],
      transition:
        "PVIA rassemble le processus : le document final est généré à partir des informations déjà collectées pendant la réception.",
    },
    answer: {
      title: "Une réception claire, du premier constat au document signé",
      text: "Vous partez du chantier existant : client, adresse et référence sont déjà là. Vous complétez la réception au fur et à mesure de la visite, puis vous faites signer.",
      points: [
        "Le PV reprend le chantier, le client et la numérotation de l'entreprise.",
        "Observations, réserves et photos sont saisies dans l'ordre du passage.",
        "Le statut du PV indique où en est la réception, sans avoir à demander.",
      ],
      visual: "signature",
    },
    flow: {
      title: "Le déroulé d'une réception dans PVIA",
      description: "Chaque étape alimente la suivante. Rien n'est ressaisi au bureau.",
      steps: [
        "Préparer le PV",
        "Réception terrain",
        "Ajouter les réserves",
        "Faire signer",
        "Générer le PDF",
        "Envoyer",
        "Archiver",
      ],
    },
    features: {
      title: "Ce que couvre le PV de réception",
      description: "Les fonctionnalités réellement utilisées pendant une visite de réception.",
      items: [
        { icon: ClipboardList, title: "Création guidée", text: "Le PV se construit étape par étape : entreprise, client, chantier, contenu de la réception." },
        { icon: Building2, title: "Informations chantier et client", text: "Reprises du dossier existant, elles restent cohérentes d'un document à l'autre." },
        { icon: Camera, title: "Photos rattachées", text: "Les photos prises pendant la visite restent liées au bon chantier et au bon PV." },
        { icon: ListChecks, title: "Observations et réserves", text: "Chaque point relevé devient une réserve avec sa gravité et son responsable." },
        { icon: PenLine, title: "Signature", text: "Le client signe sur votre appareil, ou à distance par un lien sécurisé selon la formule." },
        { icon: FileText, title: "PDF et envoi", text: "Le document est généré à partir du PV puis envoyé au client et déposé dans son espace." },
      ],
    },
    outcomes: {
      title: "Ce que l'entreprise y gagne",
      items: [
        { title: "Moins d'oublis", text: "Le déroulé guidé évite les rubriques laissées vides et les réserves non consignées." },
        { title: "Des documents homogènes", text: "Tous les PV de l'entreprise ont la même structure, quel que soit le technicien." },
        { title: "Une réception plus rapide", text: "Le PV est terminé quand vous quittez le chantier, pas le lendemain soir." },
        { title: "Une meilleure traçabilité", text: "Photos, réserves, signature et envois restent attachés au dossier." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Réception d'une installation en toiture, chantier suivi par un conducteur de travaux et un technicien.",
      steps: [
        { when: "9h10", text: "Le technicien ouvre le chantier dans PVIA et démarre le PV de réception." },
        { when: "9h35", text: "Six photos et deux réserves sont ajoutées pendant le tour de l'installation." },
        { when: "10h05", text: "Le client signe sur la tablette ; le PV passe au statut signé." },
        { when: "10h06", text: "Le PDF est généré et envoyé, puis déposé dans l'espace client." },
        { when: "Plus tard", text: "Les deux réserves restent ouvertes jusqu'à leur levée puis leur validation." },
      ],
    },
    compare: true,
    related: ["reserves", "signature-pdf", "visite-technique"],
    ctaTitle: "Votre prochaine réception peut déjà être plus simple.",
    seoTitle: "Logiciel de PV de réception de travaux — PVIA",
    seoDescription:
      "Créez vos procès-verbaux de réception de travaux sur le chantier : photos, réserves, signature du client, PDF généré et historique complet. PVIA structure toute la réception.",
  },

  {
    slug: "reserves",
    navLabel: "Réserves & levées",
    navDesc: "De l'ouverture à la validation client",
    navIcon: ListChecks,
    navGroup: "Réception",
    eyebrow: "PVIA · Réserves",
    h1: "Une réserve ne doit jamais se perdre entre un appel, un SMS et une photo.",
    subtitle:
      "Chaque réserve garde son contexte : le chantier, le client, la gravité, les photos avant et après, la date d'ouverture et la personne qui doit intervenir — jusqu'à sa validation.",
    heroBullets: ["Gravité", "Responsable", "Photos avant / après", "Levée", "Validation"],
    heroVisual: "reserve",
    problem: {
      items: [
        "Les réserves sont notées sur un carnet, un SMS ou un message vocal.",
        "Personne ne sait précisément ce qui reste ouvert sur un chantier.",
        "La reprise est faite mais rien ne le prouve.",
        "Le client relance sur un point déjà traité.",
      ],
      transition:
        "PVIA conserve chaque réserve avec son contexte jusqu'au moment où le client la valide.",
    },
    answer: {
      title: "Trois états simples, compris par tout le monde",
      text: "Une réserve est ouverte tant que rien n'a été fait, levée quand la reprise est réalisée et documentée, validée quand le client confirme. Aucun autre statut à interpréter.",
      points: [
        "Ouverte : le point est constaté, décrit, photographié et assigné.",
        "Levée : la reprise est faite, avec une photo après et une date de levée.",
        "Validée : le client confirme la levée depuis son espace, ou la refuse en expliquant pourquoi.",
      ],
      visual: "reserve",
    },
    flow: {
      title: "Le cycle complet d'une réserve",
      description: "Le même déroulé pour une reprise de peinture ou pour un point bloquant.",
      steps: ["Réserve ouverte", "Intervention", "Photo après", "Levée", "Validation client"],
    },
    features: {
      title: "Tout ce qui accompagne une réserve",
      description: "Assez d'informations pour agir, sans transformer le suivi en administratif.",
      items: [
        { icon: ListChecks, title: "Description et localisation", text: "Le point est décrit là où il est constaté, sur le bon chantier." },
        { icon: Layers, title: "Trois niveaux de gravité", text: "Mineure, majeure ou bloquante : la priorité est lisible immédiatement." },
        { icon: Camera, title: "Photos avant et après", text: "La preuve de la reprise fait partie de la réserve, pas d'un fil de discussion." },
        { icon: Users, title: "Responsable identifié", text: "Chaque réserve est assignée à un membre de l'équipe." },
        { icon: Filter, title: "Vue d'ensemble filtrable", text: "Vous voyez ce qui reste ouvert par chantier, par client, par gravité et depuis quand." },
        { icon: CheckCircle2, title: "Levée et validation", text: "La levée est soumise au client, qui la valide ou la refuse avec un motif." },
      ],
    },
    outcomes: {
      title: "Ce que ça change au quotidien",
      items: [
        { title: "Plus de réserve oubliée", text: "Une réserve reste visible tant qu'elle n'est pas validée." },
        { title: "Des priorités claires", text: "La gravité permet de traiter d'abord ce qui bloque la clôture du chantier." },
        { title: "Des reprises prouvées", text: "Photo avant, photo après, date : la levée est documentée." },
        { title: "Moins de discussions", text: "Le client valide depuis son espace ; l'échange est tracé." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Deux réserves relevées lors d'une réception, traitées à deux semaines d'intervalle.",
      steps: [
        { when: "Jour 1", text: "Réserve majeure « évacuation à reprendre » ouverte avec photo, assignée à l'équipe plomberie." },
        { when: "Jour 9", text: "L'intervention est réalisée, la photo après est ajoutée et la réserve passe en levée." },
        { when: "Jour 10", text: "Le client reçoit la levée, la consulte et la valide depuis son espace." },
        { when: "Ensuite", text: "Le chantier n'a plus de réserve bloquante ; l'historique conserve chaque étape." },
      ],
    },
    compare: false,
    related: ["pv-reception", "espace-client", "suivi-pilotage"],
    ctaTitle: "Reprenez la main sur ce qui reste à faire.",
    seoTitle: "Gestion des réserves de chantier et levées de réserves — PVIA",
    seoDescription:
      "Suivez vos réserves de chantier de l'ouverture à la validation : gravité, responsable, photos avant/après, levée et validation par le client. PVIA garde le contexte de chaque réserve.",
  },

  {
    slug: "terrain",
    navLabel: "Mode terrain",
    navDesc: "PVIA sur le chantier, depuis le téléphone",
    navIcon: Smartphone,
    navGroup: "Terrain",
    eyebrow: "PVIA · Mode terrain",
    h1: "La réception se fait sur le chantier. PVIA aussi.",
    subtitle:
      "Photos, réserves, réception et signature depuis un téléphone tenu d'une main, avec des cibles tactiles pensées pour des conditions de chantier. Le terrain avance, le dossier aussi.",
    heroBullets: ["Photos depuis le téléphone", "Réserves rapides", "Signature sur place", "Brouillons"],
    heroVisual: "phone",
    problem: {
      items: [
        "Les constats sont notés sur papier puis ressaisis au bureau.",
        "Les photos sont envoyées par messagerie, sans lien avec le chantier.",
        "Le technicien attend d'être rentré pour créer le document.",
        "Entre le chantier et le bureau, une partie de l'information disparaît.",
      ],
      transition: "PVIA se remplit là où le travail est réalisé, pas le soir au bureau.",
    },
    answer: {
      title: "Le dossier se construit directement sur place",
      text: "L'application est conçue pour être utilisée debout, sur un chantier, avec une seule main. Les écrans essentiels restent accessibles sans scroll horizontal, même sur un petit écran.",
      points: [
        "Prise de photo depuis l'application, rattachée au chantier en cours.",
        "Création d'une réserve en quelques appuis, avec sa gravité.",
        "Signature du client directement sur l'écran de l'appareil.",
      ],
      visual: "phone",
    },
    flow: {
      title: "Une intervention, six étapes",
      description: "Le même déroulé du premier passage jusqu'au retour au bureau.",
      steps: [
        "Ouvrir le chantier",
        "Ajouter les photos",
        "Créer les réserves",
        "Compléter la réception",
        "Faire signer",
        "Retrouver le dossier au bureau",
      ],
    },
    features: {
      title: "Pensé pour les conditions de chantier",
      description: "Ce qui compte sur le terrain : rapidité, lisibilité, rien à ressaisir.",
      items: [
        { icon: Camera, title: "Capture photo intégrée", text: "Les photos sont compressées puis rattachées au chantier et au document en cours." },
        { icon: ListChecks, title: "Réserves rapides", text: "Description, gravité, photo : la réserve est créée sans quitter la visite." },
        { icon: PenLine, title: "Signature terrain", text: "Le client signe sur l'écran, la réception est close sur place." },
        { icon: MapPin, title: "Repère de lieu", text: "Les informations d'adresse du chantier accompagnent la visite." },
        { icon: ClipboardList, title: "Brouillons", text: "Une réception commencée peut être reprise plus tard, sans repartir de zéro." },
        { icon: Smartphone, title: "Interface mobile native", text: "Navigation par le bas, grandes zones tactiles, contenus lisibles en extérieur." },
      ],
    },
    outcomes: {
      title: "Ce que ça change pour vos équipes",
      items: [
        { title: "Moins de ressaisie", text: "Ce qui est saisi sur le chantier n'a pas à être recopié au bureau." },
        { title: "Moins d'informations perdues", text: "Les photos et les constats restent attachés au bon dossier." },
        { title: "Des visites plus courtes", text: "Le document est terminé au moment où le technicien quitte le chantier." },
        { title: "Un bureau qui suit en direct", text: "Les éléments enregistrés sont visibles côté bureau sans transfert manuel." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Un technicien seul, deux interventions dans la même journée.",
      steps: [
        { when: "Matin", text: "Il ouvre le chantier, ajoute quatre photos et laisse la réception en brouillon." },
        { when: "Midi", text: "Le conducteur de travaux consulte les photos depuis le bureau." },
        { when: "Après-midi", text: "Le technicien complète la réception et fait signer le client sur son téléphone." },
        { when: "Le soir", text: "Rien à ressaisir : le dossier est déjà complet." },
      ],
    },
    compare: true,
    related: ["pv-reception", "visite-technique", "chantiers"],
    ctaTitle: "Faites entrer PVIA sur vos chantiers.",
    seoTitle: "Application de réception de chantier sur mobile — Mode terrain PVIA",
    seoDescription:
      "Utilisez PVIA directement sur le chantier : photos depuis le téléphone, réserves rapides, réception et signature sur place. Moins de ressaisie au bureau, moins d'informations perdues.",
  },

  {
    slug: "signature-pdf",
    navLabel: "Signature & documents",
    navDesc: "Du geste de signature au PDF envoyé",
    navIcon: PenLine,
    navGroup: "Réception",
    eyebrow: "PVIA · Signature & documents",
    h1: "De la signature au PDF final, sans reconstruire le dossier à la main.",
    subtitle:
      "Le document final est généré à partir des informations déjà collectées : contenu du PV, réserves, photos et signature. Il part au client et reste disponible dans le dossier.",
    heroBullets: ["Signature sur place", "Signature à distance", "PDF généré", "Envoi", "Historique"],
    heroVisual: "signature",
    problem: {
      items: [
        "Le document est remis en forme après coup, à partir de notes éparses.",
        "La signature papier est scannée, puis rangée quelque part.",
        "Le PDF envoyé ne correspond plus tout à fait à la réalité du chantier.",
        "Retrouver la bonne version demande de fouiller dans les emails.",
      ],
      transition: "PVIA génère le document à partir du PV lui-même : il n'y a rien à reconstituer.",
    },
    answer: {
      title: "Une seule source d'information, un seul document final",
      text: "Ce qui a été saisi pendant la réception compose le PDF. La signature y est intégrée, l'envoi est enregistré et le document reste accessible dans le chantier comme dans l'espace client.",
      points: [
        "Signature sur l'appareil de l'entreprise pendant la réception.",
        "Signature à distance par lien sécurisé avec vérification, selon la formule.",
        "PDF généré, envoyé par email et conservé dans le dossier.",
      ],
      visual: "signature",
    },
    flow: {
      title: "Ce qui se passe après la signature",
      description: "Une suite d'actions automatique, tracée de bout en bout.",
      steps: ["Signature", "PDF généré", "Email envoyé", "Document disponible", "Historique"],
    },
    features: {
      title: "Signature et documents",
      description: "Le nécessaire pour clore proprement une réception.",
      items: [
        { icon: PenLine, title: "Signature sur place", text: "Le client signe sur votre écran, à la fin de la visite." },
        { icon: Mail, title: "Signature à distance", text: "Un lien sécurisé permet une signature hors site lorsque la formule le prévoit." },
        { icon: FileText, title: "PDF généré", text: "Le document reprend le PV, ses réserves et ses photos, dans une mise en forme homogène." },
        { icon: Download, title: "Téléchargement", text: "Le PDF peut être téléchargé par l'entreprise comme par le client." },
        { icon: ShieldCheck, title: "Traces de signature", text: "Date, horodatage et éléments techniques de la signature sont conservés." },
        { icon: History, title: "Historique du document", text: "Génération, envoi et consultation apparaissent dans l'historique du dossier." },
      ],
    },
    outcomes: {
      title: "Ce que ça change",
      items: [
        { title: "Moins de mise en forme", text: "Aucun document à recomposer après la visite." },
        { title: "Des envois tracés", text: "Vous savez ce qui a été envoyé, à qui et quand." },
        { title: "Une version unique", text: "Le document du dossier est celui que le client possède." },
        { title: "Une clôture nette", text: "La réception se termine par un document signé, pas par une relance." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Le client ne peut pas être présent le jour de la réception.",
      steps: [
        { when: "Sur place", text: "La réception est réalisée et le PV complété avec ses photos et ses réserves." },
        { when: "Le soir", text: "Un lien de signature sécurisé est envoyé au client." },
        { when: "Le lendemain", text: "Le client signe ; le PDF est généré et envoyé automatiquement." },
        { when: "Ensuite", text: "Le document reste disponible dans le chantier et dans l'espace client." },
      ],
    },
    compare: false,
    related: ["pv-reception", "espace-client", "suivi-pilotage"],
    ctaTitle: "Terminez vos réceptions par un document signé.",
    seoTitle: "Signature de PV de réception et génération de PDF — PVIA",
    seoDescription:
      "Faites signer vos procès-verbaux sur place ou à distance, générez le PDF automatiquement et envoyez-le au client. Chaque envoi et chaque signature restent tracés dans PVIA.",
  },

  {
    slug: "espace-client",
    navLabel: "Espace client",
    navDesc: "Vos clients suivent leurs documents",
    navIcon: Lock,
    navGroup: "Collaboration",
    eyebrow: "PVIA · Espace client",
    h1: "Vos clients suivent aussi leurs documents.",
    subtitle:
      "Un espace dédié, séparé de votre espace interne. Le client retrouve ses procès-verbaux, ses PDF et ses levées de réserves, sans jamais accéder à l'organisation de votre entreprise.",
    heroBullets: ["Accès séparé", "Documents", "Signature", "Validation des levées", "Historique"],
    heroVisual: "clientspace",
    problem: {
      items: [
        "Le client rappelle pour demander un document déjà envoyé.",
        "Les PDF circulent en pièces jointes, dans plusieurs versions.",
        "Personne ne sait si le client a bien reçu la levée à valider.",
        "Donner un accès à l'outil interne n'est pas envisageable.",
      ],
      transition:
        "PVIA propose au client un espace qui lui est propre, limité aux documents qui le concernent.",
    },
    answer: {
      title: "Le client n'entre jamais dans votre espace interne",
      text: "L'accès client est un parcours distinct, avec sa propre connexion. Il ne voit ni vos autres clients, ni vos chantiers, ni votre équipe, ni vos statistiques : uniquement les informations et documents qui lui sont destinés.",
      points: [
        "Connexion dédiée par email et code de vérification.",
        "Un client rattaché à plusieurs entreprises retrouve chaque dossier séparément.",
        "L'entreprise peut inviter le client, puis suspendre ou rétablir son accès.",
      ],
      visual: "clientspace",
    },
    flow: {
      title: "Le parcours du client",
      description: "Simple, sans compte à créer dans votre organisation.",
      steps: [
        "Invitation",
        "Connexion par code",
        "Consultation des documents",
        "Signature ou validation",
        "Historique",
      ],
    },
    features: {
      title: "Ce que le client peut faire",
      description: "Uniquement les actions prévues par le workflow de votre entreprise.",
      items: [
        { icon: FileText, title: "Consulter ses procès-verbaux", text: "Il retrouve les PV le concernant, avec leur statut." },
        { icon: PenLine, title: "Signer lorsqu'on le lui demande", text: "La signature à distance lui est proposée quand le workflow le prévoit." },
        { icon: Download, title: "Télécharger ses PDF", text: "Les documents restent disponibles, sans redemander une pièce jointe." },
        { icon: CheckCircle2, title: "Valider ou refuser une levée", text: "Il confirme la reprise, ou la refuse en expliquant ce qui ne va pas." },
        { icon: History, title: "Retrouver son historique", text: "Ses documents et ses actions restent consultables dans le temps." },
        { icon: Lock, title: "Accès strictement cloisonné", text: "Aucune donnée interne de l'entreprise n'est visible depuis l'espace client." },
      ],
    },
    outcomes: {
      title: "Ce que ça change",
      items: [
        { title: "Moins de relances", text: "Le client se sert lui-même au lieu de redemander un document." },
        { title: "Un suivi client plus clair", text: "Il voit ce qui a été signé et ce qui reste à valider." },
        { title: "Une image plus professionnelle", text: "L'expérience ne s'arrête pas à un email avec pièce jointe." },
        { title: "Un cloisonnement assumé", text: "L'accès client est distinct de l'espace interne, techniquement et visuellement." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Un client particulier suivi par deux entreprises différentes utilisant PVIA.",
      steps: [
        { when: "Invitation", text: "Chaque entreprise invite le client à son espace." },
        { when: "Connexion", text: "Le client se connecte avec son email et un code reçu par message." },
        { when: "Consultation", text: "Il retrouve les documents de chaque entreprise, sans mélange." },
        { when: "Validation", text: "Il valide la levée de réserves proposée par l'une d'elles." },
      ],
    },
    compare: false,
    related: ["reserves", "signature-pdf", "pv-reception"],
    ctaTitle: "Offrez à vos clients un suivi clair de leurs documents.",
    seoTitle: "Espace client pour documents de chantier et PV — PVIA",
    seoDescription:
      "Donnez à vos clients un espace dédié pour consulter leurs PV, télécharger leurs PDF, signer et valider les levées de réserves — sans accès à votre espace interne.",
  },

  {
    slug: "chantiers",
    navLabel: "Chantiers",
    navDesc: "Le dossier complet, au même endroit",
    navIcon: Building2,
    navGroup: "Terrain",
    eyebrow: "PVIA · Chantiers",
    h1: "Tous vos chantiers. Une seule vue.",
    subtitle:
      "Le chantier est le point d'entrée : client, adresse, équipe, planning, PV, réserves, photos et documents y sont reliés plutôt que dispersés dans des outils séparés.",
    heroBullets: ["Référence unique", "Client", "Documents", "Réserves", "Historique"],
    heroVisual: "chantier",
    problem: {
      items: [
        "Les informations d'un chantier sont réparties entre un tableur, une boîte mail et un dossier partagé.",
        "Le nom du chantier change selon la personne qui en parle.",
        "Retrouver la photo d'une installation prend plus de temps que l'intervention.",
        "Le PV et les réserves ne sont pas rattachés au même dossier.",
      ],
      transition: "PVIA relie les informations autour d'un chantier identifié une fois pour toutes.",
    },
    answer: {
      title: "Un dossier chantier, pas des silos",
      text: "Chaque chantier porte une référence unique et rassemble tout ce qui le concerne. Depuis la fiche, vous accédez au PV, aux réserves, aux photos, aux documents et à l'historique.",
      points: [
        "Référence de chantier générée automatiquement, identique pour toute l'équipe.",
        "Un chantier, un procès-verbal de réception : pas de doublon possible.",
        "Export du dossier lorsque vous devez transmettre l'ensemble des pièces.",
      ],
      visual: "chantier",
    },
    flow: {
      title: "Ce qui se rattache à un chantier",
      description: "Toutes les entrées du dossier partent du même point.",
      steps: ["Client", "Planning", "Équipe", "PV", "Réserves", "Photos", "Documents", "Historique"],
    },
    features: {
      title: "La fiche chantier",
      description: "Conçue pour être consultée aussi bien au bureau que sur le terrain.",
      items: [
        { icon: Building2, title: "Informations principales", text: "Client, adresse, statut et référence sont visibles dès l'ouverture." },
        { icon: Users, title: "Équipe rattachée", text: "Vous savez qui intervient et qui suit le dossier." },
        { icon: CalendarDays, title: "Événements planifiés", text: "Les interventions et réceptions du chantier apparaissent dans le calendrier." },
        { icon: Camera, title: "Photos du chantier", text: "Regroupées par dossier, elles ne se perdent plus dans une galerie." },
        { icon: FileText, title: "PV et documents", text: "Le procès-verbal et les pièces associées restent accessibles depuis la fiche." },
        { icon: History, title: "Historique du dossier", text: "Les actions réalisées sur le chantier sont consignées dans l'ordre." },
      ],
    },
    outcomes: {
      title: "Ce que ça change",
      items: [
        { title: "Des dossiers faciles à retrouver", text: "Une référence unique remplace les intitulés approximatifs." },
        { title: "Moins d'allers-retours", text: "L'information est cherchée à un seul endroit." },
        { title: "Une vision partagée", text: "Bureau et terrain consultent le même dossier." },
        { title: "Une transmission simple", text: "Le dossier peut être exporté quand un tiers en a besoin." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Une entreprise générale suit une quinzaine de chantiers en parallèle.",
      steps: [
        { when: "Création", text: "Le chantier est créé avec son client et reçoit sa référence." },
        { when: "Pendant les travaux", text: "Les photos et les interventions s'y accumulent naturellement." },
        { when: "Réception", text: "Le PV est créé depuis le chantier, avec ses informations déjà remplies." },
        { when: "Après", text: "Les réserves restantes et l'historique restent consultables depuis la même fiche." },
      ],
    },
    compare: true,
    related: ["visite-technique", "planning", "terrain"],
    ctaTitle: "Rassemblez vos chantiers dans un seul dossier.",
    seoTitle: "Logiciel de suivi de chantier et dossiers travaux — PVIA",
    seoDescription:
      "Centralisez vos chantiers : client, adresse, équipe, photos, PV, réserves et documents reliés au même dossier, avec une référence unique et un historique complet.",
  },

  {
    slug: "planning",
    navLabel: "Planning",
    navDesc: "Interventions et réceptions planifiées",
    navIcon: CalendarDays,
    navGroup: "Terrain",
    eyebrow: "PVIA · Planning",
    h1: "Le planning de vos chantiers, connecté au reste de votre activité.",
    subtitle:
      "Les interventions, les visites et les réceptions se planifient au même endroit que les chantiers, les équipes et les documents. Ce n'est pas un agenda de plus.",
    heroBullets: ["Jour", "Semaine", "Mois", "Filtres", "Mobile"],
    heroVisual: "calendar",
    problem: {
      items: [
        "Le planning vit dans un agenda séparé, sans lien avec les dossiers.",
        "Une réception est décalée sans que le chantier en garde la trace.",
        "Chacun tient sa propre liste d'interventions.",
        "Sur le terrain, personne ne sait ce qui est prévu ensuite.",
      ],
      transition:
        "Dans PVIA, un événement de planning appartient à un chantier : le contexte suit toujours la date.",
    },
    answer: {
      title: "Planifier sans quitter le dossier",
      text: "Depuis le calendrier, vous créez une intervention rattachée à un chantier existant. Vous retrouvez ensuite ce même événement dans la fiche du chantier.",
      points: [
        "Vues jour, plusieurs jours, semaine et mois.",
        "Filtres et recherche pour isoler un chantier, une période ou un type d'événement.",
        "Consultation confortable depuis un téléphone, y compris en plein écran.",
      ],
      visual: "calendar",
    },
    flow: {
      title: "Du planning à la réception",
      description: "La date prévue devient une intervention, puis un dossier documenté.",
      steps: ["Créer l'événement", "Rattacher le chantier", "Intervenir", "Réceptionner", "Documenter"],
    },
    features: {
      title: "Le calendrier chantier",
      description: "Pensé pour une entreprise de travaux, pas pour des réunions.",
      items: [
        { icon: CalendarDays, title: "Plusieurs vues", text: "Jour, plusieurs jours, semaine ou mois selon la façon dont vous organisez le travail." },
        { icon: Building2, title: "Événements rattachés au chantier", text: "Chaque intervention garde le lien avec son dossier." },
        { icon: Filter, title: "Filtres et recherche", text: "Isolez un chantier, un statut ou une période en quelques appuis." },
        { icon: Users, title: "Lecture par équipe", text: "Vous visualisez les interventions des membres de l'entreprise." },
        { icon: Smartphone, title: "Utilisation mobile", text: "Le calendrier reste lisible sur téléphone, avec un mode plein écran." },
        { icon: Bell, title: "Rappels d'intervention", text: "Des rappels automatiques accompagnent les échéances prévues." },
      ],
    },
    outcomes: {
      title: "Ce que ça change",
      items: [
        { title: "Une organisation partagée", text: "Le planning est le même pour le bureau et pour le terrain." },
        { title: "Moins d'oublis d'intervention", text: "Les échéances sont visibles et rappelées." },
        { title: "Un contexte immédiat", text: "Depuis une date, on accède au chantier et à ses documents." },
        { title: "Une préparation plus rapide", text: "La journée se prépare depuis une seule vue." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Trois techniciens, une semaine de pose et deux réceptions.",
      steps: [
        { when: "Lundi", text: "Les interventions de la semaine sont créées et rattachées à leurs chantiers." },
        { when: "Mercredi", text: "Une réception est décalée ; le chantier reste à jour." },
        { when: "Jeudi", text: "Le technicien consulte sa journée depuis son téléphone." },
        { when: "Vendredi", text: "Les deux réceptions sont réalisées et documentées dans leur dossier." },
      ],
    },
    compare: false,
    related: ["chantiers", "equipes", "terrain"],
    ctaTitle: "Planifiez vos interventions au bon endroit.",
    seoTitle: "Planning de chantier et interventions BTP — PVIA",
    seoDescription:
      "Organisez vos interventions et réceptions dans un calendrier relié aux chantiers, aux équipes et aux documents : vues jour, semaine, mois, filtres et utilisation mobile.",
  },

  {
    slug: "equipes",
    navLabel: "Équipes",
    navDesc: "Rôles, invitations et collaboration",
    navIcon: Users,
    navGroup: "Collaboration",
    eyebrow: "PVIA · Équipes",
    h1: "Le terrain et le bureau travaillent sur le même dossier.",
    subtitle:
      "Invitez vos collaborateurs, attribuez-leur un rôle et laissez chacun intervenir au bon endroit : le technicien documente, le responsable pilote, la direction garde la main.",
    heroBullets: ["Owner", "Admin", "Manager", "Utilisateur", "Invitations"],
    heroVisual: "team",
    problem: {
      items: [
        "Un seul compte est partagé par toute l'entreprise.",
        "On ne sait plus qui a modifié quoi dans un dossier.",
        "Les nouveaux arrivants reçoivent les accès par message.",
        "Les droits ne correspondent pas aux responsabilités réelles.",
      ],
      transition:
        "PVIA organise l'entreprise en membres identifiés, avec des rôles et des droits explicites.",
    },
    answer: {
      title: "Chaque membre a un rôle, chaque action a un auteur",
      text: "Les rôles déterminent ce que chacun peut consulter et modifier. Les actions sensibles restent réservées aux responsables, et l'historique conserve l'auteur de chaque opération.",
      points: [
        "Owner, admin, manager et utilisateur : quatre niveaux clairs.",
        "Invitation par email, avec un lien à usage unique.",
        "Le propriétaire de l'entreprise ne peut pas être retiré par erreur.",
      ],
      visual: "team",
    },
    flow: {
      title: "Intégrer un collaborateur",
      description: "De l'invitation à la première réception réalisée.",
      steps: ["Inviter", "Choisir le rôle", "Rejoindre l'entreprise", "Intervenir", "Tracer"],
    },
    features: {
      title: "Gestion de l'équipe",
      description: "Le nécessaire pour une entreprise multi-utilisateurs.",
      items: [
        { icon: Users, title: "Membres de l'entreprise", text: "La liste des collaborateurs et de leurs rôles est visible par les responsables." },
        { icon: ShieldCheck, title: "Rôles et droits", text: "Les autorisations sont appliquées côté serveur, pas seulement masquées dans l'interface." },
        { icon: Mail, title: "Invitations", text: "Un email d'invitation permet de rejoindre l'entreprise en toute autonomie." },
        { icon: ClipboardList, title: "Attribution des réserves", text: "Chaque réserve peut être confiée à un membre identifié." },
        { icon: History, title: "Traçabilité des actions", text: "L'historique indique qui a réalisé quelle opération." },
        { icon: Lock, title: "Départ d'un collaborateur", text: "L'accès peut être retiré sans perdre les documents produits." },
      ],
    },
    outcomes: {
      title: "Ce que ça change",
      items: [
        { title: "Une responsabilité claire", text: "Chaque action porte un nom, sans avoir à enquêter." },
        { title: "Des accès maîtrisés", text: "Les droits correspondent au rôle réel dans l'entreprise." },
        { title: "Une intégration rapide", text: "Un nouvel arrivant rejoint l'entreprise par invitation." },
        { title: "Une continuité assurée", text: "Les dossiers restent à l'entreprise, pas à une personne." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Une entreprise de six personnes, deux conducteurs de travaux et trois techniciens.",
      steps: [
        { when: "Arrivée", text: "Le nouveau technicien est invité avec le rôle utilisateur." },
        { when: "Sur chantier", text: "Il documente ses interventions et crée ses réserves." },
        { when: "Au bureau", text: "Le conducteur de travaux réattribue une réserve à un autre membre." },
        { when: "Direction", text: "Le propriétaire garde la main sur les paramètres de l'entreprise." },
      ],
    },
    compare: false,
    related: ["chantiers", "planning", "suivi-pilotage"],
    ctaTitle: "Faites travailler le bureau et le terrain ensemble.",
    seoTitle: "Collaboration d'équipe et rôles pour entreprises de travaux — PVIA",
    seoDescription:
      "Invitez vos collaborateurs, attribuez des rôles (owner, admin, manager, utilisateur) et travaillez à plusieurs sur les mêmes chantiers, PV et réserves, avec une traçabilité complète.",
  },

  {
    slug: "suivi-pilotage",
    navLabel: "Historique & statistiques",
    navDesc: "Piloter l'activité et retrouver l'historique",
    navIcon: BarChart3,
    navGroup: "Pilotage",
    eyebrow: "PVIA · Historique & pilotage",
    h1: "Ne cherchez plus ce qui s'est passé sur un chantier.",
    subtitle:
      "L'historique fonctionne comme un journal des opérations : qui a fait quoi, quand, et sur quel dossier. Les statistiques donnent la vision d'ensemble, l'historique donne le détail.",
    heroBullets: ["Journal des opérations", "Activité", "Réserves", "Signatures", "Exports"],
    heroVisual: "stats",
    problem: {
      items: [
        "Reconstituer l'histoire d'un dossier demande de fouiller dans les emails.",
        "Personne ne sait combien de réceptions restent à signer.",
        "Les réserves anciennes ne remontent jamais.",
        "Le suivi d'activité se fait de mémoire.",
      ],
      transition:
        "PVIA conserve les opérations réalisées et les restitue à deux niveaux : global et dossier par dossier.",
    },
    answer: {
      title: "De la vision globale au détail d'un dossier",
      text: "Vous partez d'un indicateur — réceptions en attente, réserves ouvertes — puis vous descendez jusqu'au chantier concerné et à son historique détaillé.",
      points: [
        "Indicateurs d'activité : PV, signatures, réserves et éléments en attente.",
        "Historique horodaté par dossier, consultable et exportable.",
        "Comparaison de périodes pour observer l'évolution de l'activité.",
      ],
      visual: "stats",
    },
    flow: {
      title: "Du chiffre au dossier",
      description: "Un chemin direct entre le tableau de bord et l'événement précis.",
      steps: ["Tableau de bord", "Indicateur", "Liste filtrée", "Dossier", "Historique détaillé"],
    },
    features: {
      title: "Suivi et pilotage",
      description: "Des informations issues de votre activité réelle, pas d'une saisie supplémentaire.",
      items: [
        { icon: BarChart3, title: "Indicateurs d'activité", text: "Volume de PV, signatures obtenues, réserves ouvertes et en attente." },
        { icon: History, title: "Journal des opérations", text: "Création, modification, signature, levée, validation : chaque étape est datée." },
        { icon: Filter, title: "Filtres et recherche", text: "Retrouvez rapidement un dossier, une période ou un type d'événement." },
        { icon: Download, title: "Exports", text: "Les données consultées peuvent être exportées pour un usage externe." },
        { icon: Bell, title: "Éléments en attente", text: "Ce qui reste à signer, à lever ou à valider est visible sans le chercher." },
        { icon: ShieldCheck, title: "Traçabilité conservée", text: "L'historique reste attaché au dossier, même après sa clôture." },
      ],
    },
    outcomes: {
      title: "Ce que ça change pour un responsable",
      items: [
        { title: "Des réponses immédiates", text: "Retrouvez qui a fait quoi sans rechercher dans les emails." },
        { title: "Un pilotage factuel", text: "Les décisions s'appuient sur l'activité enregistrée." },
        { title: "Moins de dossiers en suspens", text: "Ce qui traîne devient visible." },
        { title: "Une mémoire d'entreprise", text: "L'information reste disponible après le départ d'un collaborateur." },
      ],
    },
    scenario: {
      title: "Un exemple concret",
      intro: "Point hebdomadaire du responsable travaux.",
      steps: [
        { when: "Lundi matin", text: "Il ouvre le tableau de bord et voit les réceptions en attente de signature." },
        { when: "Deux minutes après", text: "Il filtre les réserves ouvertes par gravité." },
        { when: "Ensuite", text: "Il descend sur un chantier précis et consulte son historique daté." },
        { when: "En fin de semaine", text: "Il exporte le suivi pour le transmettre à la direction." },
      ],
    },
    compare: false,
    related: ["reserves", "chantiers", "pv-reception"],
    ctaTitle: "Reprenez de la visibilité sur votre activité.",
    seoTitle: "Historique de chantier et statistiques d'activité — PVIA",
    seoDescription:
      "Suivez votre activité de réception : indicateurs sur les PV, signatures et réserves, journal des opérations horodaté par dossier et exports pour aller plus loin.",
  },
];

export function getSolutionPage(slug: string): SolutionContent | undefined {
  return SOLUTION_PAGES.find((p) => p.slug === slug);
}

export const SOLUTION_GROUPS: { title: SolutionContent["navGroup"]; items: SolutionContent[] }[] = (
  ["Préparer", "Réception", "Terrain", "Collaboration", "Pilotage"] as const
).map((title) => ({ title, items: SOLUTION_PAGES.filter((p) => p.navGroup === title) }));
