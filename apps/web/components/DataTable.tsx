"use client";

import { useMemo, useState } from "react";

/**
 * Sortable data table.
 *
 * Every chart in this dashboard has a table view — it is the accessibility
 * fallback the colour scales depend on, so it is a first-class component
 * rather than a debug affordance.
 */

export type Column<T> = {
  key: string;
  label: string;
  /** Value used for sorting and, unless `render` is given, for display. */
  value: (row: T) => string | number | null;
  render?: (row: T) => React.ReactNode;
  align?: "left" | "right";
  /** Numeric columns sort descending first, which is what readers expect. */
  numeric?: boolean;
  /**
   * Overrides that default. Set false where a *smaller* number is better —
   * search position, average rank — so the first click surfaces the best rows.
   */
  descendingFirst?: boolean;
};

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  empty: string;
  rowKey: (row: T, index: number) => string;
  initialSort?: string;
  /** Highlights a row the reader arrived at from the scene. */
  highlight?: (row: T) => boolean;
};

export default function DataTable<T>({
  rows,
  columns,
  empty,
  rowKey,
  initialSort,
  highlight,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort ?? null);
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey);
    if (!column) return rows;

    return [...rows].sort((a, b) => {
      const av = column.value(a);
      const bv = column.value(b);
      // Nulls always sort last, whichever direction is active.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      const result =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return descending ? -result : result;
    });
  }, [rows, columns, sortKey, descending]);

  if (!rows.length) return <div className="empty">{empty}</div>;

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sortKey === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={column.align === "right" ? "right" : undefined}
                  aria-sort={active ? (descending ? "descending" : "ascending") : "none"}
                >
                  <button
                    type="button"
                    className="th-sort"
                    onClick={() => {
                      if (active) setDescending((d) => !d);
                      else {
                        setSortKey(column.key);
                        setDescending(column.descendingFirst ?? Boolean(column.numeric));
                      }
                    }}
                  >
                    {column.label}
                    <span aria-hidden="true" className="th-arrow">
                      {active ? (descending ? "▼" : "▲") : ""}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={rowKey(row, i)} className={highlight?.(row) ? "row-highlight" : undefined}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === "right" ? "right" : undefined}>
                  {column.render ? column.render(row) : (column.value(row) ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
