/**
 * AddressAutocomplete — French address picker backed by api-adresse.data.gouv.fr
 *
 * Calls the `searchAddressSuggestions` server function with debounce.
 * onSelect fires with normalized address + CP + ville + lat/lng.
 * Falls back to free text if the user keeps typing without selecting.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchAddressSuggestions, type AddressSuggestion } from "@/lib/address.functions";

export type AddressValue = {
  address: string;
  postalCode: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
};

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Commencez à taper une adresse…",
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (v: AddressValue) => void;
  placeholder?: string;
  id?: string;
}) {
  const searchFn = useServerFn(searchAddressSuggestions);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastQuery = useRef("");

  useEffect(() => {
    const q = value.trim();
    if (q.length < 3 || q === lastQuery.current) {
      if (q.length < 3) setSuggestions([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchFn({ data: { query: q } });
        lastQuery.current = q;
        setSuggestions(res.suggestions);
        setOpen(res.suggestions.length > 0);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [value, searchFn]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(s: AddressSuggestion) {
    onChange(s.label);
    onSelect({
      address: s.address || s.label,
      postalCode: s.postalCode,
      city: s.city,
      latitude: s.latitude,
      longitude: s.longitude,
    });
    setOpen(false);
    lastQuery.current = s.label;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            if (e.target.value.trim().length >= 3) setOpen(true);
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className="pl-9 pr-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-popover shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={`${s.label}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              className={`flex w-full items-start gap-2 border-b border-border/50 px-3 py-2 text-left text-sm transition-colors last:border-b-0 ${
                i === activeIdx ? "bg-accent" : "hover:bg-accent/60"
              }`}
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.label}</div>
                {(s.postalCode || s.city) && (
                  <div className="text-xs text-muted-foreground">
                    {s.postalCode} {s.city}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      {value.trim().length >= 3 && !loading && suggestions.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Aucune suggestion — saisie libre acceptée.
        </p>
      )}
    </div>
  );
}
