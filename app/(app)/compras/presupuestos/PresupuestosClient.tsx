"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Select from "@/components/Select";
import MultiSelect from "@/components/MultiSelect";
import { PLAZOS_PAGO, DISPONIBILIDADES } from "@/lib/compras/comparativa";
import { numerosDelRenglon } from "@/lib/compras/numeroDeCampo";
import { avisoDeCuit } from "@/lib/compras/avisoDeCuit";

export type PedidoOfrecido = {
  id: string;
  nro_ri: number;
  descripcion: string;
  area: string | null;
  /** La planilla que el pedido ya tiene vinculada: si hay una, gana sobre la del encabezado. */
  planillaId: string | null;
  planillaNombre: string | null;
};

type Renglon = {
  clave: number;
  requerimientoId: string;
  marca: string;
  unidad: string;
  precio: string;
  cantidad: string;
  descuento: string;
  iva: string;
  plazos: number[];
  condiciones: string;
  disponibilidad: string;
  comentario: string;
  // Detrás de «más campos»: vacíos en 9 de cada 10 filas medidas.
  envio: string;
  precioHasta: string;
  divisa: "ARS" | "USD";
  masCampos: boolean;
};

/** `cargadas` null: el 201 llegó pero no se pudo leer el detalle. */
type Resultado = { cargadas: number | null; avisoDrive: string | null };

const renglonVacio = (clave: number): Renglon => ({
  clave, requerimientoId: "", marca: "", unidad: "", precio: "", cantidad: "",
  descuento: "0", iva: "21", plazos: [], condiciones: "", disponibilidad: "",
  comentario: "", envio: "", precioHasta: "", divisa: "ARS", masCampos: false,
});

const CAMPO ="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

/**
 * La respuesta de un proveedor, cargada de una vez.
 *
 * Proveedor, fecha y planilla se eligen **una vez** arriba; cada renglón es un
 * pedido con su precio. Es más rápido que la planilla porque en Sheets hay que
 * repetir o arrastrar el proveedor y la fecha en cada fila.
 *
 * **La ruta no es idempotente** —ya no hay `unique(requerimiento_id,
 * proveedor_id)`—, así que un segundo envío inserta todo de nuevo y escribe las
 * filas otra vez en la planilla. Esta pantalla es la primera defensa: el botón
 * queda apagado mientras el POST está en vuelo y **no se vuelve a prender
 * después de un 201**. Tampoco después de un corte de red, porque ahí no se
 * sabe si el servidor llegó a guardar.
 *
 * Lo que la pantalla no puede cubrir —dos pestañas, o el «Ya los revisé»
 * apretado sobre un 502 que sí había guardado— lo frena la ruta con un 409: ver
 * `renglonesYaCargados`. Son dos defensas distintas y hacen falta las dos.
 */
export default function PresupuestosClient({
  pedidos, proveedores, archivos, avisoDeDrive, hoy,
}: {
  pedidos: PedidoOfrecido[];
  proveedores: { id: string; nombre: string; cuit: string | null }[];
  archivos: { id: string; nombre: string }[];
  avisoDeDrive: string | null;
  hoy: string;
}) {
  const [proveedorId, setProveedorId] = useState("");
  // Precargada con hoy A PROPÓSITO: la respuesta se baja ni bien llega por
  // WhatsApp, así que hoy es la fecha correcta en la mayoría de las cargas.
  // Vaciarla agregaría un paso a todas para evitar el error de unas pocas.
  const [fechaRespuesta, setFechaRespuesta] = useState(hoy);
  const [planillaId, setPlanillaId] = useState("");
  const [renglones, setRenglones] = useState<Renglon[]>([renglonVacio(1)]);
  const siguiente = useRef(2);

  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  // Los pedidos de una carga que quizá se guardó: con ellos se arma el aviso y
  // los enlaces a sus fichas. `yaRevise` es la decisión explícita de quien los miró.
  const [inciertoDe, setInciertoDe] = useState<string[] | null>(null);
  const [yaRevise, setYaRevise] = useState(false);
  const incierto = inciertoDe !== null && !yaRevise;
  // El freno de verdad: el estado se actualiza al próximo render, y dos clicks
  // seguidos pueden entrar antes.
  const enVuelo = useRef(false);

  // Sin CUIT la orden de compra no sale. Se dice al elegir al proveedor, no al
  // final del circuito: el mismo criterio que `PresupuestoForm`.
  const avisoDelCuit = avisoDeCuit(proveedores.find((p) => p.id === proveedorId));

  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));
  const elegidos = new Set(renglones.map((r) => r.requerimientoId).filter(Boolean));

  const cambiar = (clave: number, parcial: Partial<Renglon>) =>
    setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, ...parcial } : r)));

  function agregar() {
    setRenglones((rs) => [...rs, renglonVacio(siguiente.current++)]);
  }

  function sacar(clave: number) {
    setRenglones((rs) => (rs.length > 1 ? rs.filter((r) => r.clave !== clave) : rs));
  }

  async function guardar() {
    if (enVuelo.current || resultado) return;

    // Los números se leen ANTES de mandar nada, y un texto que no se pudo leer
    // frena la carga en vez de viajar como cero.
    //
    // Es el mismo criterio que la ruta aplica al precio unitario, un piso más
    // arriba: con `?? 0`, un «21%» tipeado en el campo IVA se guardaba como IVA
    // 0 y la fórmula de la planilla daba un total 21% más bajo que el de los
    // otros proveedores — en una comparativa donde gana el más barato, eso
    // elige proveedor. El envío y la cantidad se perdían igual de callados.
    const problemas: string[] = [];
    const numerosPorClave = new Map<number, ReturnType<typeof numerosDelRenglon>["campos"]>();
    renglones.forEach((r, i) => {
      const pedido = pedidoPorId.get(r.requerimientoId);
      const comoSeLlama = pedido ? `RI ${pedido.nro_ri}` : `Renglón ${i + 1}`;
      const leido = numerosDelRenglon(
        { precio: r.precio, cantidad: r.cantidad, descuento: r.descuento, iva: r.iva, envio: r.envio },
        comoSeLlama
      );
      problemas.push(...leido.problemas);
      numerosPorClave.set(r.clave, leido.campos);
    });
    if (problemas.length > 0) {
      setErrores(problemas);
      setInciertoDe(null);
      return;
    }

    enVuelo.current = true;
    setEnviando(true);
    setErrores([]);
    setInciertoDe(null);
    setYaRevise(false);

    // Sin respuesta de nuestra ruta no se sabe si el servidor guardó: no se
    // rehabilita solo, porque reenviar duplica los presupuestos y las filas.
    const quedoIncierto = () => {
      setInciertoDe([...elegidos]);
      setEnviando(false);
    };

    let res: Response;
    try {
      res = await fetch("/api/compras/presupuestos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proveedor_id: proveedorId || null,
          fecha_respuesta: fechaRespuesta || null,
          comparativa_drive_id: planillaId || null,
          renglones: renglones.map((r) => ({
            requerimiento_id: r.requerimientoId,
            marca: r.marca.trim() || null,
            unidad_medida: r.unidad.trim() || null,
            ...numerosPorClave.get(r.clave)!,
            plazos_pago_dias: r.plazos,
            condiciones_pago: r.condiciones.trim() || null,
            disponibilidad: r.disponibilidad || null,
            comentario: r.comentario.trim() || null,
            precio_hasta: r.precioHasta || null,
            moneda: r.divisa,
          })),
        }),
      });
    } catch {
      quedoIncierto();
      return;
    }

    // `null` es un cuerpo que no se pudo leer: un 502/504/524 de la plataforma
    // (la ruta tiene `maxDuration` de 120 s y después del insert hay mucho
    // trabajo) o una respuesta cortada.
    const body: Record<string, unknown> | null = await res.json().catch(() => null);

    if (res.status === 201) {
      // `enVuelo` queda en true y `resultado` lo confirma: no hay vuelta atrás.
      setResultado({
        cargadas: body && typeof body.cargadas === "number" ? body.cargadas : null,
        avisoDrive: body && typeof body.aviso_drive === "string" ? body.aviso_drive : null,
      });
      setEnviando(false);
      return;
    }

    // Sólo es «no se guardó» una respuesta de error de NUESTRA ruta: cuerpo
    // JSON con su campo `error`, que sale antes de escribir. Cualquier otra cosa
    // —cuerpo ilegible, un timeout de la plataforma— es incierta.
    if (!body || typeof body.error !== "string") {
      quedoIncierto();
      return;
    }

    // Todos los problemas juntos: la ruta los junta a propósito, y mostrar sólo
    // `error` tira la mitad de lo que supo decir.
    const lista: string[] = Array.isArray(body.errores) && body.errores.length > 0
      ? (body.errores as string[])
      : [body.error];
    setErrores(lista);
    enVuelo.current = false;
    setEnviando(false);
  }

  if (resultado) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          {resultado.cargadas === null ? (
            "La carga se guardó, pero no se pudo leer el detalle de la respuesta, así que no sabemos si quedó algo sin hacer en la planilla. Revisá la ficha de cada pedido."
          ) : (
            <>
              Se cargaron <strong>{resultado.cargadas}</strong>{" "}
              {resultado.cargadas === 1 ? "presupuesto" : "presupuestos"}.
            </>
          )}
        </div>
        {resultado.avisoDrive && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {resultado.avisoDrive}
          </div>
        )}
        <div className="flex gap-2">
          {/* Recarga completa a propósito: vuelve a traer los pedidos y arranca de cero. */}
          <a href="/compras/presupuestos" className="btn-primary">Cargar otra respuesta</a>
          <Link href="/compras" className="btn-secondary">Volver a Compras</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/compras" className="text-sm text-slate-500 hover:text-slate-900">← Compras</Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Cargar la respuesta de un proveedor</h1>
        <p className="text-sm text-slate-500">
          Elegí el proveedor y la fecha una vez, y después un renglón por cada pedido que cotizó.
        </p>
      </div>

      {errores.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errores.length === 1 ? (
            errores[0]
          ) : (
            <ul className="list-disc space-y-0.5 pl-5">
              {errores.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {inciertoDe && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>
            No recibimos respuesta del servidor y no sabemos si la carga llegó a guardarse.
            Antes de volver a enviar, abrí la ficha de cada pedido y fijate si ya tiene el
            presupuesto de este proveedor: enviarla dos veces los duplica. Las fichas abren en otra
            pestaña, así no se pierde lo que cargaste.
          </p>
          <ul className="list-disc pl-5">
            {inciertoDe.map((id) => (
              <li key={id}>
                <a
                  href={`/compras/requerimientos/${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline"
                >
                  RI {pedidoPorId.get(id)?.nro_ri ?? id}
                </a>
              </li>
            ))}
          </ul>
          {!yaRevise && (
            <button
              type="button"
              // La advertencia queda a la vista: sólo se rehabilita el envío.
              onClick={() => { enVuelo.current = false; setYaRevise(true); }}
              className="text-xs font-semibold underline"
            >
              Ya los revisé: volver a habilitar el envío
            </button>
          )}
        </div>
      )}

      {avisoDeDrive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {avisoDeDrive}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <Campo label="Proveedor">
          <Select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className={CAMPO}>
            <option value="">Elegir…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Select>
          {/* Acá pesa más que en el formulario por pedido: ahí se carga una
              cotización y acá la respuesta entera de un proveedor, que en el
              29% de los casos cubre más de un pedido. Enterarse al final de
              que no se le puede comprar tira abajo toda esa carga de una. */}
          {avisoDelCuit && <p className="mt-1 text-sm text-amber-700">{avisoDelCuit}</p>}
        </Campo>
        <Campo label="Fecha de la respuesta">
          <input
            type="date"
            value={fechaRespuesta}
            onChange={(e) => setFechaRespuesta(e.target.value)}
            className={CAMPO}
          />
        </Campo>
        <Campo label="Planilla del artículo">
          <Select value={planillaId} onChange={(e) => setPlanillaId(e.target.value)} className={CAMPO}>
            <option value="">Sin elegir</option>
            {archivos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </Select>
        </Campo>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Renglones</h2>

        {renglones.map((r, i) => {
          const pedido = pedidoPorId.get(r.requerimientoId);
          const planillaDelPedido = pedido?.planillaId ?? null;
          return (
            <div key={r.clave} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Campo label={`Pedido (RI) · renglón ${i + 1}`}>
                    <Select
                      value={r.requerimientoId}
                      onChange={(e) => cambiar(r.clave, { requerimientoId: e.target.value })}
                      className={CAMPO}
                    >
                      <option value="">Elegir pedido…</option>
                      {pedidos.map((p) => (
                        <option
                          key={p.id}
                          value={p.id}
                          // Un pedido figura una sola vez por carga: la ruta lo rechaza.
                          disabled={elegidos.has(p.id) && p.id !== r.requerimientoId}
                        >
                          {`RI ${p.nro_ri} · ${p.descripcion}${p.area ? ` · ${p.area}` : ""}`}
                        </option>
                      ))}
                    </Select>
                  </Campo>
                </div>
                <button
                  type="button"
                  onClick={() => sacar(r.clave)}
                  disabled={renglones.length === 1}
                  aria-label={`Sacar el renglón ${i + 1}`}
                  className="btn-secondary mt-5 shrink-0"
                >
                  Sacar
                </button>
              </div>

              {pedido && <NotaDePlanilla pedido={pedido} planillaId={planillaId} archivos={archivos} />}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Campo label="Marca"><Texto valor={r.marca} set={(v) => cambiar(r.clave, { marca: v })} /></Campo>
                <Campo label="Unidad de medida"><Texto valor={r.unidad} set={(v) => cambiar(r.clave, { unidad: v })} /></Campo>
                <Campo label="Cantidad"><Texto valor={r.cantidad} set={(v) => cambiar(r.clave, { cantidad: v })} inputMode="decimal" /></Campo>

                <Campo label="Precio unitario"><Texto valor={r.precio} set={(v) => cambiar(r.clave, { precio: v })} inputMode="decimal" /></Campo>
                <Campo label="Descuento %"><Texto valor={r.descuento} set={(v) => cambiar(r.clave, { descuento: v })} inputMode="decimal" /></Campo>
                <Campo label="IVA %"><Texto valor={r.iva} set={(v) => cambiar(r.clave, { iva: v })} inputMode="decimal" /></Campo>

                <Campo label="Plazos de pago">
                  <MultiSelect
                    valores={r.plazos.map(String)}
                    onCambio={(v) => cambiar(r.clave, { plazos: v.map(Number).sort((a, b) => a - b) })}
                    vacio="Sin definir"
                    plural="cuotas"
                    opciones={PLAZOS_PAGO.map((p) => [String(p), p === 0 ? "contado" : `${p} días`])}
                  />
                </Campo>
                <Campo label="Disponibilidad">
                  <Select
                    value={r.disponibilidad}
                    onChange={(e) => cambiar(r.clave, { disponibilidad: e.target.value })}
                    className={CAMPO}
                  >
                    <option value="">—</option>
                    {DISPONIBILIDADES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Campo>
                <Campo label="Condiciones de pago">
                  <Texto valor={r.condiciones} set={(v) => cambiar(r.clave, { condiciones: v })} />
                </Campo>
              </div>

              <Campo label="Comentario">
                <Texto valor={r.comentario} set={(v) => cambiar(r.clave, { comentario: v })} />
              </Campo>

              <button
                type="button"
                onClick={() => cambiar(r.clave, { masCampos: !r.masCampos })}
                className="text-xs font-semibold text-slate-500 hover:text-slate-900"
              >
                {r.masCampos ? "− Menos campos" : "+ Más campos (envío, precio válido hasta, moneda)"}
              </button>

              {r.masCampos && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Campo label="Envío"><Texto valor={r.envio} set={(v) => cambiar(r.clave, { envio: v })} inputMode="decimal" /></Campo>
                  <Campo label="Precio válido hasta">
                    <input
                      type="date"
                      value={r.precioHasta}
                      onChange={(e) => cambiar(r.clave, { precioHasta: e.target.value })}
                      className={CAMPO}
                    />
                  </Campo>
                  <Campo label="Moneda">
                    <Select
                      value={r.divisa}
                      onChange={(e) => cambiar(r.clave, { divisa: e.target.value as "ARS" | "USD" })}
                      className={CAMPO}
                    >
                      <option value="ARS">Pesos ($)</option>
                      <option value="USD">Dólares (USD)</option>
                    </Select>
                  </Campo>
                </div>
              )}
            </div>
          );
        })}

        <button type="button" onClick={agregar} className="btn-secondary">+ Agregar renglón</button>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={guardar}
          // Apagado mientras el POST está en vuelo; tras el 201 se cambia de
          // pantalla, así que no hay forma de apretarlo dos veces.
          disabled={enviando || incierto}
          className="btn-primary"
        >
          {enviando
            ? "Guardando…"
            : `Guardar ${renglones.length === 1 ? "el presupuesto" : `los ${renglones.length} presupuestos`}`}
        </button>
        <span className="text-xs text-slate-500">
          Se guarda todo o nada: si un pedido no se puede cargar, no se carga ninguno.
        </span>
      </div>
    </div>
  );
}

/** Dónde va a ir la fila de este renglón, para que no sea una sorpresa. */
function NotaDePlanilla({
  pedido, planillaId, archivos,
}: {
  pedido: PedidoOfrecido;
  planillaId: string;
  archivos: { id: string; nombre: string }[];
}) {
  if (pedido.planillaId) {
    const otra = planillaId && planillaId !== pedido.planillaId;
    return (
      <p className={`text-xs ${otra ? "text-amber-700" : "text-slate-500"}`}>
        {otra
          ? `Este pedido ya tiene su planilla (${pedido.planillaNombre ?? "vinculada"}) y gana sobre la que elegiste arriba: la fila va ahí.`
          : `Va a la planilla ya vinculada: ${pedido.planillaNombre ?? "vinculada al pedido"}.`}
      </p>
    );
  }
  if (planillaId) {
    const nombre = archivos.find((a) => a.id === planillaId)?.nombre ?? "la elegida";
    return <p className="text-xs text-slate-500">No tiene planilla: va a «{nombre}» y se la vincula al pedido.</p>;
  }
  return (
    <p className="text-xs text-amber-700">
      No tiene planilla y no elegiste ninguna arriba: el presupuesto se guarda, pero no se escribe en ninguna planilla.
    </p>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Texto({
  valor, set, inputMode,
}: {
  valor: string;
  set: (v: string) => void;
  inputMode?: "decimal";
}) {
  return (
    <input value={valor} onChange={(e) => set(e.target.value)} inputMode={inputMode} className={CAMPO} />
  );
}
