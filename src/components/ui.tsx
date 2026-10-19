// Piezas visuales compartidas. La procedencia (qué fuente aporta cada dato) es el elemento distintivo.
import { CRM_TONE } from "./crm-tone";
import { PRECISION, PRIORITY, SOURCE } from "@/lib/labels";

export function SourceMark({ source, showName = false }: { source: string; showName?: boolean }) {
  const s = SOURCE[source] ?? { short: source, name: source, color: "var(--ink-soft)" };
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-soft" title={s.name}>
      <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: s.color }} aria-hidden="true" />
      {showName ? s.name : s.short}
    </span>
  );
}

export function SourceMarks({ sources }: { sources: string[] | null }) {
  if (!sources?.length) return <span className="text-ink-faint">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
      {sources.map((s) => (
        <SourceMark key={s} source={s} />
      ))}
    </span>
  );
}

/** Precisión de la ubicación como una pequeña escala de 4 niveles. */
export function PrecisionMeter({ precision }: { precision: string }) {
  const levels: Record<string, number> = { exact: 4, address: 3, street: 2, postal_code: 1, municipality: 1, unknown: 0 };
  const n = levels[precision] ?? 0;
  const p = PRECISION[precision] ?? PRECISION.unknown!;
  return (
    <span className="inline-flex items-center gap-2" title={p.hint}>
      <span className="inline-flex items-end gap-[2px]" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="w-[3px] rounded-[1px]" style={{ height: 4 + i * 2, background: i <= n ? "var(--pine)" : "var(--line)" }} />
        ))}
      </span>
      <span className={n === 0 ? "text-ink-faint" : "text-ink-soft"}>{p.label}</span>
    </span>
  );
}

export function CrmBadge({ slug, label }: { slug: string | null; label: string | null }) {
  if (!slug) return <span className="text-ink-faint">Sin estado</span>;
  const tone = CRM_TONE[slug] ?? CRM_TONE.default!;
  return (
    <span className="tag" style={{ background: tone.bg, color: tone.fg }}>
      {label}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-ink-soft">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel flex flex-col items-start gap-2 px-6 py-10">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      {children && <div className="max-w-[60ch] text-ink-soft">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-danger-wash px-3 py-2 text-[13px] text-danger">
      {children}
    </p>
  );
}

export interface RoleFlags {
  buyer_potential: boolean;
  seller_potential: boolean;
  buyer_participant: boolean;
  seller_participant: boolean;
}

/** Roles comerciales de una entidad. La participación verificada en GROPO se distingue del potencial. */
export function RoleTags({ roles }: { roles: RoleFlags }) {
  const tags: { key: string; label: string; cls: string; title: string }[] = [];
  if (roles.buyer_participant) tags.push({ key: "bp", label: "Comprador GROPO", cls: "bg-atlantic text-white", title: "Participa en GROPO como comprador (verificado)" });
  else if (roles.buyer_potential) tags.push({ key: "b", label: "Comprador", cls: "bg-[#e4edf6] text-atlantic", title: "Comprador potencial" });
  if (roles.seller_participant) tags.push({ key: "sp", label: "Vendedor GROPO", cls: "bg-pine text-white", title: "Participa en GROPO como vendedor (verificado)" });
  else if (roles.seller_potential) tags.push({ key: "s", label: "Vendedor", cls: "bg-pine-wash text-pine-strong", title: "Vendedor potencial" });
  if (tags.length === 0) return <span className="text-ink-faint">Sin rol</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t.key} className={`tag ${t.cls}`} title={t.title}>
          {t.label}
        </span>
      ))}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: number | null }) {
  const p = priority ? PRIORITY[priority] : null;
  if (!p) return <span className="text-ink-faint">—</span>;
  return (
    <span className="tag" style={{ background: p.bg, color: p.fg }}>
      {p.label}
    </span>
  );
}
