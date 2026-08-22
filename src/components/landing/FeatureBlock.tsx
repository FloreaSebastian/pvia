import type { ReactNode } from "react";

export type FeatureBlockProps = {
  eyebrow: string;
  title: string;
  /** Le problème réel rencontré sur le terrain. */
  problem: string;
  /** Ce que fait PVIA. */
  solution: string;
  /** Le bénéfice concret. */
  benefit: string;
  visual?: ReactNode;
  reverse?: boolean;
};

/** Bloc fonctionnalité : problème → solution PVIA → bénéfice → capture produit. */
export function FeatureBlock({
  eyebrow,
  title,
  problem,
  solution,
  benefit,
  visual,
  reverse,
}: FeatureBlockProps) {
  return (
    <article className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <div className={`min-w-0 ${reverse ? "lg:order-2" : ""}`}>
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          {eyebrow}
        </span>
        <h3 className="mt-2 text-balance text-xl tracking-tight text-foreground sm:text-2xl">
          {title}
        </h3>

        <dl className="mt-5 space-y-4 text-sm leading-relaxed">
          <div className="min-w-0">
            <dt className="font-semibold text-foreground">Le problème</dt>
            <dd className="mt-1 text-pretty text-muted-foreground">{problem}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-semibold text-foreground">Avec PVIA</dt>
            <dd className="mt-1 text-pretty text-muted-foreground">{solution}</dd>
          </div>
          <div className="min-w-0 rounded-lg border-l-2 border-primary bg-muted/40 px-4 py-3">
            <dt className="font-semibold text-foreground">Ce que ça change</dt>
            <dd className="mt-1 text-pretty text-muted-foreground">{benefit}</dd>
          </div>
        </dl>
      </div>

      {visual ? (
        <div className={`min-w-0 ${reverse ? "lg:order-1" : ""}`}>{visual}</div>
      ) : (
        <div aria-hidden className={reverse ? "lg:order-1" : ""} />
      )}
    </article>
  );
}

/** Conteneur de plusieurs FeatureBlock avec alternance automatique. */
export function FeatureBlocks({
  items,
  title,
  description,
}: {
  items: Omit<FeatureBlockProps, "reverse">[];
  title?: string;
  description?: string;
}) {
  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {title && (
          <div className="max-w-2xl">
            <h2 className="text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
              {title}
            </h2>
            {description && (
              <p className="mt-3 text-pretty text-muted-foreground">{description}</p>
            )}
          </div>
        )}
        <div className="mt-12 space-y-16 lg:space-y-24">
          {items.map((item, i) => (
            <FeatureBlock key={item.title} {...item} reverse={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}
