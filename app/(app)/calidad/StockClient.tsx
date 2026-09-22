"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import { hoyEnArgentina } from "@/lib/core/fechas";
import type { UltimaSync } from "@/lib/core/sincronizaciones";
import type { LineaSinReconocer, TipoDeCarbon, TipoDeMovimiento } from "@/lib/calidad/types";

export interface FilaDelLibro {
  id: string;
  fecha: string;
  tipo: TipoDeMovimiento;
  carbon: TipoDeCarbon;
  toneladas: number;
  motivo: string | null;
  origen: string;
  orden: string | null;
  carbonillero_id: string | null;
  sheets_pendiente: string | null;
  saldoVegetal: number;
  saldoResidual: number;
  saldoTotal: number;
}

const ETIQUETA_DE_ORIGEN: Record<string, string> = {
  odoo: "Odoo",
  recepcion: "Balanza",
  manual: "A mano",
  importacion: "Importado",
};

/** Con coma, que es como se lee acá. */
function t(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a.slice(2)}`;
}

/**
 * El stock de carbonilla.
 *
 * Un solo botón grande, el del consumo del día: es lo que se hace 224 de 256
 * días. Contar y ajustar están, pero más chicos.
 *
 * El aviso del último consumo va en letra chica y **no como cartel rojo**: hay
 * 32 días al año sin consumo, y un cartel que grita todos los días deja de
 * leerse.
 */
export default function StockClient({
  puedeEditar,
  saldos,
  ultimaFecha,
  ultimoConsumo,
  libro,
  carbonilleros,
  bandeja,
  sync,
}: {
  puedeEditar: boolean;
  saldos: { vegetal: number; residual: number; total: number };
  ultimaFecha: string | null;
  ultimoConsumo: { vegetal: string | null; residual: string | null };
  libro: FilaDelLibro[];
  carbonilleros: { id: string; nombre: string; carbon: "vegetal" | "residual" }[];
  bandeja: LineaSinReconocer[];
  sync: UltimaSync | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<null | "consumo" | "conteo" | "ajuste" | "entrada">(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  async function mandar(url: string, cuerpo: unknown, metodo = "POST") {
    setGuardando(true);
    setAviso(null);
    setFallo(false);
    const res = await fetch(url, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) {
      setFallo(true);
      setAviso(body.error ?? "No se pudo guardar.");
      return null;
    }
    setAbierto(null);
    // El aviso del espejo no es un error: el dato se guardó igual.
    if (body.aviso) setAviso(body.aviso);
    router.refresh();
    return body;
  }

  async function sincronizar() {
    const body = await mandar("/api/calidad/sincronizar", {});
    if (body) {
      setAviso(
        `Leídas ${body.leidas} líneas de Odoo · ${body.nuevas} entradas nuevas · ` +
          `${body.yaEstaban} ya estaban · ${body.descartadas} descartadas · ` +
          `${body.aLaBandeja} sin reconocer` +
          (body.cambiadasEnOdoo ? ` · ${body.cambiadasEnOdoo} cambiaron en Odoo` : "")
      );
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Stock de carbonilla</h1>
          <p className="text-sm text-slate-500">
            {ultimaFecha
              ? `Último movimiento: ${comoSeLee(ultimaFecha)}`
              : "Todavía no hay movimientos cargados."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <UltimaSincronizacion
            cuando={sync?.created_at}
            ok={sync?.ok ?? true}
            error={sync?.error}
            que="Odoo leído"
          />
          {puedeEditar && (
            <button
              onClick={sincronizar}
              disabled={guardando}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Sincronizar ahora
            </button>
          )}
        </div>
      </div>

      {/* Los dos saldos, que es a lo que se entra */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Saldo titulo="Vegetal" valor={saldos.vegetal} desde={ultimoConsumo.vegetal} />
        <Saldo titulo="Residual" valor={saldos.residual} desde={ultimoConsumo.residual} />
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{t(saldos.total)}</p>
          <p className="text-xs text-slate-400">toneladas</p>
        </div>
      </div>

      {aviso && (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            fallo
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {aviso}
        </p>
      )}

      {puedeEditar && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setAbierto(abierto === "consumo" ? null : "consumo")}
            className="rounded-lg bg-slate-900 px-5 py-3 text-base font-semibold text-white hover:bg-slate-800"
          >
            Cargar consumo del día
          </button>
          <button
            onClick={() => setAbierto(abierto === "conteo" ? null : "conteo")}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Contar stock
          </button>
          <button
            onClick={() => setAbierto(abierto === "ajuste" ? null : "ajuste")}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cargar ajuste
          </button>
          <button
            onClick={() => setAbierto(abierto === "entrada" ? null : "entrada")}
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Entrada a mano
          </button>
        </div>
      )}

      {abierto === "consumo" && (
        <Formulario titulo="Consumo del día" guardando={guardando}>
          {(datos) => mandar("/api/calidad/movimientos", { ...datos, tipo: "consumo" })}
        </Formulario>
      )}
      {abierto === "ajuste" && (
        <Formulario titulo="Ajuste" guardando={guardando} conMotivo conSigno>
          {(datos) => mandar("/api/calidad/movimientos", { ...datos, tipo: "ajuste" })}
        </Formulario>
      )}
      {abierto === "entrada" && (
        <Formulario titulo="Entrada a mano" guardando={guardando} carbonilleros={carbonilleros}>
          {(datos) => mandar("/api/calidad/movimientos", { ...datos, tipo: "entrada" })}
        </Formulario>
      )}
      {abierto === "conteo" && <Conteo guardando={guardando} mandar={mandar} />}

      {/* La bandeja sólo existe cuando tiene algo: 361 días al año no está */}
      {bandeja.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-bold text-amber-900">
            {bandeja.length} {bandeja.length === 1 ? "línea de Odoo sin reconocer" : "líneas de Odoo sin reconocer"}
          </h2>
          <p className="mt-0.5 text-xs text-amber-800">
            No entraron al stock. Se resuelven en{" "}
            <Link href="/calidad/carbonilleros" className="underline">
              Carbonilleros
            </Link>{" "}
            o en{" "}
            <Link href="/calidad/productos" className="underline">
              Productos
            </Link>
            .
          </p>
          <ul className="mt-2 space-y-1 text-xs text-amber-900">
            {bandeja.map((l) => (
              <li key={l.odoo_purchase_line_id}>
                <span className="font-mono">{l.odoo_purchase_name}</span> · {comoSeLee(l.fecha)} ·{" "}
                {t(Number(l.toneladas))} t — {l.motivo}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* El libro reciente */}
      <section>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-slate-900">Últimos movimientos</h2>
          <Link href="/calidad/movimientos" className="text-sm text-slate-600 underline">
            Ver el libro entero
          </Link>
        </div>
        <div className="mt-2 overflow-x-auto card">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Qué</th>
                <th className="px-3 py-2 text-right">Toneladas</th>
                <th className="px-3 py-2 text-right">Vegetal</th>
                <th className="px-3 py-2 text-right">Residual</th>
                <th className="px-3 py-2">Origen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {libro.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Todavía no hay movimientos. Hasta que corra la importación, el libro está vacío.
                  </td>
                </tr>
              )}
              {libro.map((f) => (
                <tr key={f.id} className={f.sheets_pendiente ? "bg-amber-50" : undefined}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{comoSeLee(f.fecha)}</td>
                  <td className="px-3 py-1.5">
                    <span className="text-slate-900">
                      {f.tipo === "entrada"
                        ? carbonilleros.find((c) => c.id === f.carbonillero_id)?.nombre ?? "Entrada"
                        : f.tipo === "consumo"
                          ? `Consumo ${f.carbon}`
                          : `Ajuste ${f.carbon}`}
                    </span>
                    {f.motivo && <span className="ml-1 text-xs text-slate-500">— {f.motivo}</span>}
                    {f.orden && <span className="ml-1 font-mono text-xs text-slate-400">{f.orden}</span>}
                    {f.sheets_pendiente && (
                      <span className="ml-1 text-xs text-amber-700">· {f.sheets_pendiente}</span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      f.toneladas < 0 ? "text-slate-500" : "font-semibold text-slate-900"
                    }`}
                  >
                    {t(f.toneladas)}
                  </td>
                  {/* Los sin_separar no tienen saldo, y va en blanco y no en cero:
                      un cero se lee como "no había carbón". */}
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {f.carbon === "sin_separar" ? "" : t(f.saldoVegetal)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {f.carbon === "sin_separar" ? "" : t(f.saldoResidual)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-400">
                    {ETIQUETA_DE_ORIGEN[f.origen] ?? f.origen}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Saldo({
  titulo,
  valor,
  desde,
}: {
  titulo: string;
  valor: number;
  desde: string | null;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>
      <p
        className={`mt-1 text-3xl font-bold tabular-nums ${
          valor < 0 ? "text-red-600" : "text-slate-900"
        }`}
      >
        {t(valor)}
      </p>
      <p className="text-xs text-slate-400">
        toneladas
        {desde && ` · último consumo ${comoSeLee(desde)}`}
      </p>
    </div>
  );
}

/** El alta de un movimiento: tipo de carbón, toneladas, y lo que haga falta. */
function Formulario({
  titulo,
  guardando,
  conMotivo,
  conSigno,
  carbonilleros,
  children,
}: {
  titulo: string;
  guardando: boolean;
  conMotivo?: boolean;
  conSigno?: boolean;
  carbonilleros?: { id: string; nombre: string; carbon: "vegetal" | "residual" }[];
  children: (datos: Record<string, unknown>) => Promise<unknown>;
}) {
  const [fecha, setFecha] = useState(hoyEnArgentina());
  const [carbon, setCarbon] = useState<"vegetal" | "residual">("vegetal");
  const [toneladas, setToneladas] = useState("");
  const [motivo, setMotivo] = useState("");
  const [carbonillero, setCarbonillero] = useState("");

  const elegido = carbonilleros?.find((c) => c.id === carbonillero);

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-300 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        children({
          fecha,
          // En una entrada el tipo de carbón lo decide el carbonillero, no quien carga.
          carbon: elegido ? elegido.carbon : carbon,
          toneladas: Number(toneladas.replace(",", ".")),
          motivo: conMotivo ? motivo : undefined,
          carbonillero_id: carbonilleros ? carbonillero : undefined,
        });
      }}
    >
      <p className="text-sm font-bold text-slate-900">{titulo}</p>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-slate-600">
          Fecha
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>

        {carbonilleros ? (
          <label className="text-xs text-slate-600">
            Carbonillero
            <select
              value={carbonillero}
              onChange={(e) => setCarbonillero(e.target.value)}
              required
              className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">Elegir…</option>
              {carbonilleros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({c.carbon})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-xs text-slate-600">
            Carbón
            <select
              value={carbon}
              onChange={(e) => setCarbon(e.target.value as "vegetal" | "residual")}
              className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="vegetal">Vegetal</option>
              <option value="residual">Residual</option>
            </select>
          </label>
        )}

        <label className="text-xs text-slate-600">
          Toneladas
          <input
            value={toneladas}
            onChange={(e) => setToneladas(e.target.value)}
            inputMode="decimal"
            required
            placeholder={conSigno ? "−46 o 232,5" : "37"}
            className="mt-0.5 block w-32 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums"
          />
        </label>
      </div>

      {conSigno && (
        <p className="text-xs text-slate-500">
          El signo es el que va: en menos si falta carbón, en más si sobra.
        </p>
      )}

      {conMotivo && (
        <label className="block text-xs text-slate-600">
          Motivo (obligatorio)
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
            placeholder="Ajuste por desvío cero y span de la balanza"
            className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      )}

      <button
        type="submit"
        disabled={guardando}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Guardar
      </button>
    </form>
  );
}

/** El conteo físico: se carga, se ve el desvío, y recién ahí se explica. */
function Conteo({
  guardando,
  mandar,
}: {
  guardando: boolean;
  mandar: (url: string, cuerpo: unknown, metodo?: string) => Promise<Record<string, unknown> | null>;
}) {
  const [fecha, setFecha] = useState(hoyEnArgentina());
  const [carbon, setCarbon] = useState<"vegetal" | "residual">("vegetal");
  const [contadas, setContadas] = useState("");
  const [motivo, setMotivo] = useState("");
  const [desvio, setDesvio] = useState<number | null>(null);

  return (
    <form
      className="space-y-3 rounded-lg border border-slate-300 bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await mandar("/api/calidad/conteos", {
          fecha,
          carbon,
          toneladas_contadas: Number(contadas.replace(",", ".")),
          motivo: motivo || undefined,
        });
        // Sin motivo, el conteo se guarda igual y acá aparece el desvío para
        // que se lo explique. Un motivo de relleno es peor que ninguno.
        if (r && !r.ajustado && r.desvio) setDesvio(Number(r.desvio));
        if (r && r.ajustado) setDesvio(null);
      }}
    >
      <p className="text-sm font-bold text-slate-900">Conteo físico</p>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-slate-600">
          Fecha
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          Carbón
          <select
            value={carbon}
            onChange={(e) => setCarbon(e.target.value as "vegetal" | "residual")}
            className="mt-0.5 block rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="vegetal">Vegetal</option>
            <option value="residual">Residual</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Contadas
          <input
            value={contadas}
            onChange={(e) => setContadas(e.target.value)}
            inputMode="decimal"
            required
            className="mt-0.5 block w-32 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums"
          />
        </label>
      </div>

      {desvio !== null && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            El conteo quedó guardado y hay un desvío de{" "}
            <strong className="tabular-nums">{t(desvio)} t</strong> contra el teórico.
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            Escribí por qué y se carga el ajuste. Sin motivo, el conteo queda anotado y el saldo no
            se toca.
          </p>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Por qué falta o sobra ese carbón"
            className="mt-2 block w-full rounded border border-amber-300 px-2 py-1 text-sm"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={guardando}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {desvio === null ? "Guardar conteo" : "Cargar el ajuste"}
      </button>
    </form>
  );
}
