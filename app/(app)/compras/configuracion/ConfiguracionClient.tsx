"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fechaHora } from "@/lib/compras/constants";
import type { Sincronizacion } from "@/lib/compras/types";

export default function ConfiguracionClient({
  sincronizaciones, aprobadores, usuarios, pendientes, nuevosApp, nuevosPlanilla, abiertos, abiertosGestionados, gestionados, total,
}: {
  sincronizaciones: Sincronizacion[];
  aprobadores: { id: string; nombre: string; apellido: string; email: string; alias: string | null }[];
  usuarios: { id: string; nombre: string; apellido: string; email: string }[];
  /** Requerimientos cuyo cambio no se pudo escribir en la planilla. */
  pendientes: {
    id: string;
    nro_ri: number;
    descripcion: string;
    sheets_pendiente: string;
    sheets_intentado_en: string | null;
  }[];
  /** RI creados en la app en los últimos 30 días. */
  nuevosApp: number;
  /** RI que en esos 30 días entraron por el formulario de Google. */
  nuevosPlanilla: number;
  /** RI todavía en circulación: ni recibidos ni denegados. */
  abiertos: number;
  abiertosGestionados: number;
  gestionados: number;
  total: number;
}) {
  const router = useRouter();
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function sincronizar() {
    setSincronizando(true);
    setError("");
    setResultado(null);

    const res = await fetch("/api/compras/sheets/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo sincronizar con la planilla.");
      return;
    }
    setResultado(
      `Se leyeron ${body.filas_leidas} filas: ${body.filas_nuevas} nuevas, ` +
      `${body.filas_actualizadas} actualizadas y ${body.filas_omitidas} omitidas por estar ya gestionadas acá.`
    );
    router.refresh();
  }

  const ultima = sincronizaciones[0];

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Configuración de Compras</h1>
        <p className="text-sm text-slate-500">Sincronización con la planilla de Google Sheets</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Cómo conviven la planilla y el sistema
        </h2>
        <ul className="space-y-1.5 text-sm leading-relaxed text-slate-700">
          <li>· <strong>La planilla manda en el alta.</strong> Los RI nuevos siguen entrando por el formulario y el sistema los incorpora.</li>
          <li>· <strong>El sistema manda en lo que gestiona.</strong> Apenas se aprueba, se elige proveedor o se carga un costo acá, ese RI queda marcado y la planilla ya no puede pisarlo.</li>
          <li>· Los cambios de compra hechos acá se escriben de vuelta en la pestaña del área correspondiente.</li>
        </ul>

        <div className="mt-5 space-y-5">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-slate-700">Por dónde entran los pedidos nuevos</span>
              <span className="text-xs text-slate-500">últimos 30 días</span>
            </div>

            {nuevosApp + nuevosPlanilla === 0 ? (
              <p className="text-sm text-slate-400">No entró ningún pedido nuevo en este período.</p>
            ) : (
              <>
                <Barra
                  partes={[
                    { valor: nuevosApp, color: "var(--primary)", etiqueta: "por el sistema" },
                    { valor: nuevosPlanilla, color: "#CBD5E1", etiqueta: "por la planilla" },
                  ]}
                />
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                  <Leyenda color="var(--primary)" texto={`${nuevosApp} por el sistema`} />
                  <Leyenda color="#CBD5E1" texto={`${nuevosPlanilla} por la planilla`} />
                </div>
              </>
            )}

            <p className="mt-2 text-xs text-slate-500">
              Éste es el indicador que decide. Cuando la barra sea toda verde, la planilla
              dejó de usarse para cargar y se puede apagar la sincronización.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-slate-700">Pedidos abiertos gestionados desde acá</span>
              <span className="font-mono text-slate-900">
                {abiertosGestionados} / {abiertos}
              </span>
            </div>
            <Barra
              partes={[
                { valor: abiertosGestionados, color: "var(--primary)", etiqueta: "gestionados" },
                { valor: Math.max(abiertos - abiertosGestionados, 0), color: "#E2E8F0", etiqueta: "sin tocar" },
              ]}
            />
            <p className="mt-2 text-xs text-slate-500">
              Sólo cuenta lo que sigue en circulación. Los {total.toLocaleString("es-AR")} del
              histórico incluyen pedidos ya cerrados hace meses que nadie va a volver a tocar:
              medirlos contra el total no diría nada.
              {gestionados > abiertosGestionados &&
                ` En total hay ${gestionados} requerimientos tocados desde el sistema, contando los ya cerrados.`}
            </p>
          </div>
        </div>
      </section>

      {pendientes.length > 0 && <PanelPendientes pendientes={pendientes} />}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Quiénes pueden aprobar
        </h2>
        <p className="mb-3 text-sm text-slate-600">
          Esta lista tiene que coincidir con los editores de la protección
          «APROBACIÓN DE GERENCIA» de la planilla. Son los dos lados del mismo
          control: si acá hay alguien que allá no está, la app aprobaría algo que
          la planilla no dejaría aprobar.
        </p>

        {aprobadores.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Nadie puede aprobar todavía: ni los requerimientos ni las compras.
            Sumá acá abajo a quienes aprueban en la planilla.
          </p>
        ) : (
          <ul className="space-y-2">
            {aprobadores.map((a) => (
              <FilaAprobador key={a.id} aprobador={a} soloQueda={aprobadores.length === 1} />
            ))}
          </ul>
        )}

        <SumarAprobador
          usuarios={usuarios.filter((u) => !aprobadores.some((a) => a.id === u.id))}
        />

        <p className="mt-3 text-xs text-slate-500">
          El <strong>alias</strong> es con el que la persona figura en el desplegable de la
          planilla. Sin él, la aprobación no se escribe: se avisa y queda para corregir a
          mano, en vez de meter un texto que la validación rechaza.
        </p>

        <p className="mt-2 text-xs text-slate-500">
          <strong>Estar en esta lista es el permiso de aprobar</strong>, tanto los
          requerimientos como las compras. No depende del nivel de acceso: ser
          administrador —del módulo o del sistema— no alcanza. Administrar es
          configurar; aprobar es autorizar plata, y las hacen personas distintas.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sincronización manual</h2>
            <p className="mt-1 text-sm text-slate-500">
              {ultima
                ? `Última corrida: ${fechaHora(ultima.created_at)} (${ultima.origen})`
                : "Todavía no se ejecutó ninguna sincronización."}
              <br />
              Además corre automáticamente cada 2 horas.
            </p>
          </div>
          <button
            onClick={sincronizar}
            disabled={sincronizando}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
        </div>

        {resultado && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {resultado}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="px-5 pt-5 pb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Últimas sincronizaciones
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Cuándo</th>
                <th className="px-3 py-2 text-left">Origen</th>
                <th className="px-3 py-2 text-right">Leídas</th>
                <th className="px-3 py-2 text-right">Nuevas</th>
                <th className="px-3 py-2 text-right">Actualiz.</th>
                <th className="px-3 py-2 text-right">Omitidas</th>
                <th className="px-3 py-2 text-left">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sincronizaciones.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Sin sincronizaciones registradas.</td></tr>
              ) : (
                sincronizaciones.map((s) => (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{fechaHora(s.created_at)}</td>
                    <td className="px-3 py-2 text-slate-600">{s.origen}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.filas_leidas}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.filas_nuevas}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.filas_actualizadas}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{s.filas_omitidas}</td>
                    <td className={`px-3 py-2 ${s.error ? "text-red-600" : "text-slate-600"}`}>
                      {s.error ?? `OK${s.duracion_ms ? ` · ${(s.duracion_ms / 1000).toFixed(1)}s` : ""}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * Barra de proporción. Se le da un ancho mínimo a cada parte con valor, para
 * que un 3% siga leyéndose como una barra y no como un punto perdido.
 */
function Barra({ partes }: { partes: { valor: number; color: string; etiqueta: string }[] }) {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  if (total === 0) return null;

  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
      {partes.map((p, i) =>
        p.valor === 0 ? null : (
          <div
            key={i}
            title={`${p.valor} ${p.etiqueta}`}
            className="h-full transition-all"
            style={{
              width: `${(p.valor / total) * 100}%`,
              minWidth: 6,
              background: p.color,
            }}
          />
        )
      )}
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-600">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {texto}
    </span>
  );
}

/**
 * Sumar a alguien a la lista.
 *
 * Estar en la lista es el permiso de aprobar, así que esto no es configurar un
 * alias: es dar permiso. El alias se carga después, en la fila.
 */
function SumarAprobador({
  usuarios,
}: {
  usuarios: { id: string; nombre: string; apellido: string; email: string }[];
}) {
  const router = useRouter();
  const [elegido, setElegido] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function sumar() {
    setGuardando(true);
    setError("");
    const res = await fetch("/api/compras/aprobadores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: elegido }),
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo sumar.");
      return;
    }
    setElegido("");
    router.refresh();
  }

  if (usuarios.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={elegido}
          onChange={(e) => setElegido(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Sumar a alguien…</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.nombre} {u.apellido}</option>
          ))}
        </select>
        <button
          onClick={sumar}
          disabled={!elegido || guardando}
          className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
        >
          {guardando ? "Sumando…" : "Sumar a la lista"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Una persona que puede aprobar, con su alias en la planilla. */
function FilaAprobador({
  aprobador, soloQueda,
}: {
  aprobador: { id: string; nombre: string; apellido: string; email: string; alias: string | null };
  /** Si es el último, quitarlo dejaría a nadie aprobando. */
  soloQueda: boolean;
}) {
  const router = useRouter();
  const [alias, setAlias] = useState(aprobador.alias ?? "");
  const [opciones, setOpciones] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // Las opciones se leen de la planilla: si suman un aprobador allá, aparece acá.
  useEffect(() => {
    fetch("/api/compras/sheets/opciones")
      .then((r) => r.json())
      .then((d) => setOpciones(d.opciones ?? []))
      .catch(() => setOpciones([]));
  }, []);

  // De "APROBADA (MAXI)" interesa sólo el alias.
  const sugeridos = [
    ...new Set(
      opciones
        .map((o) => o.match(/\(([^)]+)\)/)?.[1])
        .filter((v): v is string => Boolean(v))
    ),
  ];

  async function guardar(valor: string) {
    setGuardando(true);
    setError("");
    const res = await fetch("/api/compras/aprobadores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id: aprobador.id, alias_planilla: valor }),
    });
    setGuardando(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "No se pudo guardar.");
      return;
    }
    router.refresh();
  }

  async function quitar() {
    if (!confirm(`¿Sacar a ${aprobador.nombre} de la lista? Deja de poder aprobar.`)) return;
    setGuardando(true);
    setError("");
    const res = await fetch(`/api/compras/aprobadores?usuario_id=${aprobador.id}`, {
      method: "DELETE",
    });
    setGuardando(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "No se pudo quitar.");
      return;
    }
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-slate-900">{aprobador.nombre} {aprobador.apellido}</span>
      <span className="font-mono text-xs text-slate-500">{aprobador.email}</span>

      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-slate-500">alias:</span>
        <input
          list={`alias-${aprobador.id}`}
          className="w-28 rounded border border-slate-300 px-2 py-1 font-mono text-xs uppercase"
          value={alias}
          disabled={guardando}
          placeholder="sin definir"
          onChange={(e) => setAlias(e.target.value.toUpperCase())}
          onBlur={() => alias !== (aprobador.alias ?? "") && guardar(alias)}
        />
        <datalist id={`alias-${aprobador.id}`}>
          {sugeridos.map((o) => <option key={o} value={o} />)}
        </datalist>
        {!aprobador.alias && (
          <span className="text-xs text-amber-700">falta</span>
        )}

        <button
          onClick={quitar}
          disabled={guardando || soloQueda}
          title={soloQueda ? "Es el único que puede aprobar" : "Sacar de la lista"}
          className="text-xs text-slate-400 hover:text-red-600 disabled:cursor-not-allowed disabled:hover:text-slate-400"
        >
          Quitar
        </button>
      </span>

      {error && <span className="w-full text-xs text-red-600">{error}</span>}
    </li>
  );
}

/**
 * Cambios hechos en el sistema que la planilla rechazó.
 *
 * Se muestran arriba de todo porque son la única forma de enterarse: el
 * requerimiento ya quedó aprobado, así que su ficha no vuelve a ofrecer la
 * acción, y sin esta lista la diferencia entre las dos herramientas quedaría
 * invisible.
 */
function PanelPendientes({
  pendientes,
}: {
  pendientes: {
    id: string;
    nro_ri: number;
    descripcion: string;
    sheets_pendiente: string;
    sheets_intentado_en: string | null;
  }[];
}) {
  const router = useRouter();
  const [reintentando, setReintentando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  async function reintentar() {
    setReintentando(true);
    setResultado(null);
    const res = await fetch("/api/compras/sheets/reintentar", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setReintentando(false);

    if (!res.ok) {
      setResultado(body.error ?? "No se pudo reintentar.");
      return;
    }
    setResultado(
      body.resueltos > 0
        ? `Se escribieron ${body.resueltos} de ${body.intentados}.` +
          (body.siguenPendientes > 0 ? ` Quedan ${body.siguenPendientes}.` : "")
        : "La planilla los sigue rechazando por el mismo motivo."
    );
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-amber-900">
            {pendientes.length} {pendientes.length === 1 ? "cambio" : "cambios"} sin reflejar en la planilla
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            Están guardados acá, pero la planilla los rechazó. Corregí el motivo
            —cargar el alias que falta, o dar permiso sobre la celda— y reintentá.
          </p>
        </div>
        <button
          onClick={reintentar}
          disabled={reintentando}
          className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {reintentando ? "Reintentando…" : "Reintentar"}
        </button>
      </div>

      {resultado && <p className="mt-3 text-sm text-amber-900">{resultado}</p>}

      <ul className="mt-3 space-y-1.5">
        {pendientes.map((p) => (
          <li key={p.id} className="text-sm">
            <Link
              href={`/compras/requerimientos/${p.id}`}
              className="font-mono text-xs font-semibold text-amber-900 hover:underline"
            >
              RI {p.nro_ri}
            </Link>
            <span className="ml-2 text-slate-700">{p.descripcion}</span>
            <div className="text-xs text-amber-800">{p.sheets_pendiente}</div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-amber-800">
        El reintento también corre solo en cada sincronización, así que si el
        motivo se resuelve afuera se acomodan sin que nadie haga nada.
      </p>
    </section>
  );
}
