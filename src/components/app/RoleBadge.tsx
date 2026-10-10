import { cn } from "@/lib/utils";
import type { CompanyRoleValue } from "@/lib/roles";
import { ROLE_PROFILES, ROLE_TONE_CLASS, asKnownRole, roleLabel, roleShort } from "@/lib/role-access";

/** Badge de rôle lisible : couleur + texte, jamais la couleur seule. */
export function RoleBadge({
  role,
  long = false,
  className,
}: {
  role: CompanyRoleValue | string | null | undefined;
  long?: boolean;
  className?: string;
}) {
  const known = asKnownRole(role);
  const tone = known ? ROLE_TONE_CLASS[ROLE_PROFILES[known].tone] : ROLE_TONE_CLASS.muted;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-semibold leading-5",
        tone,
        className,
      )}
      title={roleLabel(role)}
    >
      <span className="sr-only">Votre rôle : </span>
      <span className="truncate">{long ? roleLabel(role) : roleShort(role)}</span>
    </span>
  );
}
