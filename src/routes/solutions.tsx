import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout de la section Solutions. Les métadonnées sont définies par chaque page. */
export const Route = createFileRoute("/solutions")({
  component: SolutionsLayout,
});

function SolutionsLayout() {
  return <Outlet />;
}
