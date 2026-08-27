import Link from "next/link";
import { logout } from "@/app/login/actions";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationsBell } from "./NotificationsBell";
import { BotonMenu } from "./NavMovil";

export function Header({ usuarioNombre }: { usuarioNombre: string }) {
  const iniciales =
    usuarioNombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "?";

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-2 px-3 md:gap-4 md:px-4"
      style={{ background: "linear-gradient(165deg, var(--sidebar-bg) 0%, var(--sidebar-bg-dark) 100%)", borderBottom: "1px solid var(--sidebar-border)" }}
    >
      <BotonMenu />

      <Link href="/" title="Inicio" className="flex shrink-0 items-center">
        <img
          src="/logo.png"
          alt="Polcecal / Polysan"
          style={{ height: 32, width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)" }}
        />
      </Link>

      <div className="hidden flex-1 md:block" />

      <div className="w-full min-w-0 max-w-[360px]">
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <NotificationsBell />
        <Link
          href="/mi-cuenta"
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-white/10"
          style={{ color: "var(--sidebar-text)" }}
        >
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            style={{ background: "var(--primary-tint)", color: "var(--sidebar-bg)" }}
          >
            {iniciales}
          </span>
          <span className="hidden truncate sm:inline">{usuarioNombre}</span>
        </Link>
        <form action={logout}>
          <button
            type="submit"
            title="Cerrar sesión"
            className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10"
            style={{ color: "var(--sidebar-text)", background: "none", border: "none", cursor: "pointer" }}
          >
            <IconLogout />
          </button>
        </form>
      </div>
    </header>
  );
}

function IconLogout() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0">
      <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
