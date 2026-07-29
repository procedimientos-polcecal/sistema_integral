"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, type NavItem } from "@/lib/core/nav";
import type { Modulo, Rol } from "@/lib/core/types";
import { logout } from "@/app/login/actions";

const COLAPSADO_KEY = "sdg-sidebar-colapsado";

function visible(item: NavItem, modulos: Set<Modulo>, esAdmin: boolean): boolean {
  if (item.href === "/administracion") return esAdmin;
  if (!item.modulo) return true;
  return modulos.has(item.modulo);
}

function iconFor(href: string) {
  switch (href) {
    case "/":
      return IconDash;
    case "/rrhh":
      return IconUsers;
    case "/remises":
      return IconCar;
    case "/mantenimiento":
      return IconWrench;
    case "/administracion":
      return IconCog;
    default:
      return IconDash;
  }
}

export function Sidebar({
  modulos,
  rol,
  usuarioNombre,
  esEmpleadoRemises = false,
}: {
  modulos: Modulo[];
  rol: Rol;
  usuarioNombre: string;
  /** Cuenta vinculada a un empleado (auto-servicio "Mi remis") — no depende del nivel de módulo. */
  esEmpleadoRemises?: boolean;
}) {
  const set = new Set(modulos);
  const esAdmin = rol === "admin_sistema" || rol === "admin";
  const pathname = usePathname();

  const items = NAV.filter((i) => visible(i, set, esAdmin));
  const [abierto, setAbierto] = useState<string | null>(null);
  const [colapsado, setColapsado] = useState(false);

  useEffect(() => {
    setColapsado(localStorage.getItem(COLAPSADO_KEY) === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem(COLAPSADO_KEY, colapsado ? "1" : "0");
  }, [colapsado]);

  // Si la ruta actual pertenece a un sector con sub-páginas, lo despliega solo.
  useEffect(() => {
    const activo = items.find((i) => i.children?.some((c) => c.href === pathname));
    if (activo) setAbierto(activo.label);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside
      className={`flex flex-col shrink-0 transition-[width] duration-200 ${colapsado ? "w-[68px]" : "w-60"}`}
      style={{ background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)" }}
    >
      <div className="relative border-b px-3 pb-4 pt-5 text-center" style={{ borderColor: "var(--sidebar-border)" }}>
        <button
          type="button"
          onClick={() => setColapsado((v) => !v)}
          aria-label={colapsado ? "Mostrar panel lateral" : "Esconder panel lateral"}
          className="absolute top-3 flex h-6 w-6 items-center justify-center rounded transition hover:bg-white/10"
          style={{ color: "var(--sidebar-text)", right: colapsado ? "50%" : "0.75rem", transform: colapsado ? "translateX(50%)" : "none" }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ transform: colapsado ? "rotate(180deg)" : "none" }}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {colapsado ? (
          <div className="mx-auto flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-white/95">
            <img src="/logo.png" alt="SdG" style={{ width: 24, height: 24, objectFit: "contain" }} />
          </div>
        ) : (
          <>
            <img src="/logo.png" alt="Polcecal / Polysan" width={130} style={{ margin: "0 auto", objectFit: "contain" }} />
            <div className="mt-1.5 text-[10px] uppercase tracking-[.06em]" style={{ color: "var(--sidebar-text)", opacity: 0.7 }}>
              SdG
            </div>
          </>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {esEmpleadoRemises && (
          <Link href="/mi-remis" title={colapsado ? "Mi remis" : undefined} className={`nav-link ${pathname === "/mi-remis" ? "active" : ""} ${colapsado ? "justify-center" : ""}`}>
            <IconCar />
            {!colapsado && "Mi remis"}
          </Link>
        )}

        {items.map((item) => {
          const Icon = iconFor(item.href);

          if (!item.children) {
            return (
              <Link
                key={item.href}
                href={item.href}
                title={colapsado ? item.label : undefined}
                className={`nav-link ${pathname === item.href ? "active" : ""} ${colapsado ? "justify-center" : ""}`}
              >
                <Icon />
                {!colapsado && item.label}
              </Link>
            );
          }

          const hijosVisibles = item.children.filter((c) => visible(c, set, esAdmin));
          const hijoActivo = hijosVisibles.some((c) => c.href === pathname);

          // Colapsado: sin lugar para desplegar sub-ítems, un click entra
          // directo a la primera página del sector.
          if (colapsado) {
            return (
              <Link
                key={item.href}
                href={hijosVisibles[0]?.href ?? item.href}
                title={item.label}
                className={`nav-link justify-center ${hijoActivo ? "active" : ""}`}
              >
                <Icon />
              </Link>
            );
          }

          const desplegado = abierto === item.label;
          return (
            <div key={item.href}>
              <button
                type="button"
                onClick={() => setAbierto(desplegado ? null : item.label)}
                aria-expanded={desplegado}
                className={`nav-link ${hijoActivo ? "active" : ""}`}
              >
                <Icon />
                <span style={{ flex: 1 }}>{item.label}</span>
                <svg
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  className="shrink-0 transition-transform duration-150"
                  style={{ transform: desplegado ? "rotate(180deg)" : "none" }}
                >
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {desplegado && (
                <div>
                  {hijosVisibles.map((c) => (
                    <Link key={c.href} href={c.href} className={`nav-link-sub ${c.href === pathname ? "active" : ""}`}>
                      {c.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t px-3 py-3" style={{ borderColor: "var(--sidebar-border)" }}>
        {!colapsado && (
          <div className="truncate px-1 pb-2 text-sm" style={{ color: "var(--sidebar-text)" }}>
            {usuarioNombre}
          </div>
        )}
        <form action={logout}>
          <button
            type="submit"
            title={colapsado ? "Cerrar sesión" : undefined}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-white/10 ${colapsado ? "justify-center" : ""}`}
            style={{ color: "var(--sidebar-text)", background: "none", border: "none", cursor: "pointer" }}
          >
            <IconLogout />
            {!colapsado && "Cerrar sesión"}
          </button>
        </form>
      </div>
    </aside>
  );
}

/* ─── Iconos ─── */
function IconDash() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCar() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M5 17h14M5 17a2 2 0 01-2-2v-2l2-5a2 2 0 012-2h6a2 2 0 012 2l2 5v2a2 2 0 01-2 2M5 17a2 2 0 002 2h0a2 2 0 002-2m8 0a2 2 0 002 2h0a2 2 0 002-2M7 13h10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconWrench() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M14.7 6.3a4 4 0 10-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 005.4-5.4l-2.83 2.83a2 2 0 01-2.83-2.83L14.7 6.3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCog() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IconLogout() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
