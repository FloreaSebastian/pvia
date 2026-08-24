import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ResolvedField } from "@/lib/visites/engine";
import type { AnswerValue } from "@/lib/visites/types";

interface Props {
  field: ResolvedField;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  disabled?: boolean;
  invalid?: boolean;
}

/** Champ de saisie terrain : cibles tactiles ≥ 44px, libellés jamais tronqués. */
export function VisitFieldInput({ field, value, onChange, disabled, invalid }: Props) {
  const id = `f-${field.answerKey}`;
  const describedBy = field.help ? `${id}-help` : undefined;

  return (
    <div className={cn("min-w-0 space-y-2", field.wide && "sm:col-span-2")}>
      <Label htmlFor={id} className="flex flex-wrap items-baseline gap-1 text-sm leading-snug">
        <span className="break-words">{field.label}</span>
        {field.required ? (
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
        {field.unit ? <span className="text-xs font-normal text-muted-foreground">({field.unit})</span> : null}
      </Label>

      {field.type === "boolean" ? (
        <div className="flex min-h-11 items-center gap-3 rounded-md border border-input px-3">
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(c) => onChange(c)}
            disabled={disabled}
            aria-describedby={describedBy}
          />
          <span className="text-sm text-muted-foreground">{value === true ? "Oui" : "Non"}</span>
        </div>
      ) : field.type === "select" ? (
        <Select value={value == null ? "" : String(value)} onValueChange={(v) => onChange(v)} disabled={disabled}>
          <SelectTrigger id={id} className={cn("h-11", invalid && "border-destructive")} aria-describedby={describedBy}>
            <SelectValue placeholder="Sélectionner…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value} className="min-h-11">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "multiselect" ? (
        <div className="space-y-1 rounded-md border border-input p-2" role="group" aria-describedby={describedBy}>
          {(field.options ?? []).map((o) => {
            const list = Array.isArray(value) ? value : [];
            const checked = list.includes(o.value);
            return (
              <label
                key={o.value}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-1 text-sm hover:bg-muted/50"
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(c) =>
                    onChange(c === true ? [...list, o.value] : list.filter((v) => v !== o.value))
                  }
                />
                <span className="min-w-0 break-words">{o.label}</span>
              </label>
            );
          })}
        </div>
      ) : field.type === "textarea" ? (
        <Textarea
          id={id}
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          disabled={disabled}
          aria-describedby={describedBy}
          className={cn("min-h-24", invalid && "border-destructive")}
        />
      ) : (
        <Input
          id={id}
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={value == null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (field.type !== "number") return onChange(raw);
            if (raw === "") return onChange(null);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={disabled}
          aria-describedby={describedBy}
          className={cn("h-11", invalid && "border-destructive")}
        />
      )}

      {field.help ? (
        <p id={`${id}-help`} className="text-xs leading-snug text-muted-foreground">
          {field.help}
        </p>
      ) : null}
    </div>
  );
}
