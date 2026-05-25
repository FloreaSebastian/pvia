import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import type { LucideIcon } from "lucide-react";

export type SettingsCommandItem = {
  to: string;
  label: string;
  desc?: string;
  group: string;
  icon: LucideIcon;
};

export function SettingsCommand({
  open, onOpenChange, items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: SettingsCommandItem[];
}) {
  const navigate = useNavigate();

  const groups = items.reduce<Record<string, SettingsCommandItem[]>>((acc, it) => {
    (acc[it.group] ||= []).push(it);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Rechercher un paramètre, une section, une page…" />
      <CommandList>
        <CommandEmpty>Aucun résultat.</CommandEmpty>
        {Object.entries(groups).map(([group, list]) => (
          <CommandGroup key={group} heading={group}>
            {list.map((it) => {
              const Icon = it.icon;
              return (
                <CommandItem
                  key={it.to + it.label}
                  value={`${it.label} ${it.desc ?? ""} ${group}`}
                  onSelect={() => {
                    onOpenChange(false);
                    navigate({ to: it.to as any });
                  }}
                >
                  <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{it.label}</span>
                  {it.desc && <span className="ml-2 truncate text-xs text-muted-foreground">{it.desc}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
