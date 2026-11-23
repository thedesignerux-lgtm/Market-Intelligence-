"use client";

// Selector territorial: comunidad autónoma → provincia → municipio, con búsqueda global,
// selección múltiple y exclusiones. España es siempre el ámbito y no aparece como nivel.
//
// El valor viaja en un campo oculto del formulario GET del directorio, con el mismo formato
// que la URL ("ca12,28,-28079"), así que los filtros siguen siendo compartibles por enlace.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ccaaCoverage,
  municipalityCoverage,
  parseTerritory,
  provinceCoverage,
  removePick,
  serializeTerritory,
  territoryName,
  territoryPath,
  toggleCcaa,
  toggleMunicipality,
  toggleProvince,
  type Coverage,
  type TerritoryPick,
} from "@/lib/domain/territory-selection";
import { CCAA, PROVINCES } from "@/lib/domain/territory";

interface Option {
  code: string;
  level: "ccaa" | "provincia" | "municipio";
  name: string;
  path?: string[];
  entities: number;
}

interface Props {
  /** Valor actual, como viene de la URL. */
  value?: string;
  /** Nombres de los territorios ya seleccionados, para los chips. */
  labels?: Record<string, string>;
  name?: string;
}

const COUNT_FORMAT = new Intl.NumberFormat("es-ES");

export function TerritoryPicker({ value, labels = {}, name = "territorio" }: Props) {
  const [picks, setPicks] = useState<TerritoryPick[]>(() => parseTerritory(value));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Option[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [children, setChildren] = useState<Record<string, Option[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>(labels);
  const box = useRef<HTMLDivElement>(null);

  const serialized = serializeTerritory(picks) ?? "";

  /** Pide los hijos de un territorio una sola vez y guarda sus nombres y contadores. */
  const loadChildren = useCallback(
    async (parent: string | null) => {
      const key = parent ?? "";
      if (children[key]) return;
      setLoading((s) => new Set(s).add(key));
      try {
        const url = parent ? `/api/territorio?padre=${encodeURIComponent(parent)}` : "/api/territorio";
        const res = await fetch(url);
        if (!res.ok) throw new Error("fallo");
        const data = (await res.json()) as { options: Option[] };
        setChildren((c) => ({ ...c, [key]: data.options }));
        setCounts((c) => ({ ...c, ...Object.fromEntries(data.options.map((o) => [o.code, o.entities])) }));
        setNames((n) => ({ ...n, ...Object.fromEntries(data.options.map((o) => [o.code, o.name])) }));
      } catch {
        setChildren((c) => ({ ...c, [key]: [] }));
      } finally {
        setLoading((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    [children],
  );

  useEffect(() => {
    if (open) void loadChildren(null);
  }, [open, loadChildren]);

  // Búsqueda global, con una pausa para no pedir en cada tecla.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/territorio?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { options: Option[] };
        setResults(data.options ?? []);
        setNames((n) => ({ ...n, ...Object.fromEntries((data.options ?? []).map((o) => [o.code, o.name])) }));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Cerrar al pulsar fuera o con Escape.
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

  const toggleExpand = (code: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else {
        next.add(code);
        void loadChildren(code);
      }
      return next;
    });
  };

  const nameOf = (code: string) => names[code] ?? territoryName(code) ?? code;

  const chips = useMemo(() => {
    const order = { ccaa: 0, provincia: 1, municipio: 2 } as const;
    return [...picks].sort(
      (a, b) => Number(a.excluded) - Number(b.excluded) || order[a.level] - order[b.level] || nameOf(a.code).localeCompare(nameOf(b.code)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, names]);

  const summary =
    picks.length === 0
      ? "Toda España"
      : picks.length === 1 && !picks[0]!.excluded
        ? nameOf(picks[0]!.code)
        : `${picks.filter((p) => !p.excluded).length} territorios${picks.some((p) => p.excluded) ? " con exclusiones" : ""}`;

  const apply = () => {
    setOpen(false);
    box.current?.closest("form")?.requestSubmit();
  };

  const count = (code: string) => counts[code];

  return (
    <div className="relative flex min-w-[220px] flex-1 flex-col gap-1" ref={box}>
      <input type="hidden" name={name} value={serialized} />
      <span className="label" id="territorio-label">
        Territorio
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby="territorio-label"
        className="field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className={picks.length === 0 ? "text-ink-faint" : "truncate"}>{summary}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Seleccionar territorio"
          className="panel absolute left-0 top-full z-30 mt-1 w-[clamp(300px,36rem,92vw)] shadow-lg"
        >
          <div className="border-b border-line p-3">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter dentro del selector no debe enviar el formulario del directorio.
                if (e.key === "Enter") e.preventDefault();
              }}
              placeholder="Buscar comunidad, provincia o municipio..."
              className="field w-full"
            />
          </div>

          <div className="max-h-[22rem] overflow-y-auto overscroll-contain p-1.5">
            {results !== null ? (
              <SearchResults
                results={results}
                searching={searching}
                picks={picks}
                onPick={(o) => setPicks(pickToggle(picks, o))}
                count={count}
              />
            ) : (
              <ul className="space-y-0.5">
                {(children[""] ?? CCAA.map((c) => ({ code: c.code, level: "ccaa" as const, name: c.name, entities: 0 }))).map(
                  (ccaa) => {
                    const coverage = ccaaCoverage(picks, ccaa.code);
                    const isOpen = expanded.has(ccaa.code);
                    const provinces = children[ccaa.code] ?? [];
                    const hasProvinces = PROVINCES.some((p) => p.ccaa === ccaa.code);
                    return (
                      <li key={ccaa.code}>
                        <Row
                          label={ccaa.name}
                          coverage={coverage}
                          entities={count(ccaa.code)}
                          expandable={hasProvinces}
                          expanded={isOpen}
                          onExpand={() => toggleExpand(ccaa.code)}
                          onToggle={() => setPicks(toggleCcaa(picks, ccaa.code))}
                        />
                        {isOpen && hasProvinces && (
                          <ul className="ml-5 border-l border-line pl-2">
                            {loading.has(ccaa.code) && provinces.length === 0 && <Loading />}
                            {provinces.map((province) => {
                              const provCoverage = provinceCoverage(picks, province.code);
                              const provOpen = expanded.has(province.code);
                              const municipalities = children[province.code] ?? [];
                              return (
                                <li key={province.code}>
                                  <Row
                                    label={province.name}
                                    coverage={provCoverage}
                                    entities={count(province.code)}
                                    expandable
                                    expanded={provOpen}
                                    onExpand={() => toggleExpand(province.code)}
                                    onToggle={() => setPicks(toggleProvince(picks, province.code))}
                                  />
                                  {provOpen && (
                                    <ul className="ml-5 border-l border-line pl-2">
                                      {loading.has(province.code) && municipalities.length === 0 && <Loading />}
                                      {municipalities.map((municipality) => (
                                        <li key={municipality.code}>
                                          <Row
                                            label={municipality.name}
                                            coverage={municipalityCoverage(picks, municipality.code)}
                                            entities={municipality.entities}
                                            onToggle={() => setPicks(toggleMunicipality(picks, municipality.code))}
                                          />
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            )}
          </div>

          <div className="border-t border-line p-3">
            {picks.length === 0 ? (
              <p className="text-[13px] text-ink-soft">Sin selección: el análisis cubre toda España.</p>
            ) : (
              <ul className="mb-3 flex flex-wrap gap-1.5">
                {chips.map((pick) => (
                  <li key={`${pick.excluded ? "-" : ""}${pick.code}`}>
                    <span
                      className={`tag gap-1 ${pick.excluded ? "bg-danger-wash text-danger" : "bg-pine-wash text-pine"}`}
                    >
                      {pick.excluded && "sin "}
                      {nameOf(pick.code)}
                      <button
                        type="button"
                        onClick={() => setPicks(removePick(picks, pick.code))}
                        aria-label={`Quitar ${nameOf(pick.code)}`}
                        className="text-current/60 hover:text-current"
                      >
                        ×
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPicks([])}>
                Limpiar
              </button>
              <button type="button" className="btn-primary" onClick={apply}>
                Aplicar territorio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Selecciona o quita el resultado de una búsqueda, según su nivel. */
function pickToggle(picks: TerritoryPick[], option: Option): TerritoryPick[] {
  if (option.level === "ccaa") return toggleCcaa(picks, option.code);
  if (option.level === "provincia") return toggleProvince(picks, option.code);
  return toggleMunicipality(picks, option.code);
}

function SearchResults({
  results,
  searching,
  picks,
  onPick,
  count,
}: {
  results: Option[];
  searching: boolean;
  picks: TerritoryPick[];
  onPick: (o: Option) => void;
  count: (code: string) => number | undefined;
}) {
  if (searching && results.length === 0) return <Loading />;
  if (results.length === 0) {
    return <p className="px-2 py-6 text-center text-[13px] text-ink-soft">Ningún territorio con ese nombre.</p>;
  }
  const coverageOf = (o: Option): Coverage =>
    o.level === "ccaa" ? ccaaCoverage(picks, o.code) : o.level === "provincia" ? provinceCoverage(picks, o.code) : municipalityCoverage(picks, o.code);
  return (
    <ul className="space-y-0.5">
      {results.map((option) => {
        const path = option.path?.length ? option.path : territoryPath(option.code);
        return (
          <li key={option.code}>
            <Row
              label={option.name}
              hint={path.length ? `${path.join(" → ")} → ${option.name}` : LEVEL_LABEL[option.level]}
              coverage={coverageOf(option)}
              entities={option.entities ?? count(option.code)}
              onToggle={() => onPick(option)}
            />
          </li>
        );
      })}
    </ul>
  );
}

const LEVEL_LABEL = { ccaa: "Comunidad autónoma", provincia: "Provincia", municipio: "Municipio" } as const;

function Row({
  label,
  hint,
  coverage,
  entities,
  expandable = false,
  expanded = false,
  onExpand,
  onToggle,
}: {
  label: string;
  hint?: string;
  coverage: Coverage;
  entities?: number;
  expandable?: boolean;
  expanded?: boolean;
  onExpand?: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded px-1 hover:bg-line/30">
      {expandable ? (
        <button
          type="button"
          onClick={onExpand}
          aria-label={expanded ? `Contraer ${label}` : `Desplegar ${label}`}
          aria-expanded={expanded}
          className="flex h-7 w-5 items-center justify-center text-ink-faint hover:text-ink"
        >
          <Chevron open={expanded} small />
        </button>
      ) : (
        <span className="w-5" />
      )}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 text-[14px]">
        <input
          type="checkbox"
          checked={coverage === "full"}
          ref={(el) => {
            if (el) el.indeterminate = coverage === "partial";
          }}
          onChange={onToggle}
          className="size-4 shrink-0 rounded border-line-strong accent-pine"
        />
        <span className="min-w-0 flex-1 truncate text-ink">
          {label}
          {hint && <span className="ml-2 text-[12px] text-ink-faint">{hint}</span>}
        </span>
        {typeof entities === "number" && entities > 0 && (
          <span className="shrink-0 text-[12px] tabular-nums text-ink-faint">{COUNT_FORMAT.format(entities)}</span>
        )}
      </label>
    </div>
  );
}

function Loading() {
  return <p className="px-2 py-3 text-[13px] text-ink-faint">Cargando…</p>;
}

function Chevron({ open, small = false }: { open: boolean; small?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`${small ? "size-3.5" : "size-4"} shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
