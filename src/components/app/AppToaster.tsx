import { Toaster } from "@/components/ui/sonner";
import { installSafeToast } from "@/lib/toast-safe";

installSafeToast();

export function AppToaster() {
  return <Toaster richColors position="top-right" />;
}
