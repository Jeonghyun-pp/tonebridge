"use client";

/**
 * Reusable gear autocomplete used by the guitar and amp onboarding steps.
 * Debounced search against /api/{path}/lookup, shows a dropdown of hits,
 * and provides a "Can't find it?" escape hatch to a free-text fallback.
 *
 * Kept generic so /search and /library can reuse it later.
 */
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

export interface GearSearchItem {
  id: number;
  brand: string;
  model: string;
  badge?: string | null;            // e.g. "modeler" or pickup_config
}

export interface GearSearchProps {
  endpoint: string;                 // e.g. "/api/guitars/lookup"
  placeholder: string;
  itemBadge?: (raw: Record<string, unknown>) => string | null;
  onSelect: (picked: { id: number | null; freetext: string | null; label: string }) => void;
  initialLabel?: string;
}

export function GearSearch({ endpoint, placeholder, itemBadge, onSelect, initialLabel }: GearSearchProps) {
  const [q, setQ] = useState(initialLabel ?? "");
  const [items, setItems] = useState<GearSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [showFreetext, setShowFreetext] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q.trim())}&limit=10`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { items: Record<string, unknown>[] };
        setItems(
          json.items.map((it) => ({
            id: Number(it.id),
            brand: String(it.brand),
            model: String(it.model),
            badge: itemBadge ? itemBadge(it) : null,
          }))
        );
        setOpen(true);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, endpoint, itemBadge]);

  function pick(it: GearSearchItem) {
    onSelect({ id: it.id, freetext: null, label: `${it.brand} ${it.model}` });
    setQ(`${it.brand} ${it.model}`);
    setOpen(false);
  }

  function pickFreetext(text: string) {
    onSelect({ id: null, freetext: text, label: text });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setShowFreetext(false);
          }}
          onFocus={() => items.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
        />
        {open && items.length > 0 && (
          <ul className="absolute left-0 right-0 top-full mt-1 z-10 max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-md">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(it)}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 flex items-center justify-between gap-2"
                >
                  <span>
                    <span className="font-medium">{it.brand}</span>{" "}
                    <span className="text-zinc-600 dark:text-zinc-400">{it.model}</span>
                  </span>
                  {it.badge && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {it.badge}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!showFreetext && (
        <button
          type="button"
          onClick={() => setShowFreetext(true)}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 self-start"
        >
          Can&apos;t find it? Type it manually →
        </button>
      )}

      {showFreetext && (
        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500">Manual entry (brand + model)</label>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Strandberg Boden Original 6"
            maxLength={120}
            className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent text-sm outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
          <button
            type="button"
            onClick={() => pickFreetext(q.trim())}
            disabled={q.trim().length < 2}
            className="self-start text-xs px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
          >
            Use &quot;{q || '…'}&quot;
          </button>
        </div>
      )}

      {loading && (
        <span className="text-xs text-zinc-500" role="status">
          Searching…
        </span>
      )}
    </div>
  );
}
