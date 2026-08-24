/**
 * Blocs réutilisables des pages Solutions.
 * Aucun style codé en dur : uniquement des tokens du design system.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CalendarMockup,
  ChantierMockup,
  ClientSpaceMockup,
  DashboardMockup,
  HistoryMockup,
  PhoneMockup,
  ReserveMockup,
  SignatureMockup,
  StatsMockup,
  TeamMockup,
} from "@/components/landing/mockups";
import type { SolutionContent, VisualKey } from "@/components/landing/solutions/content";
import { SOLUTION_PAGES } from "@/components/landing/solutions/content";

/** Pastille « formule requise » (ex. Pro) utilisée dans la navigation et les pages. */
export function PlanBadge({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-primary ${className}`}
    >
      {label}
    </span>
  );
}

/** Encart de restriction commerciale : la solution requiert une formule minimale. */
export function PlanNoticeSection({
  badge,
  title,
  text,
  bullets,
}: {
  badge: string;
  title: string;
  text: string;
  bullets: string[];
}) {
  return (
    <Section bordered muted>
      <div className="rounded-2xl border border-primary/30 bg-card p-6 shadow-elevation-sm sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <PlanBadge label={badge} />
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Formule requise
          </span>
        </div>
        <h2 className="mt-3 text-balance text-xl tracking-tight text-foreground sm:text-2xl">
          {title}
        </h2>
        <p className="mt-3 max-w-3xl text-pretty text-muted-foreground">{text}</p>
        <ul className="mt-5 space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex min-w-0 items-start gap-2 text-sm">
              <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 break-words text-foreground/80">{b}</span>
            </li>
          ))}
        </ul>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="min-h-12 w-full sm:w-auto" asChild>
            <Link to="/tarifs">
              Voir les formules <ArrowRight aria-hidden className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="min-h-12 w-full sm:w-auto" asChild>
            <Link to="/signup">Essayer 14 jours gratuitement</Link>
          </Button>
        </div>
      </div>
    </Section>
  );
}


/** Rend la maquette produit correspondant à une clé. */
export function SolutionVisual({ name, className = "" }: { name: VisualKey; className?: string }) {
  switch (name) {
    case "phone":
      return (
        <div className={`flex justify-center ${className}`}>
          <PhoneMockup />
        </div>
      );
    case "reserve":
      return <ReserveMockup className={className} />;
    case "signature":
      return <SignatureMockup className={className} />;
    case "clientspace":
      return <ClientSpaceMockup className={className} />;
    case "calendar":
      return <CalendarMockup className={className} />;
    case "stats":
      return <StatsMockup className={className} />;
    case "chantier":
      return <ChantierMockup className={className} />;
    case "team":
      return <TeamMockup className={className} />;
    case "history":
      return <HistoryMockup className={className} />;
    default:
      return <DashboardMockup className={className} />;
  }
}

export function Section({
  children,
  className = "",
  bordered,
  muted,
}: {
  children: ReactNode;
  className?: string;
  bordered?: boolean;
  muted?: boolean;
}) {
  return (
    <section
      className={`py-16 sm:py-24 ${bordered ? "border-t border-border" : ""} ${
        muted ? "bg-muted/30" : ""
      } ${className}`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  as: As = "h2",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className="max-w-2xl">
      {eyebrow && (
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          {eyebrow}
        </span>
      )}
      <As className="mt-3 text-balance font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </As>
      {description && (
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/** Hero d'une page Solution : promesse + produit. */
export function SolutionHero({
  eyebrow,
  title,
  subtitle,
  bullets,
  visual,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  bullets: string[];
  visual: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden pt-28 sm:pt-36">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-radial-fade" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-14">
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              {eyebrow}
            </span>
            <h1 className="mt-3 text-balance font-display text-[clamp(1.9rem,6vw,3.4rem)] font-bold leading-[1.06] tracking-tight text-foreground">
              {title}
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {subtitle}
            </p>

            {bullets.length > 0 && (
              <ul className="mt-7 flex flex-wrap gap-2">
                {bullets.map((b) => (
                  <li
                    key={b}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {b}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="min-h-12 w-full shadow-elevation-md sm:w-auto" asChild>
                <Link to="/signup">
                  Essayer PVIA gratuitement <ArrowRight aria-hidden className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="min-h-12 w-full sm:w-auto" asChild>
                <Link to="/comment-ca-marche">Voir comment ça fonctionne</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              14 jours gratuits · Sans engagement · Sans carte bancaire
            </p>
          </div>

          <div className="min-w-0">{visual}</div>
        </div>
      </div>
    </section>
  );
}

/** Le problème métier, puis la transition vers PVIA. */
export function ProblemSection({
  items,
  transition,
}: {
  items: string[];
  transition: string;
}) {
  return (
    <Section bordered muted>
      <SectionHeading
        eyebrow="Le problème"
        title="Ce qui se passe aujourd'hui, dans la plupart des entreprises"
      />
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {items.map((i) => (
          <li
            key={i}
            className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-3.5"
          >
            <X aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 text-sm leading-relaxed text-muted-foreground">{i}</span>
          </li>
        ))}
      </ul>
      <p className="mt-8 max-w-2xl text-pretty text-base font-medium text-foreground">
        {transition}
      </p>
    </Section>
  );
}

/** La réponse produit : texte + grande interface. */
export function AnswerSection({
  title,
  text,
  points,
  visual,
}: {
  title: string;
  text: string;
  points: string[];
  visual: ReactNode;
}) {
  return (
    <Section bordered>
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="min-w-0">
          <SectionHeading eyebrow="La réponse PVIA" title={title} description={text} />
          <ul className="mt-6 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex min-w-0 items-start gap-2.5">
                <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 text-sm leading-relaxed text-foreground/90">{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">{visual}</div>
      </div>
    </Section>
  );
}

/** Workflow : horizontal sur grand écran, vertical sur mobile. */
export function FlowSection({
  title,
  description,
  steps,
}: {
  title: string;
  description: string;
  steps: string[];
}) {
  return (
    <Section bordered muted>
      <SectionHeading eyebrow="Le déroulé" title={title} description={description} />
      <ol className="mt-8 grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-stretch">
        {steps.map((s, i) => (
          <li key={s} className="flex min-w-0 items-center gap-2 lg:flex-none">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 lg:flex-none">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                {i + 1}
              </span>
              <span className="min-w-0 text-sm font-medium text-foreground">{s}</span>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight
                aria-hidden
                className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block"
              />
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Grille de fonctionnalités. */
export function FeatureGridSection({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: SolutionContent["features"]["items"];
}) {
  return (
    <Section bordered>
      <SectionHeading eyebrow="Fonctionnalités" title={title} description={description} />
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((f) => (
          <li
            key={f.title}
            className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-elevation-sm transition-shadow hover:shadow-elevation-md"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <f.icon aria-hidden className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-balance text-base font-semibold text-foreground">{f.title}</h3>
            <p className="mt-1.5 text-pretty text-sm leading-relaxed text-muted-foreground">
              {f.text}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Résultats métier. */
export function OutcomesSection({
  title,
  items,
}: {
  title: string;
  items: { title: string; text: string }[];
}) {
  return (
    <Section bordered muted>
      <SectionHeading eyebrow="Résultats" title={title} />
      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        {items.map((o) => (
          <div
            key={o.title}
            className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-elevation-sm"
          >
            <dt className="flex items-start gap-2 text-base font-semibold text-foreground">
              <Check aria-hidden className="mt-1 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">{o.title}</span>
            </dt>
            <dd className="mt-1.5 pl-6 text-pretty text-sm leading-relaxed text-muted-foreground">
              {o.text}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/** Comparaison « Sans PVIA » / « Avec PVIA ». */
export function CompareSection() {
  const before = ["Word", "PDF isolés", "Messagerie", "Photos dans le téléphone", "Emails", "Papier", "Tableur"];
  const after = ["PV", "Photos", "Réserves", "Signature", "PDF", "Levées", "Historique"];
  return (
    <Section bordered>
      <SectionHeading
        eyebrow="Avant / après"
        title="Le même travail, mais réuni dans un seul dossier."
        description="Il ne s'agit pas d'ajouter un outil de plus, mais de remplacer une chaîne d'outils qui ne se parlent pas."
      />
      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-border bg-muted/40 p-5 sm:p-6">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Sans PVIA
          </h3>
          <ul className="mt-4 flex flex-wrap gap-2">
            {before.map((b) => (
              <li
                key={b}
                className="rounded-lg border border-dashed border-border bg-card px-3 py-1.5 text-sm text-muted-foreground"
              >
                {b}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            L'information existe, mais elle est éparpillée : personne ne détient le dossier complet.
          </p>
        </div>

        <div className="min-w-0 rounded-2xl border border-primary/30 bg-card p-5 shadow-elevation-md sm:p-6">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-primary">
            Avec PVIA
          </h3>
          <p className="mt-3 text-base font-semibold text-foreground">
            Un dossier chantier structuré
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {after.map((a) => (
              <li
                key={a}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              >
                <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
                {a}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Une information saisie une fois, disponible là où elle est utile.
          </p>
        </div>
      </div>
    </Section>
  );
}

/** Cas concret, présenté comme une chronologie. */
export function ScenarioSection({
  title,
  intro,
  steps,
}: {
  title: string;
  intro: string;
  steps: { when: string; text: string }[];
}) {
  return (
    <Section bordered muted>
      <SectionHeading eyebrow="Cas concret" title={title} description={intro} />
      <ol className="mt-8 space-y-3">
        {steps.map((s) => (
          <li
            key={s.when + s.text}
            className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3.5 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-primary sm:w-32">
              {s.when}
            </span>
            <span className="min-w-0 text-sm leading-relaxed text-foreground/90">{s.text}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        Exemple illustratif construit à partir du fonctionnement réel de PVIA.
      </p>
    </Section>
  );
}

/** Maillage interne : « Continuez avec PVIA ». */
export function RelatedSolutions({ slugs }: { slugs: string[] }) {
  const items = slugs
    .map((s) => SOLUTION_PAGES.find((p) => p.slug === s))
    .filter((p): p is SolutionContent => Boolean(p));

  if (items.length === 0) return null;

  return (
    <Section bordered>
      <SectionHeading
        eyebrow="Continuez avec PVIA"
        title="La suite logique de cette solution"
        description="Chaque partie de PVIA prolonge la précédente : le processus reste le même, du chantier à l'historique."
      />
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <li key={p.slug}>
            <Link
              to="/solutions/$slug"
              params={{ slug: p.slug }}
              className="group flex h-full min-h-[7rem] min-w-0 flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
            >
              <span className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <p.navIcon aria-hidden className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 truncate text-base font-semibold text-foreground">
                  {p.navLabel}
                </span>
                <ArrowRight
                  aria-hidden
                  className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {p.navDesc}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** CTA final propre à la page. */
export function SolutionCta({ title }: { title: string }) {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-3xl border border-border bg-foreground px-5 py-14 text-center text-background shadow-elevation-xl sm:px-12 sm:py-20">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-balance font-display text-[clamp(1.6rem,5vw,2.6rem)] font-bold leading-tight tracking-tight">
            {title}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-background/75">
            Créez votre compte et réalisez votre première réception dans PVIA.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              variant="secondary"
              className="min-h-12 w-full px-6 text-foreground shadow-elevation-lg sm:w-auto"
              asChild
            >
              <Link to="/signup">
                Essayer PVIA gratuitement <ArrowRight aria-hidden className="ml-1 h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="min-h-12 w-full border-background/25 bg-transparent px-6 text-background hover:bg-background/10 hover:text-background sm:w-auto"
              asChild
            >
              <Link to="/tarifs">Voir les tarifs</Link>
            </Button>
          </div>
          <p className="mt-5 text-sm text-background/70">14 jours gratuits · Sans engagement</p>
        </div>
      </div>
    </Section>
  );
}
