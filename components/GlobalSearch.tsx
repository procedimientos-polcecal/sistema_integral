"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Resultado {
  tipo: "empleado" | "equipo" | "vehiculo" | "chofer";
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

const GRUPO_LABEL: Record<Resultado["tipo"], string> = {
  empleado: "Empleados",
  equipo: "Equipos",
  vehiculo: "Vehículos",
  chofer: "Choferes",
};

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResultados([]);
      return;
    }
    setCargando(true);
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/buscar?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json().catch(() => ({ resultados: [] }));
      setResultados(data.resultados ?? []);
      setCargando(false);
    }, 250);
    return () => clearTimeout(timeout);
  }, [q]);

  useEffect(() => {
    function onClickFuera(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, []);

  function ir(r: Resultado) {
    setAbierto(false);
    setQ("");
    setResultados([]);
    router.push(r.href);
  }

  const grupos = (["empleado", "equipo", "vehiculo", "chofer"] as const)
    .map((tipo) => ({ tipo, items: resultados.filter((r) => r.tipo === tipo) }))
    .filter((g) => g.items.length > 0);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,.08)" }}>
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="shrink-0" style={{ color: "var(--sidebar-text)" }}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setAbierto(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAbierto(false);
            if (e.key === "Enter" && resultados[0]) ir(resultados[0]);
          }}
          placeholder="Buscar empleados, equipos, vehículos..."
          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/40"
        />
      </div>

      {abierto && q.trim().length >= 2 && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border bg-white shadow-lg"
          style={{ borderColor: "var(--border)" }}
        >
          {cargando ? (
            <div className="px-4 py-3 text-sm text-gray-400">Buscando...</div>
          ) : grupos.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-400">Sin resultados</div>
          ) : (
            grupos.map((g) => (
              <div key={g.tipo}>
                <div className="section-title px-4 pt-2.5 pb-1">{GRUPO_LABEL[g.tipo]}</div>
                {g.items.map((r) => (
                  <button
                    key={`${r.tipo}-${r.id}`}
                    onClick={() => ir(r)}
                    className="flex w-full flex-col items-start px-4 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <span className="text-gray-900">{r.label}</span>
                    <span className="text-xs text-gray-400">{r.sublabel}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
