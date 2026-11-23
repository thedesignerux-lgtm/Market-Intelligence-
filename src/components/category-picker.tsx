"use client";

// Selector de categorías: desplegable agrupado por familias, con búsqueda y selección múltiple.
//
// Las familias son solo agrupación visual (src/lib/domain/category-families.ts). Lo que viaja
// en el formulario son los identificadores de categoría de siempre, separados por comas, así
// que los enlaces siguen funcionando y no se crea ninguna categoría nueva.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collapseCategories,
  groupByFamily,
  parseCategories,
  serializeCategories,
  type Category,
  type FamilyId,
} from "@/lib/domain/category-families";

interface Props {
  categories: Category[];
  /** Valor actual del filtro, como viene de la URL. */
  value?: string;
  name?: string;
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function CategoryPicker({ categories, value, name = "categoria" }: Props) {
  const [selected, setSelected] = useState<string[]>(() => parseCategories(value, categories));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  // Lo que se envía: sin las hijas que ya entran por su madre.
  const serialized = serializeCategories(collapseCategories(selected, categories)) ?? "";

  const groups = useMemo(() => groupByFamily(categories), [categories]);
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return groups;
    return groups
      .map((group) => ({ ...group, categories: group.categories.filter((c) => normalize(c.name).includes(q)) }))
      .filter((group) => group.categories.length > 0);
  }, [groups, query]);

  const total = categories.length;
  const allSelected = selected.length === total && total > 0;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const apply = () => {
    setOpen(false);
    box.current?.closest("form")?.requestSubmit();
  };

  const summary =
    selected.length === 0
      ? "Todas las categorías"
      : selected.length === 1
        ? (categories.find((c) => c.id === selected[0])?.name ?? "1 categoría")
        : `${selected.length} categorías`;

  return (
    <div className="relative flex min-w-[180px] flex-1 flex-col gap-1" ref={box}>
      <input type="hidden" name={name} value={serialized} />
      <span className="label" id="categoria-label">
        Categoría
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby="categoria-label"
        className="field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={selected.length === 0 ? "truncate text-ink-faint" : "truncate"}>{summary}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Seleccionar categorías"
          className="panel absolute left-0 top-full z-30 mt-1 w-[clamp(280px,23rem,92vw)] shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-line p-3">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="Buscar categoría..."
              className="field min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={() => setSelected(allSelected ? [] : categories.map((c) => c.id))}
              className="shrink-0 text-[13px] text-atlantic hover:underline"
            >
              {allSelected ? "Ninguna" : "Todas"}
            </button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto overscroll-contain">
            {visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-ink-soft">No se encontraron categorías.</p>
            ) : (
              visible.map((group, index) => (
                <div key={group.id} className={index > 0 ? "border-t border-line" : undefined}>
                  <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
                    <FamilyIcon family={group.id} />
                    <span className="flex-1 text-[13px] font-semibold text-ink">{group.name}</span>
                    <span className="text-[12px] tabular-nums text-ink-faint">{group.categories.length}</span>
                  </div>
                  <ul className="pb-1.5">
                    {group.categories.map((category) => {
                      const byParent = Boolean(category.parent_id && selected.includes(category.parent_id));
                      return (
                        <li key={category.id}>
                          <label
                            className={`flex cursor-pointer items-center gap-2 py-1 pr-3 text-[14px] hover:bg-line/30 ${
                              category.parent_id ? "pl-9" : "pl-3"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(category.id) || byParent}
                              onChange={() => toggle(category.id)}
                              className="size-4 shrink-0 rounded border-line-strong accent-pine"
                            />
                            <span className="min-w-0 flex-1 truncate text-ink">{category.name}</span>
                            {byParent && !selected.includes(category.id) && (
                              <span className="shrink-0 text-[12px] text-ink-faint">incluida</span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line p-3">
            <span className="text-[13px] text-ink-soft">
              {selected.length === 0 ? "Sin filtro de categoría" : `${selected.length} de ${total} seleccionadas`}
            </span>
            <div className="flex items-center gap-2">
              {selected.length > 0 && (
                <button type="button" className="btn-secondary" onClick={() => setSelected([])}>
                  Limpiar
                </button>
              )}
              <button type="button" className="btn-primary" onClick={apply}>
                Aplicar filtros
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Iconos propios, en la línea de los que ya usa el proyecto: trazo de 1,8 sobre rejilla de 24. */
function FamilyIcon({ family }: { family: FamilyId }) {
  const paths: Record<FamilyId, string> = {
    comercio: "M3 9l1.5-4.5h15L21 9M3 9h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Zm6 11v-6h6v6",
    servicios: "M14.5 5.5a4 4 0 0 1 5 5L10 20H5v-5l9.5-9.5Zm0 0 4 4",
    organizaciones: "M8 21h8m-4-4v4m-6-16h12v4a6 6 0 0 1-12 0V5Zm12 1h2.5a2.5 2.5 0 0 1-2.5 4m-12-4H3.5a2.5 2.5 0 0 0 2.5 4",
    comunidades: "M17 10c0 3.3-3.1 6-7 6-.9 0-1.7-.1-2.5-.4L4 17l1-3.2A5.5 5.5 0 0 1 3 10c0-3.3 3.1-6 7-6s7 2.7 7 6Z",
    otras: "M4 6h16M4 12h16M4 18h10",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[family]} />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`size-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
