"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Resumen" },
  { href: "/directorio", label: "Directorio" },
  { href: "/mapa", label: "Mapa" },
  { href: "/duplicados", label: "Duplicados" },
  { href: "/importaciones", label: "Importaciones" },
];

export function Nav({ pendingDuplicates }: { pendingDuplicates: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="flex gap-1 overflow-x-auto md:flex-col">
      {ITEMS.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href) || (item.href === "/directorio" && path.startsWith("/entidades"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-9 shrink-0 items-center justify-between gap-3 rounded-md px-3 text-[14px] ${
              active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
            }`}
          >
            {item.label}
            {item.href === "/duplicados" && pendingDuplicates > 0 && (
              <span className="rounded bg-[#7fc39c] px-1.5 text-[12px] font-semibold text-ink" aria-label={`${pendingDuplicates} pendientes`}>
                {pendingDuplicates}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
