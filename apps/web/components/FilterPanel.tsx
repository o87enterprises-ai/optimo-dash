"use client";

/**
 * Filters applied to both the scene and the tables below it.
 *
 * The controls sit in one row above the visualisation, and every change
 * affects the scene and the record tables together — a filter that only
 * touched one of them would make the two disagree.
 */

export type Filters = {
  /** Days of history. null means everything stored. */
  days: number | null;
  categories: Record<"keywords" | "prompts" | "citations" | "backlinks", boolean>;
};

export const DEFAULT_FILTERS: Filters = {
  days: null,
  categories: { keywords: true, prompts: true, citations: true, backlinks: true },
};

const RANGES = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "28d", days: 28 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
] as const;

const CATEGORIES = [
  { key: "keywords", label: "Keywords" },
  { key: "prompts", label: "GEO prompts" },
  { key: "citations", label: "Citations" },
  { key: "backlinks", label: "Backlinks" },
] as const;

export default function FilterPanel({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
}) {
  return (
    <div className="filters">
      <div className="seg" role="group" aria-label="Date range">
        {RANGES.map((range) => (
          <button
            key={range.label}
            type="button"
            className={filters.days === range.days ? "seg-on" : "seg-off"}
            aria-pressed={filters.days === range.days}
            onClick={() => onChange({ ...filters, days: range.days })}
          >
            {range.label}
          </button>
        ))}
      </div>

      <div className="seg" role="group" aria-label="Categories">
        {CATEGORIES.map((category) => {
          const on = filters.categories[category.key];
          return (
            <button
              key={category.key}
              type="button"
              className={on ? "seg-on" : "seg-off"}
              aria-pressed={on}
              onClick={() =>
                onChange({
                  ...filters,
                  categories: { ...filters.categories, [category.key]: !on },
                })
              }
            >
              {category.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Applies the date filter to any row carrying a timestamp field. */
export function withinRange(row: any, days: number | null, field: string): boolean {
  if (days == null) return true;
  const value = row[field];
  if (!value) return true;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return true;
  return ts >= Date.now() - days * 86400000;
}
