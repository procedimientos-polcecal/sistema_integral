"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NAV, type NavItem } from "@/lib/core/nav";
import type { Modulo, Rol } from "@/lib/core/types";
import { logout } from "@/app/login/actions";

const COLAPSADO_KEY = "sdg-sidebar-colapsado";

function visible(item: NavItem, modulos: Set<Modulo>, esAdminGlobal: boolean, adminModulos: Set<Modulo>): boolean {
  if (item.soloAdminGlobal) return esAdminGlobal;
  if (item.soloAdmin) return item.modulo ? adminModulos.has(item.modulo) : esAdminGlobal;
  if (!item.modulo) return true;
  return modulos.has(item.modulo);
}

/** Compara contra pathname+query si el href trae `?...`, si no, solo pathname. */
function esRutaActiva(href: string, pathname: string, search: string): boolean {
  const [rutaHref, queryHref] = href.split("?");
  if (rutaHref !== pathname) return false;
  if (!queryHref) return true;
  return search === queryHref;
}

// Un ícono por página/grupo, para que cada ítem del sidebar sea reconocible
// de un vistazo (mismo criterio que APPRRHH: un ícono por etiqueta, reusado
// entre módulos cuando el concepto es el mismo — ej. "Historial" o "Configuración").
const ICONOS: Record<string, () => ReactElement> = {
  "Inicio": IconDash,
  "RRHH": IconUsers,
  "Remises": IconCar,
  "Mantenimiento": IconWrench,
  "Administración": IconCog,
  "Dashboard": IconDash,
  "Empleados": IconUser,
  "Usuarios": IconKey,
  "Turnos": IconClock,
  "Feriados": IconCalendar,
  "Control": IconCheck,
  "Marcaciones": IconCheck,
  "Licencias": IconFile,
  "Ausencias": IconAlert,
  "Asistencia": IconClock,
  "Por período": IconCalendar,
  "Por día": IconClock,
  "Vacaciones": IconSun,
  "Por empleado": IconUser,
  "Historial": IconList,
  "Francos": IconSun,
  "Liquidaciones": IconCash,
  "Configuración": IconCog,
  "Analítico": IconChart,
  "Hoy": IconCheck,
  "Semana": IconCalendar,
  "Vehículos": IconCar,
  "Equipos": IconWrench,
  "Mantenimientos": IconClipboard,
  "Ejecuciones": IconBolt,
  "Órdenes de trabajo": IconClipboard,
  "Planificación diaria": IconCalendar,
};

function iconForItem(item: NavItem) {
  return ICONOS[item.label] ?? IconDash;
}

export function Sidebar({
  modulos,
  modulosAdmin,
  rol,
  usuarioNombre,
  esEmpleadoRemises = false,
}: {
  modulos: Modulo[];
  /** Módulos donde el usuario tiene nivel "admin" (no solo acceso) — gatea los ítems soloAdmin de cada módulo. */
  modulosAdmin: Modulo[];
  rol: Rol;
  usuarioNombre: string;
  /** Cuenta vinculada a un empleado (auto-servicio "Mi remis") — no depende del nivel de módulo. */
  esEmpleadoRemises?: boolean;
}) {
  const set = new Set(modulos);
  const adminSet = new Set(modulosAdmin);
  const esAdminGlobal = rol === "admin_sistema" || rol === "admin";
  const pathname = usePathname();
  const search = useSearchParams().toString();

  const items = NAV.filter((i) => visible(i, set, esAdminGlobal, adminSet));
  const [abierto, setAbierto] = useState<string | null>(null);
  const [abiertoSub, setAbiertoSub] = useState<string | null>(null);
  const [colapsado, setColapsado] = useState(false);

  useEffect(() => {
    setColapsado(localStorage.getItem(COLAPSADO_KEY) === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem(COLAPSADO_KEY, colapsado ? "1" : "0");
  }, [colapsado]);

  // Si la ruta actual pertenece a un sector (o sub-grupo) con sub-páginas, lo despliega solo.
  useEffect(() => {
    for (const item of items) {
      if (!item.children) continue;
      const hijoDirectoActivo = item.children.some((c) => !c.children && esRutaActiva(c.href, pathname, search));
      const subgrupoActivo = item.children.find((c) => c.children?.some((n) => esRutaActiva(n.href, pathname, search)));
      if (hijoDirectoActivo || subgrupoActivo) {
        setAbierto(item.label);
        if (subgrupoActivo) setAbiertoSub(subgrupoActivo.label);
        return;
      }
    }
  }, [pathname, search]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Link href="/mi-remis" title={colapsado ? "Mi remis" : undefined} className={`nav-link ${esRutaActiva("/mi-remis", pathname, search) ? "active" : ""} ${colapsado ? "justify-center" : ""}`}>
            <IconCar />
            {!colapsado && "Mi remis"}
          </Link>
        )}

        {items.map((item) => {
          const Icon = iconForItem(item);

          if (!item.children) {
            return (
              <Link
                key={item.href}
                href={item.href}
                title={colapsado ? item.label : undefined}
                className={`nav-link ${esRutaActiva(item.href, pathname, search) ? "active" : ""} ${colapsado ? "justify-center" : ""}`}
              >
                <Icon />
                {!colapsado && item.label}
              </Link>
            );
          }

          const hijosVisibles = item.children.filter((c) => visible(c, set, esAdminGlobal, adminSet));
          const hijoActivo = hijosVisibles.some(
            (c) => esRutaActiva(c.href, pathname, search) || c.children?.some((n) => esRutaActiva(n.href, pathname, search))
          );

          // Colapsado: sin lugar para desplegar sub-ítems, un click entra
          // directo a la primera página del sector (o del primer sub-grupo).
          if (colapsado) {
            const primerHref = hijosVisibles[0]?.children?.[0]?.href ?? hijosVisibles[0]?.href ?? item.href;
            return (
              <Link key={item.href} href={primerHref} title={item.label} className={`nav-link justify-center ${hijoActivo ? "active" : ""}`}>
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
                <ChevronIcon abierto={desplegado} />
              </button>
              {desplegado && (
                <div>
                  {hijosVisibles.map((c) => {
                    const CIcon = iconForItem(c);
                    if (!c.children) {
                      return (
                        <Link key={c.href} href={c.href} className={`nav-link-sub ${esRutaActiva(c.href, pathname, search) ? "active" : ""}`}>
                          <CIcon />
                          {c.label}
                        </Link>
                      );
                    }

                    const nietosVisibles = c.children.filter((n) => visible(n, set, esAdminGlobal, adminSet));
                    const nietoActivo = nietosVisibles.some((n) => esRutaActiva(n.href, pathname, search));
                    const subDesplegado = abiertoSub === c.label;
                    return (
                      <div key={c.href}>
                        <button
                          type="button"
                          onClick={() => setAbiertoSub(subDesplegado ? null : c.label)}
                          aria-expanded={subDesplegado}
                          className={`nav-link-sub w-full text-left ${nietoActivo ? "active" : ""}`}
                          style={{ background: "none", border: "none", cursor: "pointer" }}
                        >
                          <CIcon />
                          <span style={{ flex: 1 }}>{c.label}</span>
                          <ChevronIcon abierto={subDesplegado} small />
                        </button>
                        {subDesplegado && (
                          <div className="ml-3">
                            {nietosVisibles.map((n) => {
                              const NIcon = iconForItem(n);
                              return (
                                <Link key={n.href} href={n.href} className={`nav-link-sub ${esRutaActiva(n.href, pathname, search) ? "active" : ""}`}>
                                  <NIcon />
                                  {n.label}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t px-3 py-3" style={{ borderColor: "var(--sidebar-border)" }}>
        {colapsado ? (
          <Link href="/mi-cuenta" title="Mi cuenta" className="mb-1 flex w-full items-center justify-center rounded-lg py-2 transition hover:bg-white/10" style={{ color: "var(--sidebar-text)" }}>
            <IconUsers />
          </Link>
        ) : (
          <Link href="/mi-cuenta" className="block truncate px-1 pb-2 text-sm hover:underline" style={{ color: "var(--sidebar-text)" }}>
            {usuarioNombre}
          </Link>
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

function ChevronIcon({ abierto, small = false }: { abierto: boolean; small?: boolean }) {
  const size = small ? 10 : 12;
  return (
    <svg
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      className="shrink-0 transition-transform duration-150"
      style={{ transform: abierto ? "rotate(180deg)" : "none" }}
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
function IconUser() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" strokeLinecap="round" />
    </svg>
  );
}
function IconKey() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <circle cx="7" cy="15" r="3" />
      <path d="M9.5 12.5L19 3m-4 4l2 2m-5 1l2 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconFile() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.18A2 2 0 004 21h16a2 2 0 001.89-2.96L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconSun() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconList() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCash() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m3-4a3 3 0 116 0 3 3 0 01-6 0zm11 0a2 2 0 01-2 2h-6a2 2 0 01-2-2v-2a2 2 0 012-2h6a2 2 0 012 2v2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M3 3v18h18M8 17V10m5 7V6m5 11v-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 3h6a1 1 0 011 1v1a1 1 0 01-1 1H9a1 1 0 01-1-1V4a1 1 0 011-1z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconBolt() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" strokeLinecap="round" strokeLinejoin="round" />
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
