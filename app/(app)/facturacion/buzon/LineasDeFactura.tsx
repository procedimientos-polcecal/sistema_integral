"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Buscador, { type Opcion } from "./Buscador";
import type {
  AnaliticaSugerida,
  CuentaSugerida,
} from "@/app/api/facturacion/facturas/[id]/lineas/route";
import {
  describirDistribucion,
  repartirEnPartesIguales,
  revisarDistribucion,
  type DistribucionAnalitica,
  type LineaDeFactura,
} from "@/lib/facturacion/lineas";

/**
 * El detalle de una factura: qué productos trae y cómo se imputa cada uno.
 *
 * Tres cosas que están separadas a propósito, porque tienen dueños distintos:
 *
 * - **Lo que dice el papel** (descripción, cantidad, precio) se muestra y no se
 *   edita. Si está mal leído, la factura se vuelve a cargar; corregirlo acá
 *   dejaría un detalle que ya no es el comprobante.
 * - **El producto de Odoo** lo propone el sistema y lo corrige una persona. La
 *   corrección se aprende: la próxima factura con esa descripción ya sale bien,
 *   y también las órdenes de compra, que usan la misma tabla.
 * - **La cuenta y la distribución analítica** las pone una persona siempre. El
 *   comprobante no dice a qué equipo fue un repuesto, y adivinarlo sería poner
 *   el gasto en el lugar equivocado sin que nadie se entere.
 */

interface Catalogos {
  productos: { id: number; nombre: string }[];
  cuentas: { id: number; codigo: string; nombre: string }[];
  analiticas: { id: number; nombre: string; plan: string | null }[];
}

export default function LineasDeFactura({
  facturaId,
  puedeEditar,
  onCerrar,
}: {
  facturaId: string;
  puedeEditar: boolean;
  onCerrar: () => void;
}) {
  const [lineas, setLineas] = useState<LineaDeFactura[] | null>(null);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [detalleLeido, setDetalleLeido] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<CuentaSugerida[]>([]);
  const [analiticasSugeridas, setAnaliticasSugeridas] = useState<AnaliticaSugerida[]>([]);
  const [aplicando, setAplicando] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const traer = useCallback(async () => {
    const r = await fetch(`/api/facturacion/facturas/${facturaId}/lineas`);
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(datos.error ?? "No se pudo traer el detalle.");
      return;
    }
    setLineas(datos.lineas ?? []);
    setCatalogos(datos.catalogos ?? null);
    setDetalleLeido(datos.detalleLeido ?? null);
    setSugerencias(datos.sugerencias ?? []);
    setAnaliticasSugeridas(datos.sugerenciasDeAnalitica ?? []);
    setMotivo(datos.motivo ?? null);
  }, [facturaId]);

  useEffect(() => {
    void traer();
  }, [traer]);

  const nombresAnaliticos = useMemo(
    () => new Map((catalogos?.analiticas ?? []).map((a) => [a.id, a.nombre])),
    [catalogos]
  );

  const suma = (lineas ?? []).reduce((a, l) => a + Number(l.total ?? 0), 0);

  /** Guardar una cuenta sugerida. Es la misma ruta que usa el buscador a mano. */
  const usarLaCuenta = useCallback(
    async (lineaId: string, s: CuentaSugerida) => {
      const r = await fetch(`/api/facturacion/facturas/${facturaId}/lineas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linea_id: lineaId,
          odoo_account_id: s.cuentaId,
          odoo_account_nombre: s.nombre,
        }),
      });
      if (!r.ok) return false;
      const datos = await r.json().catch(() => ({}));
      setLineas((antes) => (antes ?? []).map((l) => (l.id === datos.linea?.id ? datos.linea : l)));
      setSugerencias((antes) => antes.filter((x) => x.lineaId !== lineaId));
      return true;
    },
    [facturaId]
  );

  /** Guardar una distribución sugerida. Misma ruta que el reparto a mano. */
  const usarLaAnalitica = useCallback(
    async (lineaId: string, s: AnaliticaSugerida) => {
      const r = await fetch(`/api/facturacion/facturas/${facturaId}/lineas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linea_id: lineaId,
          analitica: s.analitica,
          analitica_nombres: Object.fromEntries(
            Object.keys(s.analitica).map((id) => [
              id,
              (catalogos?.analiticas ?? []).find((a) => String(a.id) === id)?.nombre ?? `#${id}`,
            ])
          ),
        }),
      });
      if (!r.ok) return false;
      const datos = await r.json().catch(() => ({}));
      setLineas((antes) => (antes ?? []).map((l) => (l.id === datos.linea?.id ? datos.linea : l)));
      setAnaliticasSugeridas((antes) => antes.filter((x) => x.lineaId !== lineaId));
      return true;
    },
    [facturaId, catalogos]
  );

  async function aplicarTodas() {
    setAplicando(true);
    // De a una y en orden: son pocas, y así una que falle no arrastra al resto.
    for (const s of [...sugerencias]) await usarLaCuenta(s.lineaId, s);
    for (const s of [...analiticasSugeridas]) await usarLaAnalitica(s.lineaId, s);
    setAplicando(false);
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          El detalle del comprobante
          {lineas && <span className="ml-2 font-normal text-slate-400">{lineas.length} líneas</span>}
        </h4>
        <button onClick={onCerrar} className="text-xs text-slate-400 underline">
          cerrar
        </button>
      </div>

      {/*
        * Que el detalle no cuadre no se esconde: es la razón por la que el
        * borrador de Odoo va a salir con una línea sola, y sin decirlo la
        * pregunta "¿por qué ésta sí y aquélla no?" no tiene respuesta.
        */}
      {detalleLeido === "no cuadra" && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          Las líneas que se leyeron no suman el neto del comprobante, así que el borrador de Odoo va
          a ir con una sola línea por el total.
        </p>
      )}
      {detalleLeido === "sin detalle" && (
        <p className="mb-2 text-xs text-slate-500">
          De este comprobante no se pudo leer el detalle: el borrador va con una línea por el total.
        </p>
      )}
      {motivo && <p className="mb-2 text-xs text-slate-500">{motivo}</p>}
      {error && <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{error}</p>}

      {lineas === null ? (
        <p className="text-xs text-slate-400">Trayendo el detalle…</p>
      ) : lineas.length === 0 ? (
        <p className="text-xs text-slate-400">Esta factura no tiene detalle cargado.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {lineas.map((linea) => (
              <Linea
                key={linea.id}
                linea={linea}
                catalogos={catalogos}
                nombresAnaliticos={nombresAnaliticos}
                sugerencia={sugerencias.find((s) => s.lineaId === linea.id) ?? null}
                sugerenciaDeAnalitica={
                  analiticasSugeridas.find((s) => s.lineaId === linea.id) ?? null
                }
                onUsarLaCuenta={usarLaCuenta}
                onUsarLaAnalitica={usarLaAnalitica}
                puedeEditar={puedeEditar}
                onGuardada={(nueva) =>
                  setLineas((antes) =>
                    (antes ?? []).map((l) => (l.id === nueva.id ? nueva : l))
                  )
                }
              />
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {/*
              * Aplicar todas de un clic es el punto: la sugerencia acierta el
              * 89% de las veces, así que revisar y aceptar en bloque es más
              * rápido que elegir una por una, y cada propuesta sigue mostrando
              * su antecedente al lado para poder no aceptarla.
              */}
            {sugerencias.length + analiticasSugeridas.length > 1 ? (
              <button
                disabled={aplicando}
                onClick={aplicarTodas}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {aplicando
                  ? "Aplicando…"
                  : `Usar las ${sugerencias.length + analiticasSugeridas.length} sugerencias`}
              </button>
            ) : (
              <span />
            )}
            <p className="text-xs text-slate-500">
              Suman {suma.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function Linea({
  linea,
  catalogos,
  nombresAnaliticos,
  sugerencia,
  sugerenciaDeAnalitica,
  onUsarLaCuenta,
  onUsarLaAnalitica,
  puedeEditar,
  onGuardada,
}: {
  linea: LineaDeFactura;
  catalogos: Catalogos | null;
  nombresAnaliticos: Map<number, string>;
  /** Lo que el historial del proveedor dice que correspondería. */
  sugerencia: CuentaSugerida | null;
  onUsarLaCuenta: (lineaId: string, s: CuentaSugerida) => Promise<boolean>;
  /** Lo que el equipo del RI —o el historial— dice que correspondería. */
  sugerenciaDeAnalitica: AnaliticaSugerida | null;
  onUsarLaAnalitica: (lineaId: string, s: AnaliticaSugerida) => Promise<boolean>;
  puedeEditar: boolean;
  onGuardada: (linea: LineaDeFactura) => void;
}) {
  const [analitica, setAnalitica] = useState<DistribucionAnalitica>(linea.analitica ?? {});
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  /*
   * Los tres catálogos se convierten una vez por línea y no en cada tecla: son
   * 378 + 242 + 358 filas, y rehacerlas mientras alguien escribe se nota.
   */
  const opcionesDeProducto = useMemo<Opcion[]>(
    () => (catalogos?.productos ?? []).map((p) => ({ id: p.id, texto: p.nombre })),
    [catalogos]
  );
  const opcionesDeCuenta = useMemo<Opcion[]>(
    () => (catalogos?.cuentas ?? []).map((c) => ({ id: c.id, texto: `${c.codigo} ${c.nombre}` })),
    [catalogos]
  );
  // Agrupadas por plan: sin el plan —EQUIPOS MÓVILES, MANTENIMIENTO— una lista
  // de 358 nombres sueltos no se recorre.
  const opcionesDeAnalitica = useMemo<Opcion[]>(
    () => (catalogos?.analiticas ?? []).map((a) => ({ id: a.id, texto: a.nombre, grupo: a.plan })),
    [catalogos]
  );

  async function guardar(cambios: Record<string, unknown>) {
    setGuardando(true);
    setAviso(null);
    const r = await fetch(`/api/facturacion/facturas/${linea.factura_id}/lineas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linea_id: linea.id, ...cambios }),
    });
    const datos = await r.json().catch(() => ({}));
    setGuardando(false);
    if (!r.ok) {
      setAviso(datos.error ?? "No se pudo guardar.");
      return;
    }
    onGuardada(datos.linea);
  }

  function agregarAnalitica(id: string) {
    if (!id) return;
    const ids = [...Object.keys(analitica).map(Number), Number(id)];
    setAnalitica(repartirEnPartesIguales([...new Set(ids)]));
  }

  function sacarAnalitica(id: string) {
    const ids = Object.keys(analitica).map(Number).filter((n) => n !== Number(id));
    setAnalitica(repartirEnPartesIguales(ids));
  }

  function guardarAnalitica() {
    const problema = revisarDistribucion(analitica);
    if (problema) {
      setAviso(problema);
      return;
    }
    void guardar({
      analitica,
      analitica_nombres: Object.fromEntries(
        Object.keys(analitica).map((id) => [id, nombresAnaliticos.get(Number(id)) ?? `#${id}`])
      ),
    });
  }

  const sinGuardar =
    JSON.stringify(analitica) !== JSON.stringify(linea.analitica ?? {});

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{linea.descripcion}</span>
        <span className="text-xs text-slate-500">
          {linea.cantidad} × {Number(linea.precio_unitario ?? 0).toLocaleString("es-AR")} ={" "}
          <strong>{Number(linea.total ?? 0).toLocaleString("es-AR")}</strong>
        </span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Buscador
          etiqueta={
            <>
              Producto
              {/* De dónde salió: lo propuso una regla, lo aprendió de una
                  corrección anterior, o lo eligió una persona. */}
              {linea.producto_origen && (
                <span className="ml-1 normal-case">· {linea.producto_origen}</span>
              )}
            </>
          }
          opciones={opcionesDeProducto}
          valor={linea.odoo_product_id}
          textoDelValor={linea.odoo_product_nombre}
          deshabilitado={!puedeEditar || guardando || !catalogos}
          vacio="— sin producto —"
          onElegir={(o) =>
            void guardar({
              odoo_product_id: o?.id ?? null,
              odoo_product_nombre: o?.texto ?? null,
            })
          }
        />

        <div>
          <Buscador
            etiqueta="Cuenta"
            opciones={opcionesDeCuenta}
            valor={linea.odoo_account_id}
            textoDelValor={linea.odoo_account_nombre}
            deshabilitado={!puedeEditar || guardando || !catalogos}
            vacio="— la que ponga Odoo —"
            onElegir={(o) =>
              void guardar({
                odoo_account_id: o?.id ?? null,
                odoo_account_nombre: o?.texto ?? null,
              })
            }
          />

          {/*
            * La sugerencia va **con su antecedente a la vista**. Acierta el 89%
            * de las veces: mucho para ahorrar trabajo, poco para decidir sola.
            * Por eso no se pre-llena — hay que aplicarla.
            */}
          {sugerencia && puedeEditar && (
            <div className="mt-1 rounded bg-white px-2 py-1 text-[11px] text-slate-600">
              <button
                disabled={guardando}
                onClick={() => void onUsarLaCuenta(linea.id, sugerencia)}
                className="font-medium text-teal-800 underline disabled:opacity-40"
              >
                Usar {sugerencia.nombre}
              </button>
              <span className="ml-1 text-slate-400">— {sugerencia.porque}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2">
        <span className="block text-[10px] uppercase tracking-wide text-slate-400">
          Distribución analítica
        </span>

        {Object.keys(analitica).length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {Object.entries(analitica)
              .sort((a, b) => b[1] - a[1])
              .map(([id, pct]) => (
                <li
                  key={id}
                  className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                >
                  <span>{nombresAnaliticos.get(Number(id)) ?? `#${id}`}</span>
                  <input
                    type="number"
                    value={pct}
                    step="0.01"
                    disabled={!puedeEditar}
                    onChange={(e) =>
                      setAnalitica((antes) => ({ ...antes, [id]: Number(e.target.value) }))
                    }
                    className="w-16 rounded border border-slate-300 px-1 text-right"
                  />
                  <span>%</span>
                  {puedeEditar && (
                    <button
                      onClick={() => sacarAnalitica(id)}
                      className="text-slate-400 hover:text-rose-600"
                      aria-label="sacar"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
          </ul>
        )}

        {puedeEditar && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="min-w-[14rem]">
              <Buscador
                etiqueta=""
                opciones={opcionesDeAnalitica}
                valor={null}
                deshabilitado={guardando || !catalogos}
                vacio="+ agregar una cuenta analítica…"
                onElegir={(o) => o && agregarAnalitica(String(o.id))}
              />
            </div>

            {sinGuardar && (
              <button
                disabled={guardando}
                onClick={guardarAnalitica}
                className="rounded-lg bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-40"
              >
                Guardar la distribución
              </button>
            )}
          </div>
        )}

        {!Object.keys(analitica).length && linea.analitica_detalle && (
          <p className="text-xs text-slate-500">{linea.analitica_detalle}</p>
        )}

        {/*
          * La sugerencia distingue **certeza de estadística**: cuando sale del
          * equipo del requerimiento no es una probabilidad —el RI dice para qué
          * se compró— y se muestra distinta de la que sale del historial, que
          * acierta el 78% y por eso lleva su antecedente al lado.
          */}
        {sugerenciaDeAnalitica && puedeEditar && !Object.keys(analitica).length && (
          <div
            className={`mt-1 rounded px-2 py-1 text-[11px] ${
              sugerenciaDeAnalitica.esCerteza
                ? "bg-emerald-50 text-emerald-900"
                : "bg-white text-slate-600"
            }`}
          >
            <button
              disabled={guardando}
              onClick={() => void onUsarLaAnalitica(linea.id, sugerenciaDeAnalitica)}
              className="font-medium underline disabled:opacity-40"
            >
              Usar {sugerenciaDeAnalitica.detalle}
            </button>
            <span className="ml-1 opacity-70">— {sugerenciaDeAnalitica.porque}</span>
          </div>
        )}
      </div>

      {aviso && <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{aviso}</p>}
    </li>
  );
}

/** Re-exportado para que la fila del buzón muestre el resumen sin recalcularlo. */
export { describirDistribucion };
