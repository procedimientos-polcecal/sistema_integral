"use client";

import { useRef, useState } from "react";
import Select from "@/components/Select";
import type { CuentaDeUnRepuesto } from "@/lib/mantenimiento/cuentaDeUnRepuesto";
import { ESTADO_DE_STOCK, type Disponibilidad, type Insumo } from "@/lib/mantenimiento/stock";
import { useCargar } from "@/lib/core/useCargar";
import { haceCuanto } from "@/lib/core/haceCuanto";

import { Modal } from "@/components/Modal";
import { useBorrador } from "@/lib/core/useBorrador";
import { claveDelBorrador } from "@/lib/core/borradorDeFormulario";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import NuevoRequerimientoModal from "@/app/(app)/compras/requerimientos/NuevoRequerimientoModal";
import { convienePedir, pedidoSugerido, type PedidoSugerido } from "@/lib/mantenimiento/pedirRepuesto";
import { MAXIMO_DE_NOTA } from "@/lib/mantenimiento/notas";
import {
  preguntaAbiertaDelRepuesto, sePuedePreguntarEn, encabezadoDeLaPregunta, queDecirDelAviso,
  type NotaDeLaOT,
} from "@/lib/mantenimiento/consultaDeRepuesto";
import {
  abrirCaja, cambiarCaja as cambiarLaCaja, cerrarCaja as cerrarLaCaja, type Caja,
} from "@/lib/mantenimiento/cajasDePregunta";
import {
  aplicacionDelRenglon, DIAS_DE_LA_VENTANA, TOPE_DE_CANDIDATAS,
  type SalidaDelPanol,
} from "@/lib/inventario/salidasDelRepuesto";
import type { UbicacionEnlazada } from "@/lib/compras/ubicaciones";
import { COMPRA_LABELS } from "@/lib/compras/constants";
import type { EstadoCompra } from "@/lib/compras/types";

/**
 * Los repuestos que hacen falta para hacer la orden.
 *
 * Y si los hay. La disponibilidad sale de **`inventario_articulos`**, la tabla
 * del módulo Inventario, y no de la planilla del pañol: eso cambió al importar
 * ese módulo, porque leer el Sheets en vivo era lento, dependía de que Google
 * contestara, y cuando la planilla no estaba configurada el autocompletado
 * devolvía una lista vacía sin explicar nada.
 *
 * El precio es que el número es el de la última sincronización y no el de este
 * segundo, así que la pantalla dice de cuándo es. Un stock sin fecha se lee
 * como si fuera de ahora, y en un pañol eso alcanza para ir a buscar algo que
 * ya no está.
 *
 * La lista se carga igual aunque el inventario todavía no se haya importado
 * —saber qué hace falta no depende de saber si lo hay—.
 *
 * Y cuando no hay, ofrece pedirlo. Un requerimiento lo puede generar cualquier
 * usuario del SdG, así que ese botón **no depende del permiso de edición de
 * Mantenimiento**: quien mira la orden y ve que falta algo es justamente quien
 * tiene que poder pedirlo, trabaje o no en Compras.
 *
 * Y ofrece **preguntar**: «Preguntar a Compras» escribe una pregunta en el
 * historial de la orden e interrumpe a quien contesta por los repuestos. A
 * diferencia de pedir, **sí exige el permiso de edición**: es la decisión del
 * diseño, porque escribe en la orden e interrumpe a una persona nombrada.
 * Preguntar no pide el repuesto —el requerimiento es el pedido y la pregunta es
 * por el pedido—, así que los dos botones conviven.
 *
 * Cada repuesto tiene **su propia caja** de pregunta: abrir la de uno no pisa lo que
 * se venía escribiendo en la de otro, y lo escrito sobrevive a un envío que falla.
 */

interface RiEnVuelo {
  nro_ri: number;
  descripcion: string | null;
  codigo: string | null;
  cantidad: number | null;
  fecha: string;
  estado_aprobacion: string | null;
  estado_compra: string | null;
}

interface Repuesto {
  id: string;
  nombre: string;
  codigo: string | null;
  cantidad: string | null;
  /** El artículo del pañol que una persona eligió para este renglón, si eligió.
      `articulo_id` es la columna de la propia fila y `articulo` el embed de
      `inventario_articulos`: manda la primera, porque la segunda viaja por una
      tabla cerrada con `tiene_acceso_inventario()` y a quien tenga Mantenimiento
      y no Inventario le llega `null` sin ningún error. */
  articulo_id?: string | null;
  articulo?: ArticuloDelPanol | null;
  /** La salida del pañol que una persona declaró como la de este repuesto. Antes
      de que se aplique la migración la columna no existe y ambos vienen sin valor. */
  movimiento_id?: string | null;
  movimiento?: SalidaDelPanol | null;
  /** Los requerimientos en curso que podrian ser este mismo repuesto. */
  ris?: { porCodigo: RiEnVuelo[]; porNombre: RiEnVuelo[] };
}

interface ArticuloDelPanol { id: string; codigo: string; descripcion: string }

type Opcion = { id: string; nombre: string };

export default function RepuestosOTModal({
  orden, puedeEditar, areas, empresas, ubicaciones, onCerrar, onCambioEnElHistorial,
}: {
  orden: {
    id: string; ot_number: number | null; descripcion: string | null;
    repuesto: string | null; equipment_id: string | null; equipo_raw: string | null;
    /** El sector de la OT: de ahí sale dónde se necesita cuando la máquina no
        tiene una ubicación propia, y de la ubicación sale quién paga. */
    sector_id: string | null;
    /** Si la orden espera algo decide si se ofrece preguntar, y si una pregunta
        sigue abierta. */
    estado: string | null;
  };
  puedeEditar: boolean;
  /** Los catálogos del formulario de requerimiento, para poder pedir de acá. */
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: UbicacionEnlazada[];
  onCerrar: () => void;
  /**
   * Se escribió o cambió algo que el historial de la orden muestra: una pregunta
   * nueva, o un repuesto sacado —que cierra la suya—. El historial está en otra
   * parte de la pantalla, detrás de este modal, y no se entera solo.
   */
  onCambioEnElHistorial?: () => void;
}) {
  const [repuestos, setRepuestos] = useState<Repuesto[]>([]);
  const [disponibilidad, setDisponibilidad] = useState<Record<string, Disponibilidad>>({});
  const [inventarioConectado, setInventarioConectado] = useState<boolean | null>(null);
  const [sincronizadoEn, setSincronizadoEn] = useState<string | null>(null);
  /** El repuesto que se está pidiendo, con el formulario ya completo. */
  /** Lo que se esta por pedir, con los RI que ya podrian cubrirlo. */
  const [pidiendo, setPidiendo] = useState<
    { pedido: PedidoSugerido; ris: Repuesto["ris"] } | null
  >(null);
  const [pedido, setPedido] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  /**
   * El catálogo del pañol con sus id, para elegir a qué artículo se refiere un
   * repuesto. Son ~1.200 filas y casi nadie lo usa, así que se pide recién cuando
   * alguien abre el selector, y una sola vez por modal.
   */
  const [articulos, setArticulos] = useState<ArticuloDelPanol[] | null>(null);
  /**
   * Sube cada vez que algo cambia la cuenta de un artículo. Un RI pegado en un
   * renglón vale para todos los renglones del mismo artículo, así que los demás
   * tienen que volver a calcular; sin esto dos líneas del mismo modal decían
   * números distintos para las mismas piezas.
   */
  const [versionDeLaCuenta, setVersionDeLaCuenta] = useState(0);
  const pidiendoArticulos = useRef<Promise<ArticuloDelPanol[] | string> | null>(null);
  /** La lista, o el texto de por qué no se pudo: lo dice el renglón que la pidió. */
  function traerArticulos(): Promise<ArticuloDelPanol[] | string> {
    if (articulos) return Promise.resolve(articulos);
    pidiendoArticulos.current ??= (async () => {
      try {
        const res = await fetch("/api/mantenimiento/inventario?articulos=1");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return body.error ?? "No se pudo traer el catálogo del pañol.";
        const lista: ArticuloDelPanol[] = body.data ?? [];
        setArticulos(lista);
        return lista;
      } catch {
        return "No se pudo traer el catálogo del pañol: no hay conexión con el servidor.";
      } finally {
        pidiendoArticulos.current = null;
      }
    })();
    return pidiendoArticulos.current;
  }

  /** El historial de la orden: de ahí sale qué repuesto ya tiene una pregunta esperando. */
  const [notas, setNotas] = useState<NotaDeLaOT[]>([]);
  /**
   * Las preguntas que se están escribiendo, **una caja por repuesto** (la clave es el
   * id del repuesto). Una sola caja para toda la lista hacía que abrir «Preguntar» en
   * otro repuesto tirara en silencio lo que ya se había escrito en el primero.
   */
  const [cajas, setCajas] = useState<Record<string, Caja>>({});
  /** El repuesto cuya pregunta está viajando. Una a la vez: el resto no se puede apretar. */
  const [enviando, setEnviando] = useState<string | null>(null);
  /** Lo que se le dice a quien acaba de preguntar: si el aviso llegó, y si la planilla. */
  const [seEnvio, setSeEnvio] = useState<
    { llego: boolean; texto: string; planilla: string | null } | null
  >(null);

  /*
   * EL RENGLÓN A MEDIO ESCRIBIR DE «AGREGAR», Y POR QUÉ ESTE MODAL TUVO QUE
   * GANARSE UN BOTÓN NEGATIVO
   *
   * Acá no hay formulario con «Cancelar»: la lista se edita renglón por renglón
   * y cada cambio ya está guardado del otro lado. Lo único a medio cargar es el
   * repuesto que se está por sumar, y ése sí se perdía al tocar el fondo.
   *
   * Encender `tocado` sin más dejaba la regla coja: todas las salidas ofrecerían
   * conservar el renglón y **ninguna** lo descartaría, así que un «rodamient» a
   * medio tipear volvería a aparecer cada vez que se abra esta OT, sin forma de
   * sacarlo salvo borrando letra por letra. Por eso el renglón tiene ahora su
   * propio «Borrar», que aparece sólo cuando hay algo escrito: es el botón
   * negativo que la regla pide, y el único que tira.
   *
   * Vive acá arriba y no adentro de `Agregar` porque el `Modal` necesita
   * `tocado`, y un hijo no se lo puede contar al padre sin un efecto.
   */
  const renglon = useBorrador(
    claveDelBorrador("mantenimiento-repuesto-a-sumar", { tipo: "ot", id: orden.id }),
    { nombre: "", codigo: "", cantidad: "" },
  );

  const traer = useCargar(async (vigente) => {
    setCargando(true);
    const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/repuestos`);
    setCargando(false);

    if (!res.ok) { setError("No se pudieron traer los repuestos."); return; }
    const lista: Repuesto[] = (await res.json()).data ?? [];
    setRepuestos(lista);

    if (lista.length === 0) { setDisponibilidad({}); return; }

    // Y qué hay de cada uno, contra el catálogo del módulo Inventario.
    const stock = await fetch("/api/mantenimiento/inventario", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // La cantidad viaja para que el inventario pueda decir «no alcanza»: con
      // 61 en stock y una OT que pide 80, sin esto la pantalla decía «Hay».
      body: JSON.stringify({
        // Con artículo elegido se busca **ése**, no lo que el nombre se parezca:
        // es lo que hace que el stock y el pedido a Compras sean los de la pieza.
        repuestos: lista.map((r) => ({
          codigo: r.articulo?.codigo ?? r.codigo,
          nombre: r.articulo?.descripcion ?? r.nombre,
          cantidad: r.cantidad,
        })),
      }),
    });
    if (!stock.ok) return;

    const body = await stock.json();
    if (!vigente()) return;
    setInventarioConectado(body.configurado);
    setSincronizadoEn(body.sincronizado_en ?? null);

    const porClave: Record<string, Disponibilidad> = {};
    (body.disponibilidad ?? []).forEach((d: Disponibilidad, i: number) => {
      porClave[lista[i].id] = d;
    });
    setDisponibilidad(porClave);
  }, [orden.id]);

  // El historial, aparte de la lista: saber qué hace falta no depende de saber
  // qué se preguntó. Si no se puede leer, el botón ofrece abrir una pregunta como
  // si no hubiera ninguna, y la ruta defiende la regla de una abierta por repuesto.
  const recargarNotas = useCargar(async (vigente) => {
    const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/notas`);
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    if (!vigente()) return;
    setNotas(body.data ?? []);
  }, [orden.id]);

  async function sacar(id: string) {
    const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/repuestos?repuesto=${id}`, {
      method: "DELETE",
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "No se pudo sacar."); return; }
    traer();
    // Sacar un repuesto cierra su pregunta, si tenía una abierta: el historial de
    // atrás tiene que dejar de mostrarla esperando.
    onCambioEnElHistorial?.();
  }

  /**
   * Abre la caja de la pregunta de un repuesto, escrita hasta donde se sabe.
   *
   * Arranca con el repuesto y los RI en curso, y si el repuesto ya tiene una pregunta
   * esperando es **su seguimiento**: se le suma al mismo hilo en vez de abrir otra, que
   * son dos entradas en la bandeja de Compras diciendo lo mismo. Las cajas de los demás
   * repuestos no se tocan.
   */
  function abrirPregunta(r: Repuesto, abierta: NotaDeLaOT | null) {
    const encabezado = encabezadoDeLaPregunta({ nombre: r.nombre, codigo: r.codigo }, r.ris);
    setError("");
    setSeEnvio(null);
    setCajas((actuales) => abrirCaja(actuales, r.id, encabezado, Boolean(abierta)));
  }

  function cambiarCaja(repuestoId: string, cambios: Partial<Caja>) {
    setCajas((actuales) => cambiarLaCaja(actuales, repuestoId, cambios));
  }

  function cerrarCaja(repuestoId: string) {
    setCajas((actuales) => cerrarLaCaja(actuales, repuestoId));
  }

  async function enviarPregunta(repuestoId: string) {
    const caja = cajas[repuestoId];
    if (!caja) return;

    // La pregunta abierta se mira **ahora** y no cuando se abrió la caja: si mientras
    // se escribía alguien contestó o siguió el hilo, lo que se manda tiene que apuntar
    // a lo de hoy. Apunta a LA abierta y no a la primera del hilo: con tres en un hilo,
    // apuntar a la primera deja dos abiertas.
    const abierta = preguntaAbiertaDelRepuesto(notas, repuestoId, orden.estado);

    setEnviando(repuestoId);
    cambiarCaja(repuestoId, { error: "" });

    // El `finally` es lo que devuelve los botones: sin él, un `fetch` que rechaza
    // —sin conexión— dejaba «Enviando…» para siempre y a la persona sin poder
    // reintentar.
    try {
      const res = await fetch(`/api/mantenimiento/ordenes/${orden.id}/notas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: caja.texto.trim(),
          tipo: "PREGUNTA",
          repuesto_id: repuestoId,
          ...(abierta ? { responde_a: abierta.id } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        // La caja queda abierta, con lo escrito. Un 409 es que la pantalla estaba
        // vieja —alguien ya preguntó por esta pieza, o contestó—: se vuelve a leer el
        // historial, y al mandar de nuevo el texto va como seguimiento de lo de hoy.
        //
        // Se refrescan **los dos**: `recargarNotas` son las notas de este modal, y
        // `onCambioEnElHistorial` es lo único que sube la versión del historial de
        // atrás. Avisar sólo acá dejaba la pantalla de la OT mostrando la pregunta
        // que el servidor acaba de rechazar por vieja, que es justo lo que el 409
        // vino a contar.
        cambiarCaja(repuestoId, { error: body.error ?? "No se pudo enviar la pregunta." });
        if (res.status === 409) {
          recargarNotas();
          onCambioEnElHistorial?.();
        }
        return;
      }

      cerrarCaja(repuestoId);
      setError("");
      setSeEnvio({ ...queDecirDelAviso(body.aviso), planilla: body.planilla_error ?? null });
      recargarNotas();
      onCambioEnElHistorial?.();
    } catch {
      cambiarCaja(repuestoId, {
        error:
          "No se pudo enviar: no hay conexión con el servidor. Revisá la conexión y " +
          "probá de nuevo; lo que escribiste sigue acá.",
      });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <>
      {/* Es una lista que se edita renglón por renglón: cada repuesto ya está
          guardado y no hay nada que tirar. Lo único a medio escribir es el
          renglón de «Agregar», que el fondo, la X y Escape salen conservando y
          descarta su propio «Borrar» (ver el comentario de `renglon`). */}
      <Modal titulo="Repuestos que hacen falta" alSalir={onCerrar} tocado={renglon.tocado}>
      <div className="space-y-4">
        <p className="-mt-2 text-xs text-slate-400">
          OT #{orden.ot_number ?? "—"} · {orden.descripcion ?? ""}
        </p>

        {/* Lo que dice la planilla, que es una sola línea de texto libre. */}
        {orden.repuesto && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            La planilla dice: <span className="font-medium">{orden.repuesto}</span>
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {inventarioConectado === false && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            El inventario del pañol todavía no se importó, así que no se puede decir
            si hay stock. Los repuestos se cargan igual.
          </p>
        )}

        {/* De cuándo es el stock que se está mostrando. La ruta lo venía
            mandando desde que el número dejó de salir del Sheets en vivo y la
            pantalla lo tiraba: un stock sin fecha se lee como si fuera de
            ahora, y eso alcanza para ir a buscar algo que ya no está. */}
        {inventarioConectado && sincronizadoEn && (
          <p className="text-right">
            <UltimaSincronizacion cuando={sincronizadoEn} que="Stock de" />
          </p>
        )}

        {/* Sólo se tapa la lista la primera vez: en una recarga el spinner la
            desmontaba entera y se llevaba lo que cada renglón tenía en pantalla
            (los avisos de un cambio de artículo, un RI a medio escribir). */}
        {cargando && repuestos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Cargando…</p>
        ) : repuestos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Todavía no se anotó ningún repuesto.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {repuestos.map((r) => {
              const d = disponibilidad[r.id];
              const estado = d ? ESTADO_DE_STOCK[d.estado] : null;

              // La pregunta que este repuesto ya tiene esperando, si tiene. Decide si
              // el botón abre una nueva o le suma al hilo.
              const abierta = preguntaAbiertaDelRepuesto(notas, r.id, orden.estado);
              // Las condiciones de «Pedir a Compras» —que falte stock— más las de
              // preguntar: poder editar la orden, y que la orden espere algo.
              const puedePreguntar =
                puedeEditar && sePuedePreguntarEn(orden.estado) && Boolean(d && convienePedir(d.estado));
              // La pregunta que se está escribiendo de este repuesto, si hay una.
              const caja = cajas[r.id];

              return (
                <li key={r.id} className="flex items-start justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800">
                      {r.nombre}
                      {r.cantidad && <span className="text-slate-400"> ×{r.cantidad}</span>}
                      {r.codigo && <span className="ml-1.5 font-mono text-xs text-slate-400">{r.codigo}</span>}
                    </div>
                    {estado && (
                      <div className={`text-xs ${estado.color}`}>
                        {estado.label}
                        {d.insumo?.stock !== null && d.insumo?.stock !== undefined && ` · ${d.insumo.stock} en stock`}
                        {d.insumo?.ubicacion && ` · ${d.insumo.ubicacion}`}
                      </div>
                    )}

                    <ArticuloYRi
                      repuesto={r}
                      d={d}
                      puedeEditar={puedeEditar}
                      articulos={articulos}
                      pedirArticulos={traerArticulos}
                      versionDeLaCuenta={versionDeLaCuenta}
                      onCambioDeLaCuenta={() => setVersionDeLaCuenta((v) => v + 1)}
                      onCambioDelArticulo={traer}
                    />

                    <SalidaDelPanolDelRenglon repuesto={r} puedeEditar={puedeEditar} onCambio={traer} />

                    {/* Cuando no hay, lo que sigue es pedirlo. El formulario
                        abre con el nombre, el código y la cantidad que ya están
                        acá: volver a escribirlos es donde el código se pierde y
                        el RI termina diciendo "rodamiento" a secas. */}
                    {/* Y si ya lo pidio alguien. Va **antes** del boton, que
                        es el momento en que sirve: despues de apretarlo el
                        pedido ya esta escrito. No lo bloquea — un falso "ya
                        esta pedido" que impide pedir es peor que pedir dos
                        veces. Ver `lib/mantenimiento/riDelRepuesto.ts`. */}
                    {d && convienePedir(d.estado) && <YaPedido ris={r.ris} />}

                    {/* La pregunta que ya se hizo, a la vista aunque el stock haya
                        cambiado o no se pueda editar, y también mientras se escribe
                        el seguimiento: «una pregunta sin responder se ve» es lo que
                        esto existe para hacer. */}
                    {abierta && (
                      <p className="mt-1 text-xs text-amber-700">
                        Preguntado {haceCuanto(abierta.creado_en)}, sin respuesta.
                      </p>
                    )}

                    {d && convienePedir(d.estado) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <button
                          onClick={() => setPidiendo({
                            pedido: pedidoSugerido(
                              { id: r.id, nombre: r.nombre, codigo: r.codigo, cantidad: r.cantidad },
                              d, orden, ubicaciones, areas
                            ),
                            ris: r.ris,
                          })}
                          className="text-xs font-medium text-[var(--primary)] underline hover:opacity-80"
                        >
                          Pedir a Compras
                        </button>

                        {/* Una pregunta abierta por repuesto: si ya hay una, el
                            botón no abre otra y ofrece sumar al mismo hilo. Dos
                            preguntas vivas por la misma pieza son dos entradas en
                            la bandeja de Compras que dicen lo mismo. */}
                        {puedePreguntar && !caja && (
                          <button
                            onClick={() => abrirPregunta(r, abierta)}
                            className="text-xs font-medium text-[var(--primary)] underline hover:opacity-80"
                          >
                            {abierta ? "Sigue sin llegar" : "Preguntar a Compras"}
                          </button>
                        )}
                      </div>
                    )}

                    {caja && (
                      <div className="mt-2 space-y-2">
                        <textarea
                          value={caja.texto}
                          onChange={(e) => cambiarCaja(r.id, { texto: e.target.value, error: "" })}
                          // Arranca escrita —el repuesto y los RI—, y lo que sigue es lo
                          // que se agrega a continuación: con el cursor al principio
                          // quedaría la pregunta antes del encabezado.
                          autoFocus
                          onFocus={(e) => {
                            const area = e.currentTarget;
                            area.setSelectionRange(area.value.length, area.value.length);
                          }}
                          maxLength={MAXIMO_DE_NOTA}
                          rows={4}
                          aria-label={`Pregunta para Compras sobre ${r.nombre}`}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-400"
                        />
                        {caja.error && <p className="text-xs text-red-600">{caja.error}</p>}
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => enviarPregunta(r.id)}
                            // Con sólo el encabezado no hay pregunta: es el repuesto
                            // y nada que preguntar de él. Y una sola viaja a la vez.
                            disabled={
                              enviando !== null ||
                              caja.texto.trim() === "" ||
                              caja.texto.trim() === caja.encabezado.trim()
                            }
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            {enviando === r.id ? "Enviando…" : "Enviar a Compras"}
                          </button>
                          <button
                            onClick={() => cerrarCaja(r.id)}
                            disabled={enviando === r.id}
                            className="text-xs text-slate-500 underline hover:text-slate-700 disabled:opacity-40"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {puedeEditar && (
                    <button
                      onClick={() => sacar(r.id)}
                      className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                      title="Sacar de la lista"
                    >×</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {pedido && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            {pedido} Lo vas a ver en <a href="/mis-pedidos" className="underline">Mis pedidos</a>.
          </p>
        )}

        {/* Lo que pasó con la pregunta. Verde sólo si salió el aviso y llegó a la
            planilla; si no, ámbar, y dice qué: que no haya a quién avisarle no
            puede quedar callado, porque quien preguntó cree que Compras lo sabe. */}
        {seEnvio && (
          <div
            className={`rounded-lg px-3 py-2 text-xs ${
              seEnvio.llego && !seEnvio.planilla
                ? "bg-green-50 text-green-800"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            <p>{seEnvio.texto}</p>
            {seEnvio.planilla && (
              <p className="mt-1">
                Quedó guardada en el sistema, pero no llegó a la planilla: {seEnvio.planilla}
              </p>
            )}
          </div>
        )}

        {puedeEditar && (
          <Agregar ordenId={orden.id} onAgregado={traer} onError={setError} renglon={renglon} />
        )}
      </div>
      </Modal>

      {/* El formulario de Compras, tal cual: uno solo para los dos lados, así
          un campo que se agregue allá aparece acá sin que nadie se acuerde.
          Hermano de este modal y no hijo: antes colgaba del fondo que cerraba
          con `onClick`, y los clics subían por el árbol de React hasta ahí. */}
      {pidiendo && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          inicial={pidiendo.pedido}
          /* El mismo aviso que en la fila, repetido acá a pedido: es el ultimo
             momento antes de que el pedido exista. */
          advertencia={<YaPedido ris={pidiendo.ris} />}
          onClose={() => setPidiendo(null)}
          onSaved={() => {
            setPedido(`Pedido cargado: ${pidiendo.pedido.descripcion}.`);
            setPidiendo(null);
          }}
        />
      )}
    </>
  );
}

const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

/** Lo que dice el servidor, sin traducir; y los RI que bloquean, si los nombra. */
async function leerFallo(res: Response): Promise<{ error: string; risPegados: number[] }> {
  const body = await res.json().catch(() => ({}));
  return {
    error: body.error ?? "No se pudo completar la acción.",
    risPegados: Array.isArray(body.ris_pegados) ? body.ris_pegados : [],
  };
}

type RespuestaDeCuenta = { cuenta?: CuentaDeUnRepuesto | null; advertencia?: string };

/**
 * El artículo del pañol de un repuesto, los RI pegados a mano y la cuenta de
 * cuánto de lo que viene ya tiene dueño.
 *
 * Los RI que el cruce por nombre adivina (`YaPedido`) **no entran en esta cuenta**
 * y se siguen mostrando aparte: un falso positivo ahí haría leer «cubierta» a una
 * orden por algo que no es suyo. Acá sólo cuentan los que una persona pegó.
 *
 * Un RI pegado a un renglón con artículo vale para **todas** las órdenes abiertas
 * que piden ese artículo, y la pantalla lo dice. Y cambiar o soltar el artículo se
 * rechaza mientras haya RI pegados, **sean del artículo viejo o de este mismo
 * renglón**: los del artículo porque la fila no guarda de qué renglón vino y
 * borrarla se llevaría el trabajo de otra orden, y los del renglón porque se irían
 * con él al grupo nuevo — soltar incluido, que es ese mismo viaje en dos clics con
 * los dos botones uno al lado del otro. El rechazo trae los números y acá se ofrece
 * sacarlos uno por uno, también el de un RI que Compras ya sacó de la planilla, que
 * bloquea y no se ve en ningún otro lado.
 */
function ArticuloYRi({
  repuesto, d, puedeEditar, articulos, pedirArticulos, versionDeLaCuenta, onCambioDeLaCuenta,
  onCambioDelArticulo,
}: {
  repuesto: Repuesto;
  d: Disponibilidad | undefined;
  puedeEditar: boolean;
  articulos: ArticuloDelPanol[] | null;
  pedirArticulos: () => Promise<ArticuloDelPanol[] | string>;
  versionDeLaCuenta: number;
  /** Se pegó o sacó un RI, o cambió el artículo: los demás renglones recalculan. */
  onCambioDeLaCuenta: () => void;
  onCambioDelArticulo: () => void;
}) {
  const articulo = repuesto.articulo ?? null;
  const [cuenta, setCuenta] = useState<CuentaDeUnRepuesto | null>(null);
  const [advertencia, setAdvertencia] = useState("");
  const [error, setError] = useState("");
  /** Los RI que impiden cambiar el artículo: hay que sacarlos antes. */
  const [bloqueo, setBloqueo] = useState<number[]>([]);
  const [aviso, setAviso] = useState("");
  const [eligiendo, setEligiendo] = useState(false);
  const [nro, setNro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  /** Por qué no se pudo traer el catálogo, si no se pudo: se dice acá y se puede reintentar. */
  const [falloElCatalogo, setFalloElCatalogo] = useState("");

  useCargar(async (vigente) => {
    const res = await fetch(`/api/mantenimiento/repuestos/${repuesto.id}/ri`);
    const body = await res.json().catch(() => ({}));
    if (!vigente()) return;
    if (!res.ok) { setError(body.error ?? "No se pudo calcular lo que viene."); return; }
    setCuenta(body.cuenta ?? null);
    setAdvertencia(body.advertencia ?? "");
  }, [repuesto.id, articulo?.id, versionDeLaCuenta]);

  /** Aplica la respuesta de una escritura: la cuenta nueva, o la advertencia. */
  function aplicar(body: RespuestaDeCuenta) {
    setCuenta(body.cuenta ?? null);
    setAdvertencia(body.advertencia ?? "");
  }

  async function llamar(
    url: string, init: RequestInit
  ): Promise<{ ok: true; body: RespuestaDeCuenta } | { ok: false; status?: number }> {
    setOcupado(true);
    setError("");
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const f = await leerFallo(res);
        setError(f.error);
        setBloqueo(res.status === 409 ? f.risPegados : []);
        return { ok: false, status: res.status };
      }
      setBloqueo([]);
      return { ok: true, body: await res.json().catch(() => ({})) };
    } catch {
      setError("No hay conexión con el servidor. Probá de nuevo.");
      return { ok: false };
    } finally {
      setOcupado(false);
    }
  }

  async function pegar() {
    const r = await llamar(`/api/mantenimiento/repuestos/${repuesto.id}/ri`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nro_ri: nro.trim() }),
    });
    if (!r.ok) return;
    setNro("");
    setAviso("");
    aplicar(r.body);
    onCambioDeLaCuenta();
  }

  async function sacarRi(n: number) {
    const r = await llamar(`/api/mantenimiento/repuestos/${repuesto.id}/ri?nro_ri=${n}`, { method: "DELETE" });
    if (!r.ok) return;
    setAviso("");
    aplicar(r.body);
    onCambioDeLaCuenta();
  }

  /** Sacar uno de los que bloquean el cambio de artículo: queda la lista que falta. */
  async function sacarElQueBloquea(n: number) {
    const faltan = bloqueo.filter((x) => x !== n);
    const r = await llamar(`/api/mantenimiento/repuestos/${repuesto.id}/ri?nro_ri=${n}`, { method: "DELETE" });
    if (!r.ok) {
      // **Un 404 es «ése ya no está»**, no un fallo de esta lista: lo sacó otra persona
      // entre que se dibujó el panel y se apretó. `llamar` vacía el bloqueo ante
      // cualquier fallo que no sea un 409, y acá eso se llevaría también los números
      // que **sí** siguen frenando: el panel quedaría vacío y habría que apretar
      // «Cambiar» otra vez para recuperarlos. Queda la lista que falta.
      if (r.status === 404) setBloqueo(faltan);
      return;
    }
    setBloqueo(faltan);
    aplicar(r.body);
    onCambioDeLaCuenta();
    if (faltan.length === 0) setError("");
  }

  async function elegir(articuloId: string) {
    // Sin artículo, la cuenta sólo trae los RI que este mismo renglón tenía pegados
    // a sí mismo: eso sí se sabe antes de elegir.
    const teniaPropios = !articulo && (cuenta?.ris.length ?? 0) > 0;
    const r = await llamar(`/api/mantenimiento/repuestos/${repuesto.id}/articulo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articulo_id: articuloId }),
    });
    if (!r.ok) return;
    setEligiendo(false);
    aplicar(r.body);
    // Callado, esto sería una sorpresa: los RI que cuenta el artículo valen desde ahora
    // para todas las órdenes que lo piden. **No se dice de dónde vino cada uno**:
    // `cuenta.ris` no trae la procedencia y pueden ser de otras órdenes o de este
    // mismo renglón; afirmarlo sería inventarlo.
    const hay = r.body.cuenta?.ris.length ?? 0;
    const cuantos = hay === 1 ? "1 RI pegado" : `${hay} RI pegados`;
    setAviso(
      hay === 0
        ? ""
        : teniaPropios
          ? `Con este artículo cuentan ${cuantos}, y los que pegaste a este repuesto antes de elegirlo valen ` +
            "desde ahora para todas las órdenes que piden ese artículo. Para cambiar de artículo hay que sacarlos primero."
          : `Con este artículo cuentan ${cuantos}: valen también para este repuesto.`
    );
    onCambioDeLaCuenta();
    onCambioDelArticulo();
  }

  async function soltar() {
    const r = await llamar(`/api/mantenimiento/repuestos/${repuesto.id}/articulo`, { method: "DELETE" });
    if (!r.ok) return;
    setAviso("");
    aplicar(r.body);
    onCambioDeLaCuenta();
    onCambioDelArticulo();
  }

  async function usarElQueReconocio(codigo: string) {
    const lista = await pedirArticulos();
    if (typeof lista === "string") { setError(lista); return; }
    const encontrado = lista.find((a) => a.codigo === codigo);
    if (!encontrado) { setError("No se encontró ese artículo en el catálogo activo del pañol."); return; }
    await elegir(encontrado.id);
  }

  async function abrirSelector() {
    setEligiendo(true);
    setFalloElCatalogo("");
    const lista = await pedirArticulos();
    if (typeof lista === "string") setFalloElCatalogo(lista);
  }

  const reconocido = !articulo && d?.insumo?.codigo ? d.insumo : null;
  const ris = cuenta?.ris ?? [];
  const estaOrden = cuenta?.estaOrden ?? null;
  const otras = cuenta ? cuenta.partes.length - (estaOrden ? 1 : 0) : 0;

  return (
    <div className="mt-1 space-y-1 text-xs">
      {/* El artículo. Se elige, nunca se completa por parecido: enlazar al que se
          le parece es peor que dejar sin enlace. */}
      <p className="text-slate-600">
        {articulo ? (
          <>
            <span className="font-medium">Artículo del pañol:</span>{" "}
            <span className="font-mono text-slate-400">{articulo.codigo}</span> {articulo.descripcion}
          </>
        ) : (
          <span className="text-slate-400">Sin artículo del pañol elegido.</span>
        )}
        {puedeEditar && !eligiendo && (
          <>
            {" "}
            <button onClick={abrirSelector} disabled={ocupado} className="underline text-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed">
              {articulo ? "Cambiar" : "Elegir artículo"}
            </button>
            {articulo && (
              <>
                {" · "}
                <button onClick={soltar} disabled={ocupado} className="underline text-slate-500 enabled:hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed">
                  Soltar
                </button>
              </>
            )}
          </>
        )}
      </p>

      {/* El inventario lo reconoció por el nombre: se ofrece y la persona acepta. */}
      {puedeEditar && reconocido && !eligiendo && (
        <p className="rounded-lg bg-slate-50 px-2 py-1.5 text-slate-600">
          El inventario lo reconoce como{" "}
          <span className="font-mono text-slate-400">{reconocido.codigo}</span> {reconocido.descripcion}.{" "}
          <button
            onClick={() => usarElQueReconocio(reconocido.codigo!)}
            disabled={ocupado}
            className="underline text-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Usar este artículo
          </button>
        </p>
      )}

      {puedeEditar && eligiendo && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {articulos ? (
              <Select
                value=""
                onChange={(e) => { if (e.target.value) void elegir(e.target.value); }}
                disabled={ocupado}
                className="input"
                aria-label={`Artículo del pañol para ${repuesto.nombre}`}
              >
                <option value="">Buscá por código o descripción…</option>
                {articulos.map((a) => (
                  <option key={a.id} value={a.id}>{a.codigo} · {a.descripcion}</option>
                ))}
              </Select>
            ) : (
              falloElCatalogo ? (
                <span className="text-red-600">
                  {falloElCatalogo}{" "}
                  <button onClick={abrirSelector} className="underline">Reintentar</button>
                </span>
              ) : (
                <span className="text-slate-400">Cargando el catálogo del pañol…</span>
              )
            )}
          </div>
          <button onClick={() => setEligiendo(false)} className="shrink-0 underline text-slate-500">
            Cancelar
          </button>
        </div>
      )}

      {error && <p className="text-red-600">{error}</p>}

      {/* Lo que impide cambiar el artículo, con cada número para sacarlo de acá. */}
      {bloqueo.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
          <p>
            Estos RI valen para todas las órdenes que piden este artículo.
            Sacalos para poder cambiarlo o soltarlo:
          </p>
          <ul className="mt-1 space-y-0.5">
            {bloqueo.map((n) => (
              <li key={n}>
                RI {n}{" "}
                <button onClick={() => sacarElQueBloquea(n)} disabled={ocupado} className="underline enabled:hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
                  Sacar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {aviso && <p className="text-amber-700">{aviso}</p>}
      {advertencia && <p className="text-amber-700">{advertencia}</p>}

      {/* Lo que cubre cada RI pegado a mano. Aparte del cruce por nombre. */}
      {ris.length > 0 && (
        <div className="rounded-lg border border-slate-200 px-2 py-1.5 text-slate-700">
          <p className="font-medium">RI pegados</p>
          <ul className="mt-0.5 space-y-0.5">
            {ris.map((ri) => (
              <li key={ri.nro_ri}>
                <a href={`/compras/requerimientos?q=${ri.nro_ri}`} className="underline">RI {ri.nro_ri}</a>
                {ri.estado_compra && (
                  <span className="text-slate-500">
                    {" "}· {COMPRA_LABELS[ri.estado_compra as EstadoCompra]?.label ?? ri.estado_compra}
                  </span>
                )}
                {ri.cantidad != null && (
                  <span className="text-slate-500">
                    {" "}· pidió {numero.format(ri.cantidad)}
                    {ri.cantidad_recibida ? `, llegaron ${numero.format(ri.cantidad_recibida)}` : ""}
                  </span>
                )}
                {puedeEditar && (
                  <>
                    {" "}
                    <button onClick={() => sacarRi(ri.nro_ri)} disabled={ocupado} className="underline text-slate-400 enabled:hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed">
                      Sacar
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          {ris.length > 1 && (
            <p className="mt-1 text-amber-700">
              Hay {ris.length} RI pegados: lo que traen se suma y se reparte entre las órdenes
              abiertas que piden esto, la más vieja primero.
            </p>
          )}
          {articulo && (
            <p className="mt-1 text-slate-500">
              Valen para todas las órdenes abiertas que piden este artículo
              {otras > 0 ? ` (hay ${otras} más)` : ""}, no sólo para ésta.
            </p>
          )}
          {estaOrden &&
            (estaOrden.pide == null ? (
              <p className="mt-1 text-slate-500">
                Esta orden no tiene una cantidad que se pueda leer, así que no se puede repartir.
              </p>
            ) : (
              <p className="mt-1 font-medium">
                Esta orden pide {numero.format(estaOrden.pide)}: {numero.format(estaOrden.cubiertas)} cubiertas
                por RI pegados, falta pedir {numero.format(estaOrden.faltaPedir)}.
              </p>
            ))}
        </div>
      )}

      {puedeEditar && (
        <div className="flex items-center gap-2">
          <div className="w-28">
            <input
              value={nro}
              onChange={(e) => setNro(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && nro.trim() && !ocupado) void pegar(); }}
              inputMode="numeric"
              placeholder="N° de RI"
              aria-label={`Número de RI para ${repuesto.nombre}`}
              className="input"
            />
          </div>
          <button onClick={pegar} disabled={ocupado || !nro.trim()} className="btn-secondary shrink-0">
            Pegar RI
          </button>
        </div>
      )}
    </div>
  );
}

/** «2025-11-18» → «18/11». `fecha` es un `date` de Postgres: sin hora ni huso. */
function diaYMes(fecha: string | null): string {
  const m = fecha?.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : "sin fecha";
}

/** «18/11, 2 un. (ORTIZ, Facundo)»: lo que alcanza para reconocer una salida. */
function resumenDeLaSalida(s: SalidaDelPanol): string {
  const quien = s.solicitante?.trim();
  return `${diaYMes(s.fecha)}, ${numero.format(s.cantidad)} un.${quien ? ` (${quien})` : ""}`;
}

/**
 * De qué salida del pañol salió el repuesto: lo que prueba que la pieza se
 * aplicó. Pedirla no es usarla; la salida sí, y acá una persona dice cuál.
 *
 * **El estado lo decide `aplicacionDelRenglon()` y no una comprobación de acá**:
 * es lo único de esta parte que tiene tests, y deducirlo en el JSX los dejaría
 * sin nada que proteger. Lo único que se mira antes es el renglón sin artículo
 * y sin vínculo, que no es un estado de la función sino su ausencia: hoy es el
 * de los 37 renglones que hay (0 de 37 tienen artículo), así que es la cara
 * habitual y no un borde.
 *
 * Si hay vínculo y no se pudo leer la salida (`sin-ver`: quien mira no tiene
 * Inventario, o falló la lectura) se dice eso y **se deja el botón de sacar**:
 * soltar el vínculo no necesita leer el movimiento. Sin esa rama, un renglón bien
 * vinculado se leería como «sin movimiento» y alguien declararía dos veces.
 *
 * Las candidatas las trae el servidor, recién al abrir el selector. Es una lista
 * de botones y no un `<Select>`: son diez como máximo y cada una lleva cinco
 * datos que hay que ver para reconocerla, cosa que una opción de desplegable no
 * deja. No es un selector de OT: la orden es el contexto.
 */
function SalidaDelPanolDelRenglon({
  repuesto, puedeEditar, onCambio,
}: {
  repuesto: Repuesto;
  puedeEditar: boolean;
  /** Se declaró o se sacó: hay que volver a leer los renglones. */
  onCambio: () => void;
}) {
  const [eligiendo, setEligiendo] = useState(false);
  const [candidatas, setCandidatas] = useState<SalidaDelPanol[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  /** Si la lista que se está mirando es la acotada o la que levantó la ventana. */
  const [verTodas, setVerTodas] = useState(false);

  const url = `/api/mantenimiento/repuestos/${repuesto.id}/movimiento`;
  // El artículo sale de la **fila** y sólo después del embed: la fila se lee
  // detrás de `mant_puede_ver()` y el embed detrás de `tiene_acceso_inventario()`,
  // así que a quien tenga Mantenimiento y no Inventario el embed le llega `null`
  // sin error y el renglón pasaría por «sin artículo» — con un vínculo puesto eso
  // da `otra-pieza`, o sea acusar de apuntar a otra pieza un vínculo perfecto.
  const articuloId = repuesto.articulo_id ?? repuesto.articulo?.id ?? null;
  const movimientoId = repuesto.movimiento_id ?? null;

  /** Un fallo se dice con lo que contestó el servidor, sin traducir. */
  async function escribir(init: RequestInit): Promise<boolean> {
    setOcupado(true);
    setError("");
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "No se pudo completar la acción.");
        return false;
      }
      return true;
    } catch {
      setError("No hay conexión con el servidor. Probá de nuevo.");
      return false;
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Trae las candidatas. Con `todas` el servidor ancla en la primera entrada del
   * artículo y no corta por días: es la misma lista, sin el recorte. Lo que no
   * levanta es el tope de diez.
   */
  async function abrir(todas = false) {
    setEligiendo(true);
    setCandidatas(null);
    setMotivo("");
    setError("");
    try {
      const res = await fetch(todas ? `${url}?todas=1` : url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? "No se pudieron traer las salidas del pañol."); return; }
      setCandidatas(body.candidatas ?? []);
      setMotivo(body.motivo ?? "");
      // El estado sale de lo que el servidor **hizo** y no de lo que se le pidió.
      // La ruta devuelve `todas` justamente para esto: fijarlo antes del fetch
      // dejaba la pantalla afirmando «estás viendo todas» aunque el pedido
      // fallara, y es lo que decide cuál de los dos botones se ofrece.
      setVerTodas(body.todas ?? todas);
    } catch {
      setError("No se pudieron traer las salidas del pañol: no hay conexión con el servidor.");
    }
  }

  async function declarar(movimiento: SalidaDelPanol) {
    const ok = await escribir({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movimiento_id: movimiento.id }),
    });
    if (!ok) return;
    setEligiendo(false);
    setVerTodas(false);
    onCambio();
  }

  async function sacarElVinculo() {
    if (!(await escribir({ method: "DELETE" }))) return;
    onCambio();
  }

  const botonDeSacar = puedeEditar && (
    <>
      {" "}
      <button
        onClick={sacarElVinculo}
        disabled={ocupado}
        className="underline text-slate-500 enabled:hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Sacar
      </button>
    </>
  );

  let linea: React.ReactNode;
  if (!movimientoId && !articuloId) {
    linea = <span className="text-slate-400">Salió del pañol: elegí primero el artículo</span>;
  } else {
    const aplicacion = aplicacionDelRenglon(
      { articulo_id: articuloId, movimiento_id: movimientoId },
      repuesto.movimiento ?? null,
    );
    switch (aplicacion.estado) {
      case "aplicado":
        linea = (
          <>
            <span className="text-slate-600">
              Salió del pañol: {resumenDeLaSalida(repuesto.movimiento!)}
            </span>
            {botonDeSacar}
          </>
        );
        break;
      case "otra-pieza":
        linea = (
          <>
            <span className="text-amber-700">
              {/* No dice «es de otro artículo» a secas: también cae acá el renglón
                  al que le sacaron el artículo después de declarar, y ahí no hay
                  con qué comparar. Lo cierto en los dos casos es la negación. */}
              Salió del pañol: la salida declarada no es del artículo de este repuesto
            </span>
            {botonDeSacar}
          </>
        );
        break;
      case "sin-ver":
        linea = (
          <>
            <span className="text-amber-700">
              Salió del pañol: hay una salida declarada que no se pudo leer
            </span>
            {botonDeSacar}
          </>
        );
        break;
      case "sin-justificar":
        linea = (
          <>
            <span className="text-slate-400">Salió del pañol: —</span>
            {puedeEditar && !eligiendo && (
              <>
                {" "}
                {/* `() => abrir()` y no `abrir`: React le pasaría el evento al
                    primer parámetro y `todas` quedaría en «sí» sin que nadie lo pida. */}
                <button
                  onClick={() => abrir()}
                  disabled={ocupado}
                  className="underline text-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Declarar la salida
                </button>
              </>
            )}
          </>
        );
        break;
    }
  }

  return (
    <div className="mt-1 space-y-1 text-xs">
      <p>{linea}</p>

      {puedeEditar && eligiendo && (
        <div className="rounded-lg border border-slate-200 px-2 py-1.5">
          {!candidatas && !error && <p className="text-slate-400">Buscando las salidas del pañol…</p>}
          {candidatas && candidatas.length === 0 && (
            <p className="text-slate-600">{motivo || "No hay salidas del pañol para elegir."}</p>
          )}
          {candidatas && candidatas.length > 0 && (
            <>
              <p className="text-slate-600">
                Elegí la salida que se usó para esta orden:
                {verTodas && (
                  <span className="text-slate-400">
                    {" "}ya no está acotada a los {DIAS_DE_LA_VENTANA} días — son las posteriores a la
                    primera entrada del artículo.
                  </span>
                )}
              </p>
              <ul className="mt-1 space-y-1">
                {candidatas.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => declarar(c)}
                      disabled={ocupado}
                      className="block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-left hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="font-medium text-slate-800">
                        {diaYMes(c.fecha)} · {numero.format(c.cantidad)} un.
                      </span>
                      {c.solicitante && <span className="text-slate-600"> · {c.solicitante}</span>}
                      {/* Con rótulo cada uno: «Planta 0-2 · Molino 3» no dice cuál es
                          el sector y cuál la máquina, y los dos textos son libres. */}
                      {(c.sector_raw || c.equipo_raw) && (
                        <span className="block text-slate-500">
                          {c.sector_raw && <>Sector: {c.sector_raw}</>}
                          {c.sector_raw && c.equipo_raw && " · "}
                          {c.equipo_raw && <>Máquina: {c.equipo_raw}</>}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* «Ver todas» cuando la lista volvió vacía o volvió topeada: son los dos
              casos en los que lo que se busca puede estar fuera del recorte. La
              ficha de un RI arranca en la entrada de *ese* pedido, y 400 de las 766
              entradas con RI tienen una entrada posterior del mismo artículo: sin
              esto, una salida que allá dice «sin justificar» acá no se puede
              declarar. El tope de diez sigue puesto, así que en un artículo con más
              de diez salidas nuevas una vieja sigue sin alcanzarse — es el
              consumible, que no es lo que esta función traza. */}
          {candidatas && !verTodas && (candidatas.length === 0 || candidatas.length === TOPE_DE_CANDIDATAS) && (
            <p className="mt-1">
              <button
                onClick={() => abrir(true)}
                disabled={ocupado}
                className="underline text-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Ver todas
              </button>
              <span className="text-slate-400">
                {" "}— sin el corte de los {DIAS_DE_LA_VENTANA} días, desde la primera entrada del artículo.
              </span>
            </p>
          )}
          {/* Y la vuelta, que no es prolijidad. Levantar la ventana la levanta
              **hacia adelante**, y el orden es «la más nueva primero»: las
              salidas posteriores que entran ordenan ANTES y empujan afuera a las
              que la lista corta mostraba, porque el tope de diez sigue puesto.
              Medido el 24/11/2026 sobre las 766 entradas con RI
              (`scripts/que-mostraria-la-trazabilidad.mts`): de las 545 que
              ofrecen candidatas, «ver todas» pierde alguna de las que mostraba
              en 168, y en **121 no queda ninguna**. Sin este botón, quien
              apretó «ver todas» buscando una más perdía de vista la que estaba
              mirando y no tenía cómo recuperarla. */}
          {candidatas && verTodas && (
            <p className="mt-1">
              <button
                onClick={() => abrir(false)}
                disabled={ocupado}
                className="underline text-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Volver a las últimas
              </button>
              <span className="text-slate-400">
                {" "}— las de los {DIAS_DE_LA_VENTANA} días desde la entrada.
              </span>
            </p>
          )}

          <button
            onClick={() => { setEligiendo(false); setVerTodas(false); }}
            className="mt-1 underline text-slate-500"
          >
            Cancelar
          </button>
        </div>
      )}

      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Sumar un repuesto, buscándolo en el inventario.
 *
 * Buscar antes de escribir es lo que hace que el código quede bien puesto: con
 * el código, después se sabe si hay stock sin adivinar por el nombre.
 */
function Agregar({
  ordenId, onAgregado, onError, renglon,
}: {
  ordenId: string;
  onAgregado: () => void;
  onError: (e: string) => void;
  /** El renglón a medio escribir, que vive en el modal: ver su comentario. */
  renglon: {
    valores: { nombre: string; codigo: string; cantidad: string };
    cambiar: (p: Partial<{ nombre: string; codigo: string; cantidad: string }>) => void;
    tocado: boolean;
    tirar: () => void;
  };
}) {
  const { nombre, codigo, cantidad } = renglon.valores;
  const [sugerencias, setSugerencias] = useState<Insumo[]>([]);
  const [avisoBusqueda, setAvisoBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Se busca mientras se escribe, pero recién cuando hay letras suficientes:
  // con dos, el inventario entero es una sugerencia.
  useCargar(async (vigente) => {
    if (nombre.trim().length < 3) { setSugerencias([]); return; }

    await new Promise((r) => setTimeout(r, 300));
    if (!vigente()) return;

    const res = await fetch(`/api/mantenimiento/inventario?q=${encodeURIComponent(nombre.trim())}`);
    const body = await res.json().catch(() => ({}));
    if (!vigente()) return;

    // Antes acá había un `if (!res.ok) return;` y después `setSugerencias`: si
    // el inventario no estaba disponible, escribías y no aparecía nada, sin
    // forma de distinguir "no hay ningún repuesto así" de "no se pudo
    // consultar". Un buscador que calla las dos cosas igual no se puede usar.
    if (!res.ok) { setAvisoBusqueda("No se pudo buscar en el inventario."); return; }

    setAvisoBusqueda(
      body.error ?? (body.cargado === false ? "El inventario todavía no se importó." : "")
    );
    setSugerencias(body.data ?? []);
  }, [nombre]);

  async function agregar() {
    if (!nombre.trim()) return;
    setGuardando(true);

    const res = await fetch(`/api/mantenimiento/ordenes/${ordenId}/repuestos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre: nombre.trim(), codigo: codigo.trim(), cantidad: cantidad.trim() }),
    });
    setGuardando(false);

    if (!res.ok) {
      onError((await res.json().catch(() => ({}))).error ?? "No se pudo agregar.");
      return;
    }
    // Sumado: lo que había a medio escribir ya es un repuesto de la lista.
    renglon.tirar();
    setSugerencias([]);
    onAgregado();
  }

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="relative">
        <input
          value={nombre}
          onChange={(e) => renglon.cambiar({ nombre: e.target.value })}
          placeholder="Rodamiento 6206, correa B-75…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {avisoBusqueda && (
          <p className="mt-1 text-xs text-amber-700">{avisoBusqueda}</p>
        )}
        {sugerencias.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {sugerencias.map((s, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    renglon.cambiar({ nombre: s.descripcion ?? "", codigo: s.codigo ?? "" });
                    setSugerencias([]);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                >
                  <span className="text-slate-800">{s.descripcion}</span>
                  {s.codigo && <span className="ml-1.5 font-mono text-xs text-slate-400">{s.codigo}</span>}
                  {s.stock !== null && <span className="ml-1.5 text-xs text-slate-400">· {s.stock}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={codigo}
          onChange={(e) => renglon.cambiar({ codigo: e.target.value })}
          placeholder="Código"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={cantidad}
          onChange={(e) => renglon.cambiar({ cantidad: e.target.value })}
          placeholder="Cantidad"
          className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          onClick={agregar}
          disabled={guardando || !nombre.trim()}
          className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Sumar
        </button>
      </div>

      {/* El botón negativo de esta pantalla, y el único que tira el renglón.
          Aparece sólo con algo escrito: un «Borrar» permanente al lado de tres
          campos vacíos es ruido. */}
      {renglon.tocado && (
        <button
          type="button"
          onClick={() => { renglon.tirar(); setSugerencias([]); }}
          className="text-xs text-slate-400 underline hover:text-red-600"
        >
          Borrar lo escrito
        </button>
      )}
    </div>
  );
}

/**
 * «Esto ya está pedido», cuando lo está.
 *
 * Dos listas y no una, porque no tienen la misma certeza: el mismo **código**
 * es el mismo artículo, y el nombre parecido puede ser otra cosa. Mezclarlas
 * daría una sola afirmación con dos niveles de confianza adentro, y de ahí sale
 * el falso «ya está pedido» que termina en que la pieza no se pida nunca.
 *
 * Por eso tampoco bloquea nada: informa y el botón de pedir sigue estando. El
 * porqué, con los números, está en `lib/mantenimiento/riDelRepuesto.ts`.
 */
function YaPedido({ ris }: { ris?: { porCodigo: RiEnVuelo[]; porNombre: RiEnVuelo[] } }) {
  if (!ris || (ris.porCodigo.length === 0 && ris.porNombre.length === 0)) return null;

  return (
    <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      {ris.porCodigo.length > 0 && (
        <p>
          <span className="font-medium">Ya pedido:</span>{" "}
          <Numeros ris={ris.porCodigo} />
        </p>
      )}
      {ris.porNombre.length > 0 && (
        <p className={ris.porCodigo.length > 0 ? "mt-1" : undefined}>
          {/* "Puede ser" y no "es": coincide el nombre, que lo escribio una
              persona, y no el codigo. */}
          <span className="font-medium">Puede que ya esté pedido:</span>{" "}
          <Numeros ris={ris.porNombre} />
        </p>
      )}
    </div>
  );
}

/** Los RI, con su estado y su fecha: sin eso un número no dice si avanza. */
function Numeros({ ris }: { ris: RiEnVuelo[] }) {
  return (
    <>
      {ris.map((r, i) => (
        <span key={r.nro_ri}>
          {i > 0 && ", "}
          <a
            href={`/compras/requerimientos?q=${r.nro_ri}`}
            className="underline"
            title={r.descripcion ?? undefined}
          >
            RI {r.nro_ri}
          </a>
          {r.estado_compra && (
            <span className="text-amber-700">
              {" "}· {COMPRA_LABELS[r.estado_compra as EstadoCompra]?.label ?? r.estado_compra}
            </span>
          )}
        </span>
      ))}
    </>
  );
}
