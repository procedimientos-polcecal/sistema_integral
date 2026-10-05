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
import { nombreDelComprobante, nombreDelTipo, numeroFormateado } from "@/lib/facturacion/comprobante";
import type { FacturaEnPantalla } from "@/lib/facturacion/types";

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
  factura,
  puedeEditar,
  onCerrar,
}: {
  facturaId: string;
  /**
   * La factura entera, para la ficha de arriba. Viene de la fila del buzón y
   * no de una consulta nueva: son datos que la pantalla ya tiene en la mano.
   */
  factura: FacturaEnPantalla;
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
    <div className="mt-2 overflow-hidden rounded-lg border border-slate-300 bg-white">
      <FichaDelComprobante factura={factura} onCerrar={onCerrar} />

      <div className="border-t border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-1">
        <h4 className="border-b-2 border-slate-800 pb-1 text-xs font-semibold text-slate-800">
          Líneas de factura
          {lineas && <span className="ml-2 font-normal text-slate-400">{lineas.length}</span>}
        </h4>
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
          {/*
            * Los encabezados de columna sólo en pantalla ancha. Abajo de `lg`
            * cada celda lleva su propia etiqueta —las que trae el buscador— y
            * una tabla de seis columnas no entra sin romperse; es la misma
            * decisión que toma Odoo, que en el teléfono apila la línea.
            */}
          <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.7fr)_minmax(0,1.4fr)_minmax(0,1.9fr)_3.5rem_6rem_6.5rem] lg:gap-2 lg:border-b lg:border-slate-300 lg:px-2 lg:pb-1 lg:text-[10px] lg:font-medium lg:uppercase lg:tracking-wide lg:text-slate-500">
            <span>Producto</span>
            <span>Etiqueta</span>
            <span>Cuenta</span>
            <span>Distribución analítica</span>
            <span className="text-right">Cantidad</span>
            <span className="text-right">Precio</span>
            <span className="text-right">Subtotal</span>
          </div>

          <ul className="divide-y divide-slate-200 border-b border-slate-200 bg-white">
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
            {/*
              * El total abajo a la derecha, como en el formulario de Odoo. Se
              * dice "suman" y no "total": es la suma de las líneas leídas, que
              * puede no ser el total del comprobante — justamente el caso que
              * el aviso de arriba explica.
              */}
            <p className="text-sm text-slate-700">
              <span className="text-xs uppercase tracking-wide text-slate-500">Suman</span>{" "}
              <strong>{suma.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</strong>
            </p>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

/**
 * Una celda numérica de la línea.
 *
 * La etiqueta se ve sólo cuando la tabla está apilada: en pantalla ancha la
 * dice el encabezado de la columna, y repetirla en cada fila sería ruido.
 */
function Numero({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 lg:block lg:text-right">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 lg:hidden">
        {etiqueta}
      </span>
      <span className="text-sm text-slate-700">{children}</span>
    </div>
  );
}

/** Un renglón de la ficha: etiqueta a la izquierda, dato subrayado a la derecha. */
function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-36 shrink-0 text-xs text-slate-500">{etiqueta}</span>
      <span className="min-w-0 grow border-b border-slate-200 pb-0.5 text-sm text-slate-800">
        {children}
      </span>
    </div>
  );
}

/** Cómo se dice en castellano el estado del asiento en Odoo. */
const ESTADO_EN_ODOO: Record<string, string> = {
  draft: "Borrador",
  posted: "Publicado",
  cancel: "Cancelado",
};

/**
 * La cabecera del comprobante, con la forma del formulario de Odoo.
 *
 * Es **lo mismo que ya sabe el buzón**, puesto como lo pone Odoo: dos columnas
 * de etiqueta y dato, y arriba el nombre grande con el estado al lado. No hay
 * ningún campo nuevo ni ninguna columna nueva en la base — quien carga pasa el
 * día entre esta pantalla y la de Odoo, y que las dos se lean igual ahorra la
 * traducción mental en cada factura.
 *
 * **Nada de esto se edita acá, a propósito.** Lo que vino del QR está firmado
 * por ARCA y corregirlo dejaría un registro que ya no es el comprobante; lo que
 * hay que cambiar se cambia volviendo a cargar el archivo. Lo único editable de
 * una factura ya cargada sigue siendo lo de la fila —estado y RI— y el detalle
 * de abajo, que es lo que el papel no dice.
 */
function FichaDelComprobante({
  factura,
  onCerrar,
}: {
  factura: FacturaEnPantalla;
  onCerrar: () => void;
}) {
  const proveedor =
    factura.proveedor ??
    factura.odoo_partner_nombre ??
    (factura.cuit_emisor ? `CUIT ${factura.cuit_emisor}` : null);

  const nombre = nombreDelComprobante({
    tipoComprobante: factura.tipo_comprobante,
    puntoVenta: factura.punto_venta,
    numero: factura.numero,
  });

  return (
    <div className="bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">Factura de proveedor</p>
          <h4 className="truncate text-xl font-semibold text-slate-900">{nombre}</h4>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/*
            * El estado del asiento, con la misma forma de dos pasos que usa
            * Odoo. Si la factura todavía no llegó allá no se inventa un paso:
            * se dice que no hay asiento, que es distinto de "borrador".
            */}
          {factura.odoo_move_id ? (
            <span className="flex overflow-hidden rounded-full border border-slate-300 text-[11px]">
              {["draft", "posted"].map((e) => (
                <span
                  key={e}
                  className={`px-2 py-0.5 ${
                    factura.odoo_estado === e
                      ? "bg-slate-800 font-medium text-white"
                      : "bg-slate-50 text-slate-500"
                  }`}
                >
                  {ESTADO_EN_ODOO[e]}
                </span>
              ))}
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
              Sin asiento en Odoo
            </span>
          )}

          <button onClick={onCerrar} className="text-xs text-slate-400 underline">
            cerrar
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-2 md:grid-cols-2">
        <Dato etiqueta="Proveedor">
          {proveedor ?? <span className="text-slate-400">sin proveedor</span>}
          {!factura.proveedor && factura.odoo_partner_nombre && (
            <span className="ml-1 text-xs text-slate-400">(de Odoo)</span>
          )}
        </Dato>

        <Dato etiqueta="Fecha de la factura">
          {factura.fecha ?? <span className="text-slate-400">sin fecha</span>}
        </Dato>

        <Dato etiqueta="CUIT">
          {factura.cuit_emisor ?? <span className="text-slate-400">—</span>}
        </Dato>

        <Dato etiqueta="Empresa">
          {factura.empresa ?? <span className="text-slate-400">sin definir</span>}
        </Dato>

        <Dato etiqueta="Tipo de comprobante">{nombreDelTipo(factura.tipo_comprobante)}</Dato>

        <Dato etiqueta="Importe total">
          {Number(factura.importe_total ?? 0).toLocaleString("es-AR", {
            minimumFractionDigits: 2,
          })}
          {factura.moneda !== "ARS" && ` ${factura.moneda}`}
        </Dato>

        <Dato etiqueta="Número documento">
          {numeroFormateado(factura.punto_venta, factura.numero)}
        </Dato>

        <Dato etiqueta="Requerimiento">
          {factura.requerimiento ? (
            `RI ${factura.requerimiento}`
          ) : (
            <span className="text-slate-400">sin vincular</span>
          )}
        </Dato>

        <Dato etiqueta="CAE">
          {factura.cae ?? <span className="text-slate-400">—</span>}
        </Dato>

        <Dato etiqueta="Asiento en Odoo">
          {factura.odoo_nombre && factura.odoo_nombre !== "/" ? (
            factura.odoo_nombre
          ) : factura.odoo_move_id ? (
            // En borrador Odoo deja el nombre en "/": numera recién al postear.
            <span className="text-slate-400">todavía sin numerar</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </Dato>

        {/*
          * De dónde salió el dato fiscal. No es decorativo: `qr` está firmado
          * por ARCA, `texto` lo interpretó el lector del PDF y `a mano` lo
          * tipeó alguien, y quien revisa decide distinto según cuál sea.
          */}
        <Dato etiqueta="Entró por">
          {factura.origen}
          <span className="ml-1 text-xs text-slate-400">
            ·{" "}
            {factura.identificado_por === "qr"
              ? "leída del QR"
              : factura.identificado_por === "texto"
                ? "leída del texto"
                : "cargada a mano"}
          </span>
        </Dato>
      </div>
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

  /* Una distribución ya puesta gana sobre la sugerencia: no se propone lo que
     alguien ya decidió. */
  const mostrarLaAnalitica = !!sugerenciaDeAnalitica && !Object.keys(analitica).length;

  return (
    <li className="px-2 py-3 lg:py-2">
      {/*
        * Las mismas seis columnas que el encabezado. Abajo de `lg` se apila y
        * cada celda muestra su etiqueta: una línea tiene dos buscadores y una
        * distribución con porcentajes editables, y eso en seis columnas
        * angostas no se puede usar.
        */}
      <div className="grid gap-x-2 gap-y-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.7fr)_minmax(0,1.4fr)_minmax(0,1.9fr)_3.5rem_6rem_6.5rem] lg:gap-y-0">
        {/*
          * Producto y etiqueta son dos columnas, como en Odoo: el producto es
          * la ficha del catálogo y la etiqueta es **lo que dice el papel**.
          *
          * El orden se da vuelta cuando la tabla se apila (`order-first` en la
          * etiqueta): ahí no hay encabezados que guíen, y lo primero que se lee
          * tiene que ser la descripción del comprobante, que es justamente el
          * dato con el que se decide qué producto corresponde.
          */}
        <div className="min-w-0">
          <Buscador
            etiqueta={
              <>
                <span className="lg:hidden">Producto</span>
                {/* De dónde salió: lo propuso una regla, lo aprendió de una
                    corrección anterior, o lo eligió una persona. */}
                {linea.producto_origen && (
                  <span className="normal-case lg:ml-0">
                    <span className="lg:hidden"> · </span>
                    {linea.producto_origen}
                  </span>
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
        </div>

        <div className="order-first min-w-0 lg:order-none">
          <span className="block text-[10px] uppercase tracking-wide text-slate-400 lg:hidden">
            Etiqueta
          </span>
          <p className="text-sm font-medium text-slate-800 lg:font-normal lg:text-slate-700">
            {linea.descripcion}
          </p>
        </div>

        <div className="min-w-0">
          <Buscador
            etiqueta={<span className="lg:hidden">Cuenta</span>}
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

        </div>

      <div className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wide text-slate-400 lg:hidden">
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

      </div>

        {/*
          * Cantidad, precio y subtotal: lo que dice el papel, alineado a la
          * derecha como en Odoo. **No se editan**, igual que la descripción —
          * si están mal leídos, la factura se vuelve a cargar; corregirlos acá
          * dejaría un detalle que ya no es el comprobante.
          */}
        <Numero etiqueta="Cantidad">{Number(linea.cantidad ?? 0).toLocaleString("es-AR")}</Numero>
        <Numero etiqueta="Precio">
          {Number(linea.precio_unitario ?? 0).toLocaleString("es-AR", {
            minimumFractionDigits: 2,
          })}
        </Numero>
        <Numero etiqueta="Subtotal">
          <strong>
            {Number(linea.total ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
          </strong>
        </Numero>
      </div>

      {/*
        * Las dos sugerencias van **abajo de la línea y a todo el ancho**, no
        * adentro de su celda.
        *
        * Cada una trae su antecedente —"las últimas 4 de este proveedor fueron
        * ahí"— y esa frase es la que permite no aceptarla; metida en una
        * columna de 180 px se partía en tres renglones y empujaba la fila a lo
        * alto, que es lo que arruinaba la tabla. Acá se leen de corrido y las
        * siete columnas quedan parejas.
        *
        * No se pre-llenan: la de cuenta acierta el 89% y la del historial el
        * 78%. Mucho para ahorrar trabajo, poco para decidir solas.
        */}
      {puedeEditar && (sugerencia || mostrarLaAnalitica) && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {sugerencia && (
            <p className="text-slate-600">
              <button
                disabled={guardando}
                onClick={() => void onUsarLaCuenta(linea.id, sugerencia)}
                className="font-medium text-teal-800 underline disabled:opacity-40"
              >
                Usar {sugerencia.nombre}
              </button>
              <span className="ml-1 text-slate-400">— {sugerencia.porque}</span>
            </p>
          )}

          {/*
            * La analítica distingue **certeza de estadística**: cuando sale del
            * equipo del requerimiento no es una probabilidad —el RI dice para
            * qué se compró— y por eso se muestra distinta de la que sale del
            * historial.
            */}
          {mostrarLaAnalitica && (
            <p
              className={
                sugerenciaDeAnalitica!.esCerteza
                  ? "rounded bg-emerald-50 px-1.5 text-emerald-900"
                  : "text-slate-600"
              }
            >
              <button
                disabled={guardando}
                onClick={() => void onUsarLaAnalitica(linea.id, sugerenciaDeAnalitica!)}
                className="font-medium underline disabled:opacity-40"
              >
                Usar {sugerenciaDeAnalitica!.detalle}
              </button>
              <span className="ml-1 opacity-70">— {sugerenciaDeAnalitica!.porque}</span>
            </p>
          )}
        </div>
      )}

      {aviso && <p className="mt-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{aviso}</p>}
    </li>
  );
}

/** Re-exportado para que la fila del buzón muestre el resumen sin recalcularlo. */
export { describirDistribucion };
