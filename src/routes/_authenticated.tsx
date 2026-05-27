import { createFileRoute, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/app/AppLayout";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { CompanyProvider } from "@/hooks/use-company";
import { getOnboardingStatus } from "@/lib/onboarding.functions";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

const ONBOARDING_WHITELIST = ["/onboarding", "/billing", "/upgrade-required", "/admin"];

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith("/admin");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["onboarding-status", user?.id],
    queryFn: () => getOnboardingStatus(),
    enabled: !!user && !isAdminRoute,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!status || isAdminRoute) return;
    const onWhitelisted = ONBOARDING_WHITELIST.some(
      (p) => location.pathname === p || location.pathname.startsWith(p + "/"),
    );
    const needsOnboarding = !status.profileComplete || (status.needsCompanyStep && !status.companyComplete);
    if (needsOnboarding && !onWhitelisted) {
      navigate({ to: "/onboarding" });
    }
  }, [status, location.pathname, navigate, isAdminRoute]);

  if (loading || !user || (!isAdminRoute && statusLoading)) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/40">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isAdminRoute) {
    return (
      <AdminLayout userEmail={user.email}>
        <Outlet />
      </AdminLayout>
    );
  }

  return (
    <CompanyProvider>
      <AppLayout userEmail={user.email}>
        <Outlet />
      </AppLayout>
    </CompanyProvider>
  );
}

