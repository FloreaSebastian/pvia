import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import type { SolutionContent } from "@/components/landing/solutions/content";
import {
  AnswerSection,
  CompareSection,
  FeatureGridSection,
  FlowSection,
  OutcomesSection,
  PlanNoticeSection,
  ProblemSection,
  RelatedSolutions,
  ScenarioSection,
  SolutionCta,
  SolutionHero,
  SolutionVisual,
} from "@/components/landing/solutions/sections";

/** Gabarit d'une page Solution PVIA. Le contenu vient de `solutions/content`. */
export function SolutionPage({ page }: { page: SolutionContent }) {
  return (
    <div className="landing-editorial min-h-screen overflow-x-hidden bg-background">
      <Header />
      <main>
        <SolutionHero
          eyebrow={page.eyebrow}
          title={page.h1}
          subtitle={page.subtitle}
          bullets={page.heroBullets}
          visual={<SolutionVisual name={page.heroVisual} />}
        />

        <ProblemSection items={page.problem.items} transition={page.problem.transition} />

        <AnswerSection
          title={page.answer.title}
          text={page.answer.text}
          points={page.answer.points}
          visual={<SolutionVisual name={page.answer.visual} />}
        />

        <FlowSection
          title={page.flow.title}
          description={page.flow.description}
          steps={page.flow.steps}
        />

        <FeatureGridSection
          title={page.features.title}
          description={page.features.description}
          items={page.features.items}
        />

        <OutcomesSection title={page.outcomes.title} items={page.outcomes.items} />

        {page.plan && (
          <PlanNoticeSection
            badge={page.plan.badge}
            title={page.plan.title}
            text={page.plan.text}
            bullets={page.plan.bullets}
          />
        )}

        {page.compare && <CompareSection />}


        <ScenarioSection
          title={page.scenario.title}
          intro={page.scenario.intro}
          steps={page.scenario.steps}
        />

        <RelatedSolutions slugs={page.related} />

        <SolutionCta title={page.ctaTitle} />
      </main>
      <Footer />
    </div>
  );
}
