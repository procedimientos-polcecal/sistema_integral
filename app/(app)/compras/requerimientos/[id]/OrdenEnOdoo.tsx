"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fecha, monedaExacta } from "@/lib/compras/constants";
import type { Diferencia } from "@/lib/compras/divergenciaDeOrden";
import type { OrdenLeida } from "@/lib/odoo/ordenEnOdoo";
import {
  explicacionDeSugerencia,
  type MotivoDeSugerencia,
  type ProductoDeOdoo,
} from "@/lib/compras/productoOdoo";

/**
 * La orden de compra de este requerimiento en Odoo.
 *
 * Vive en su propio archivo y no dentro de `RequerimientoDetalle`, que ya tiene
 * 550 líneas. Es una sección con su propio estado —crear, ensayar, mostrar el
 * pendiente— y no comparte nada con el resto de la ficha.
 *
 * Por qué existe: si la orden está en Odoo, contabilidad genera la factura
 * **desde** la orden, con ítems, precios e impuestos ya puestos, en vez de
 * tipearla de cero. Eso es lo que hace lenta la carga de facturas hoy.
 *
 * La orden se crea **en borrador**, y confirmarla es un botón aparte: confirmar
 * crea el remito de entrada en Odoo y deja la orden sin poder editarse ni
 * borrarse allá, así que lo decide una persona y no la generación. Confirmar
 * tampoco es postear: no se escribe ningún asiento desde acá. El SdG propone,
 * Odoo confirma.
 */

/** El estado de una orden, tal como lo devuelve `…/odoo/estado`. */
interface EstadoEnPantalla {
  nombre: string;
  sePuedeConfirmar: boolean;
  estaConfirmada: boolean;
  /**
   * El estado tal como lo dice Odoo. Se usa para distinguir lo que **no está
   * bien** —cancelada, o borrada del otro lado— de lo que simplemente todavía
   * no se confirmó. Sin esto, una orden cancelada se veía igual que un
   * borrador.
   */
  crudo?: string | null;
}

export interface OrdenDeOdoo {
  empresa: string;
  odooOrderId: number;
  odooNombre: string | null;
  porcentaje: number;
  /** A la orden, en la instancia a la que apunta el sistema. */
  enlace: string | null;
}

/**
 * La forma del ensayo que importa acá: qué producto propone, con qué catálogo
 * arma el selector, y qué advertencias trae el armado. El resto de lo que trae
 * el `GET` (precio, contexto, los `vals`...) se muestra tal cual con
 * `JSON.stringify` y no necesita tipo.
 */
interface EnsayoDeOrden {
  /** Lo que se puede mandar igual, pero conviene mirar antes. */
  armado?: { advertencias?: string[] };
  producto?: {
    sugerencia: {
      producto: ProductoDeOdoo | null;
      motivo: MotivoDeSugerencia;
      alternativas: ProductoDeOdoo[];
    };
    catalogo: ProductoDeOdoo[];
  };
  [clave: string]: unknown;
}

/** El ensayo tal como se muestra: sin los 378 productos del catálogo. */
function sinElCatalogo(ensayo: EnsayoDeOrden): unknown {
  if (!ensayo.producto) return ensayo;

  const { catalogo, ...resto } = ensayo.producto;
  return { ...ensayo, producto: { ...resto, catalogo: `${catalogo.length} productos comprables` } };
}

/**
 * El producto que usa la orden cuando nadie eligió uno.
 *
 * Se resalta en la pantalla a propósito: una orden con `ART. VARIOS` llega a
 * contabilidad sin decir qué se compró, y verlo acá es la única oportunidad de
 * corregirlo antes. El nombre es el del catálogo de Odoo.
 */
const GENERICO = "ART. VARIOS";

const numero = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

/**
 * En qué quedó la orden, en una frase.
 *
 * Son dos hechos distintos y los dos importan: **si llegó** —que sale de las
 * cantidades recibidas de cada línea— y **si se facturó**, que es el
 * `invoice_status` de Odoo. El segundo es la razón de ser de crear la orden: si
 * nunca llega a facturarse desde acá, contabilidad siguió tipeando la factura
 * de cero y el circuito no sirvió para nada.
 */
function comoVa(o: OrdenLeida): string {
  const pedido = o.lineas.reduce((a, l) => a + l.cantidad, 0);
  const recibido = o.lineas.reduce((a, l) => a + l.recibido, 0);

  const recepcion =
    pedido === 0
      ? "Sin líneas"
      : recibido === 0
        ? "Sin recibir"
        : recibido >= pedido
          ? "Recibida"
          : `Recibida en parte (${numero(recibido)} de ${numero(pedido)})`;

  // Los tres valores de `invoice_status` en Odoo 17. Uno que no conozcamos se
  // muestra tal cual en vez de traducirse a una mentira.
  const facturacion =
    o.facturacion === "invoiced"
      ? "Facturada"
      : o.facturacion === "to invoice"
        ? "Para facturar"
        : o.facturacion === "no"
          ? "Sin facturar"
          : o.facturacion;

  return facturacion ? `${recepcion} · ${facturacion}` : recepcion;
}

export default function OrdenEnOdoo({
  requerimientoId,
  ordenes,
  pendiente,
  puedeEditar,
  odoo,
}: {
  requerimientoId: string;
  ordenes: OrdenDeOdoo[];
  /** Por qué no se pudo crear la última vez. Null si no hay nada pendiente. */
  pendiente: string | null;
  puedeEditar: boolean;
  /** A qué instancia se le escribe: producción y staging difieren en dos variables. */
  odoo?: { base: string; esStaging: boolean };
}) {
  const router = useRouter();
  const [trabajando, setTrabajando] = useState(false);
  const [motivos, setMotivos] = useState<string[]>([]);
  const [ensayo, setEnsayo] = useState<EnsayoDeOrden | null>(null);
  /** Lo que hay que decirle a quien apretó, cuando no es un fallo. */
  const [advertencia, setAdvertencia] = useState<string | null>(null);
  /**
   * Qué orden está ocupada y en qué. Uno solo para las dos acciones: las dos
   * hablan con Odoo, y dejar apretar la segunda mientras corre la primera sólo
   * sirve para encimar dos esperas de treinta segundos.
   */
  const [ocupada, setOcupada] = useState<{ orden: number; que: "pdf" | "confirmar" } | null>(null);
  /** El estado de cada orden en Odoo, por id. Llega después del primer dibujo. */
  const [estados, setEstados] = useState<Record<number, EstadoEnPantalla>>({});
  /** Lo que la orden **dice** allá: proveedor, líneas, totales, avance. */
  const [detalles, setDetalles] = useState<Record<number, OrdenLeida>>({});
  /** Lo que dejó de coincidir con el requerimiento. Vacío cuando cuadra. */
  const [diferencias, setDiferencias] = useState<Diferencia[]>([]);
  // El producto elegido en el selector, como string porque así lo maneja un
  // <select>. Vacío es el genérico: lo mismo que no mandar nada en el POST.
  const [productoId, setProductoId] = useState("");

  const yaEstan = ordenes.length > 0;

  /*
   * El estado de cada orden se pregunta a Odoo, y se pregunta desde el
   * navegador: la ficha es un Server Component y meterle esta llamada la haría
   * esperar hasta 30s para mostrar dos palabras. Así la pantalla dibuja
   * primero y el estado aparece cuando llega.
   *
   * Un fallo no se grita: sin estado no se ofrece confirmar y no se muestra
   * nada, que es mejor que un cartel rojo por algo que no impide trabajar. El
   * PDF y el resto de la sección siguen andando.
   */
  const traerEstados = useCallback(async () => {
    if (!ordenes.length) return;

    try {
      const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo/estado`);
      if (!res.ok) return;

      const body: {
        estados?: ({ odooOrderId: number } & EstadoEnPantalla)[];
        ordenes?: OrdenLeida[];
        diferencias?: Diferencia[];
      } = await res.json();

      setEstados(
        Object.fromEntries((body.estados ?? []).map(({ odooOrderId, ...e }) => [odooOrderId, e]))
      );
      setDetalles(Object.fromEntries((body.ordenes ?? []).map((o) => [o.odooOrderId, o])));
      setDiferencias(body.diferencias ?? []);
    } catch {
      // Odoo no contestó. Se ve la orden, sin su estado.
    }
  }, [requerimientoId, ordenes.length]);

  useEffect(() => {
    void traerEstados();
  }, [traerEstados]);

  async function crear() {
    setTrabajando(true);
    setMotivos([]);
    setAdvertencia(null);
    /*
     * El ensayo **no** se borra acá. Borrarlo hacía desaparecer el selector
     * apenas se apretaba, así que después de un fallo —que es justo cuando hay
     * que reintentar— la elección de producto se perdía y el reintento salía
     * con el genérico sin que nada lo dijera.
     */

    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Sin producto elegido va vacío y la ruta busca lo aprendido para esta
      // descripción; si tampoco hay, usa el genérico.
      body: JSON.stringify(productoId ? { producto_id: Number(productoId) } : {}),
    });
    const body = await res.json().catch(() => ({}));
    setTrabajando(false);

    if (!res.ok) {
      // Los motivos vienen de la ruta y ya están escritos para leerse: dicen qué
      // hacer —"hay que dar de alta el proveedor en POLYSAN"— y no "error 422".
      setMotivos(body.motivos ?? [body.error ?? "No se pudo crear la orden en Odoo."]);
      // Igual se refresca: el pendiente quedó guardado en el requerimiento.
      router.refresh();
      return;
    }

    /*
     * Salió bien no siempre quiere decir que pasó lo que se pidió.
     *
     * Cuando la orden ya existía en Odoo, el push la reconoce y **no toca la
     * línea**: el producto que se acaba de elegir no se aplicó. Sin este aviso
     * la pantalla se quedaba en silencio y daba a entender lo contrario, que es
     * exactamente la forma de las trampas que este módulo ya pagó —el dato
     * aparece en el lugar que no es y se descubre meses después—.
     */
    const intactas: { odooNombre: string | null; odooOrderId: number }[] = (body.ordenes ?? [])
      .filter((o: { yaExistia?: boolean }) => o.yaExistia);

    const partes: string[] = [];

    if (productoId && intactas.length > 0) {
      const cuales = intactas.map((o) => o.odooNombre ?? `#${o.odooOrderId}`).join(" y ");
      partes.push(
        `La orden ${cuales} ya estaba en Odoo y no se modificó: el producto que elegiste ` +
          `no se aplicó. Si hay que cambiarlo, se cambia en Odoo, sobre la orden.`
      );
    }

    if (partes.length) setAdvertencia(partes.join(" "));

    // Las órdenes recién creadas todavía no tienen estado en la pantalla.
    void traerEstados();
    router.refresh();
  }

  /**
   * Bajar el PDF oficial de una orden.
   *
   * Va por `fetch` y no por un `<a href>` a secas porque la ruta contesta JSON
   * cuando algo falla: con un enlace común, un fallo de Odoo abriría una
   * pestaña con `{"error":…}` en vez de decirlo en la pantalla donde se apretó.
   * Y el nombre del archivo lo pone Odoo —`Orden de compra - P02420.pdf`—, así
   * que se saca de la cabecera en vez de inventarlo acá.
   */
  async function bajarPdf(odooOrderId: number, odooNombre: string | null) {
    setOcupada({ orden: odooOrderId, que: "pdf" });
    setMotivos([]);

    try {
      const res = await fetch(
        `/api/compras/requerimientos/${requerimientoId}/odoo/pdf?orden=${odooOrderId}`
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMotivos([body.error ?? "No se pudo bajar el PDF de la orden."]);
        return;
      }

      const nombre =
        /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "";

      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre ? decodeURIComponent(nombre) : `${odooNombre ?? odooOrderId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMotivos([e instanceof Error ? e.message : String(e)]);
    } finally {
      setOcupada(null);
    }
  }

  /**
   * Confirmar una orden en Odoo.
   *
   * El estado que quedó lo devuelve la ruta, leído de Odoo: no se supone
   * "confirmada" por haber apretado. Si entre que la pantalla se dibujó y el
   * clic alguien la confirmó o la canceló allá, la respuesta lo dice y la
   * pantalla se acomoda.
   */
  async function confirmar(odooOrderId: number, odooNombre: string | null) {
    setOcupada({ orden: odooOrderId, que: "confirmar" });
    setMotivos([]);
    setAdvertencia(null);

    try {
      const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo/estado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orden: odooOrderId }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMotivos([
          body.error ??
            `No se pudo confirmar la orden ${odooNombre ?? odooOrderId} en Odoo.`,
        ]);
        return;
      }

      setEstados((previos) => ({ ...previos, [odooOrderId]: body as EstadoEnPantalla }));
      if (body.aviso) setAdvertencia(body.aviso);
    } catch (e) {
      setMotivos([e instanceof Error ? e.message : String(e)]);
    } finally {
      setOcupada(null);
    }
  }

  async function ensayar() {
    setTrabajando(true);
    setMotivos([]);
    setAdvertencia(null);
    const res = await fetch(`/api/compras/requerimientos/${requerimientoId}/odoo`);
    const body: EnsayoDeOrden = await res.json().catch(() => ({ error: "No se pudo leer el ensayo." }));
    setEnsayo(body);
    // Arranca en lo que sugiere el emparejador; Compras lo puede cambiar antes
    // de crear. Sin sugerencia queda vacío, que es el genérico.
    setProductoId(String(body.producto?.sugerencia.producto?.id ?? ""));
    /*
     * Lo que el armado quiere que se mire antes de apretar —hoy, que un pedido
     * AMBAS de cantidad impar le pide media unidad a cada proveedor—. Va al
     * mismo cartel ámbar que el resto de los avisos: es para leer, no para
     * buscar dentro del volcado.
     */
    const avisos = body.armado?.advertencias ?? [];
    if (avisos.length) setAdvertencia(avisos.join(" "));
    setTrabajando(false);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Orden de compra en Odoo
      </h2>

      {/*
        A cuál Odoo se le va a escribir, **siempre**.
        
        La primera versión sólo avisaba en staging, con el argumento de que un
        cartel permanente se vuelve invisible. El 09/09/2026 quedó claro que el
        argumento era malo: se crearon dos órdenes en la contabilidad real
        creyendo que iban a la de prueba, porque la ausencia de cartel no dice
        nada. Es la producción la que hay que poder ver antes de apretar.
      */}
      {odoo && (
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
            odoo.esStaging
              ? "border-violet-200 bg-violet-50 text-violet-900"
              : "border-slate-300 bg-slate-100 text-slate-800"
          }`}
        >
          {odoo.esStaging ? (
            <>
              <strong>Apuntando a STAGING</strong> — lo que se cree acá no llega a la
              contabilidad real.
            </>
          ) : (
            <>
              <strong>Apuntando a PRODUCCIÓN</strong> — lo que se cree acá es la
              contabilidad real del grupo.
            </>
          )}{" "}
          <span className="font-mono">{odoo.base}</span>
        </p>
      )}

      {yaEstan ? (
        <ul className="space-y-3">
          {ordenes.map((o) => {
            const d = detalles[o.odooOrderId];
            const estado = estados[o.odooOrderId];
            const trabajandoAca = ocupada?.orden === o.odooOrderId;

            return (
              <li key={o.odooOrderId} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="flex items-baseline gap-2">
                    {/*
                      El número va enlazado porque solo no identifica nada:
                      staging es una copia y su secuencia quedó atrás, así que
                      P02428 existe en las dos bases y son órdenes distintas. El
                      enlace lleva a la que de verdad creó el sistema.
                    */}
                    {o.enlace ? (
                      <a
                        href={o.enlace}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono font-semibold text-[var(--primary)] hover:underline"
                      >
                        {o.odooNombre ?? `#${o.odooOrderId}`}
                      </a>
                    ) : (
                      <span className="font-mono font-semibold text-slate-900">
                        {o.odooNombre ?? `#${o.odooOrderId}`}
                      </span>
                    )}

                    {/*
                      El estado sale de Odoo, no de una copia nuestra: allá lo
                      puede cambiar cualquiera y una copia empezaría a mentir el
                      primer día. Llega después de que la pantalla se dibujó,
                      así que hasta entonces no se muestra nada en vez de
                      suponer.
                    */}
                    {estado && (
                      <span
                        className={`badge ${
                          estado.estaConfirmada
                            ? "badge-op"
                            : estado.crudo === "cancel" || estado.crudo === null
                              ? "badge-rep"
                              : "badge-fs"
                        }`}
                      >
                        {estado.nombre}
                      </span>
                    )}
                  </div>

                  <span className="text-xs text-slate-500">
                    {o.empresa}
                    {o.porcentaje !== 100 && ` · ${o.porcentaje}%`}
                  </span>
                </div>

                {/*
                  A quién se le pidió y cuándo. El proveedor es el de **Odoo**, y
                  no tiene por qué llamarse igual que el del SdG: la misma firma
                  está cargada como "PEDRO H. CAMINO S.R.L." en Polcecal y
                  "PEDRO CAMINO SRL" en Polysan. Mostrar el de allá es lo único
                  honesto — es el que va a recibir la orden.
                */}
                {d && (
                  <p className="mt-1 text-xs text-slate-600">
                    {d.proveedor ?? "Sin proveedor en la orden"}
                    {d.fecha && ` · ${fecha(d.fecha)}`}
                  </p>
                )}

                {/*
                  Lo que la orden dice. Es la parte que antes no estaba y por la
                  que había que abrir Odoo para saber qué se pidió.
                */}
                {d && d.lineas.length > 0 && (
                  <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                    {d.lineas.map((l) => (
                      <li key={l.id}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 text-slate-800">{l.descripcion || "—"}</span>
                          <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-slate-900">
                            {monedaExacta(l.subtotal)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {/*
                            El producto de Odoo se muestra siempre, incluido el
                            genérico: ART. VARIOS quiere decir que nadie eligió
                            uno, y eso es justamente lo que conviene ver.
                          */}
                          <span className={l.producto === GENERICO ? "text-amber-700" : undefined}>
                            {l.producto ?? "Sin producto"}
                          </span>
                          {" · "}
                          {numero(l.cantidad)}
                          {l.unidad ? ` ${l.unidad}` : ""} × {monedaExacta(l.precioUnitario)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {d && (
                  <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2">
                    {/*
                      Cada importe en su propio `nowrap`: en un teléfono la
                      línea se parte, y conviene que se parta ENTRE el neto y el
                      IVA y no en medio de uno de los dos.
                    */}
                    <span className="text-xs text-slate-500">
                      <span className="whitespace-nowrap">Neto {monedaExacta(d.neto)}</span>
                      {" · "}
                      <span className="whitespace-nowrap">IVA {monedaExacta(d.iva)}</span>
                    </span>
                    {/*
                      `whitespace-nowrap` porque en un teléfono el importe se
                      partía entre el signo y el número: "$" en una línea y
                      "19.511,25" en la siguiente.
                    */}
                    <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-slate-900">
                      {monedaExacta(d.total)}
                    </span>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  {/*
                    En qué quedó: si llegó y si se facturó. Lo segundo es la
                    razón de ser de crear la orden —que contabilidad arme la
                    factura desde acá en vez de tipearla—, así que es el dato que
                    dice si sirvió de algo.
                  */}
                  {d ? (
                    <span className="text-xs text-slate-600">{comoVa(d)}</span>
                  ) : (
                    <span className="text-xs text-slate-400">Leyendo la orden en Odoo…</span>
                  )}

                  <span className="flex items-baseline gap-3 text-xs">
                    {/*
                      Confirmar lo aprieta una persona y no la generación de la
                      orden: crea el remito de entrada y a partir de ahí la orden
                      no se edita ni se borra en Odoo, sólo se cancela.
                    */}
                    {puedeEditar && estado?.sePuedeConfirmar && (
                      <button
                        onClick={() => confirmar(o.odooOrderId, o.odooNombre)}
                        disabled={ocupada !== null}
                        className="font-semibold text-[var(--primary)] hover:underline disabled:opacity-50"
                      >
                        {trabajandoAca && ocupada.que === "confirmar"
                          ? "Confirmando…"
                          : "Confirmar en Odoo"}
                      </button>
                    )}

                    {/*
                      El PDF es el de Odoo, generado en el momento: el mismo que
                      sale de Imprimir → Orden de compra. Si la orden todavía
                      está en borrador, Odoo lo titula "Solicitud de cotización"
                      — es su regla, no un error nuestro.
                    */}
                    <button
                      onClick={() => bajarPdf(o.odooOrderId, o.odooNombre)}
                      disabled={ocupada !== null}
                      className="font-semibold text-[var(--primary)] hover:underline disabled:opacity-50"
                    >
                      {trabajandoAca && ocupada.que === "pdf" ? "Generando…" : "Bajar el PDF"}
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">
          Todavía no está en Odoo. Crearla deja que contabilidad genere la factura desde la
          orden en vez de cargarla de cero.
        </p>
      )}

      {/*
        Lo que dejó de coincidir con el requerimiento.

        La orden se crea desde acá y después se edita **del otro lado**: en Odoo
        cualquiera le cambia el precio o la cantidad. Hasta ahora una orden que
        ya no decía lo mismo que el RI se veía exactamente igual que una
        intacta, que es la forma de error que este módulo persigue en todos
        lados: el dato dejó de coincidir y nada avisa.

        Va en ámbar y no en rojo porque **no es un error**: que contabilidad
        corrija un precio en la orden es lo correcto. Lo que no puede pasar es
        que nadie se entere.
      */}
      {diferencias.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong className="block">
            La orden en Odoo ya no dice lo mismo que el requerimiento:
          </strong>
          <ul className="mt-1 space-y-0.5">
            {diferencias.map((d) => (
              <li key={d.campo}>
                {d.campo}: acá <span className="font-medium">{d.enElSdg}</span>, en Odoo{" "}
                <span className="font-medium">{d.enOdoo}</span>.
              </li>
            ))}
          </ul>
          <p className="mt-1 opacity-80">
            Si el cambio es el bueno, el que hay que corregir es el requerimiento.
          </p>
        </div>
      )}
      {pendiente && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong className="block">Quedó pendiente:</strong>
          {pendiente}
        </div>
      )}

      {motivos.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {motivos.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      )}

      {advertencia && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {advertencia}
        </div>
      )}

      {/*
        El selector va junto al botón de crear, no en otra pantalla: se elige
        el producto y se manda en el mismo gesto. Sólo aparece después de
        ensayar, porque hasta entonces no hay catálogo con qué armarlo.
      */}
      {puedeEditar && ensayo?.producto && (
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Producto de Odoo para la línea
          </label>
          <select
            value={productoId}
            onChange={(e) => setProductoId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">ART. VARIOS (genérico)</option>
            {[...ensayo.producto.catalogo]
              .sort((a, b) => a.nombre.localeCompare(b.nombre))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {explicacionDeSugerencia(ensayo.producto.sugerencia)}
          </p>
          {/*
            Y lo que de verdad va, que después de tocar el selector deja de ser
            lo sugerido. Son dos hechos distintos y antes se contaban con una
            sola frase.
          */}
          {String(ensayo.producto.sugerencia.producto?.id ?? "") !== productoId && (
            <p className="mt-1 text-xs font-medium text-slate-700">
              Cambiado a mano: va{" "}
              {ensayo.producto.catalogo.find((p) => String(p.id) === productoId)?.nombre ??
                "ART. VARIOS"}
              .
            </p>
          )}
        </div>
      )}

      {puedeEditar && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={crear}
            disabled={trabajando}
            className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
          >
            {trabajando ? "Trabajando…" : yaEstan ? "Reintentar lo que falte" : "Crear la orden en Odoo"}
          </button>

          {/*
            El ensayo muestra exactamente lo que se le mandaría a Odoo, sin
            mandarlo. Está a la vista y no escondido en un menú: esto escribe en
            la contabilidad del grupo, y mirar antes es más barato que corregir
            una orden mal creada.
          */}
          <button
            onClick={ensayar}
            disabled={trabajando}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Ver qué se mandaría
          </button>
        </div>
      )}

      {/*
        El volcado es para leerlo antes de apretar, así que el catálogo no va:
        son 378 objetos que empujan los `vals` —lo único que de verdad hay que
        mirar— fuera de la pantalla. Lo sustituye la cuenta, que es lo que
        importa saber de él: si vino vacío, Odoo no contestó.
      */}
      {ensayo !== null && (
        <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify(sinElCatalogo(ensayo), null, 2)}
        </pre>
      )}
    </section>
  );
}
