"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
// `altaDeReposicion` vive en el lib y no acá porque la arma también el stock,
// que desde el 5/10/2026 puede pedir un faltante sin pasar por esta pantalla.
// `ordenarParaReponer` también: el criterio y su rótulo son la misma decisión.
import {
  DIAS_DE_CONSUMO, altaDeReposicion, ordenarParaReponer, filtrarParaReponer,
  ORDENES_DE_REPOSICION, ORDEN_POR_DEFECTO,
  type Candidato, type ConPedido, type Desestimado, type OrdenDeReposicion,
} from "@/lib/inventario/reponer";
import { textoDeLaDesestimacion } from "@/lib/inventario/desestimar";
import { fecha } from "@/lib/compras/constants";
import { COMPRA_LABELS } from "@/lib/compras/constants";
import Select from "@/components/Select";
import NuevoRequerimientoModal, {
  type ValoresIniciales,
} from "@/app/(app)/compras/requerimientos/NuevoRequerimientoModal";

type Opcion = { id: string; nombre: string };

/**
 * Qué reponer, en tres grupos.
 *
 * La separación es el punto. Arriba lo que hay que pedir; después lo que ya
 * tiene un pedido, diciendo cuál y de cuándo; y al final lo que alguien
 * desestimó. Ocultar los dos últimos dejaría a quien busca algo que sabe que
 * falta sin saber si el sistema no lo vio, si ya está pedido o si alguien dijo
 * que no, que son tres problemas con tres arreglos distintos.
 */
export default function ReponerClient({
  paraPedir, yaPedidos, desestimados, puedeDesestimar, areas, empresas, ubicaciones,
}: {
  paraPedir: Candidato[];
  yaPedidos: ConPedido[];
  desestimados: Desestimado[];
  /** Mismo nivel que registrar un movimiento. La ruta lo vuelve a comprobar. */
  puedeDesestimar: boolean;
  areas: Opcion[];
  empresas: Opcion[];
  ubicaciones: Opcion[];
}) {
  const router = useRouter();
  const [pidiendo, setPidiendo] = useState<ValoresIniciales | null>(null);
  const [desestimando, setDesestimando] = useState<Candidato | null>(null);
  const [error, setError] = useState("");
  const [pedido, setPedido] = useState("");
  const [orden, setOrden] = useState<OrdenDeReposicion>(ORDEN_POR_DEFECTO);
  const [busqueda, setBusqueda] = useState("");
  const buscando = busqueda.trim() !== "";

  // Un solo buscador y un solo orden para los dos grupos, a propósito. Son la
  // misma lista partida por "¿ya está pedido?", y dos controles invitarían a
  // dejarlos en criterios distintos: buscar un artículo pediría mirar dos
  // listas ordenadas de dos maneras.
  //
  // Primero filtrar y después ordenar, que es el orden barato: ordenar 92
  // filas para después tirar 90 es trabajo que no se ve pero se hace en cada
  // tecla.
  const pedirVisibles = useMemo(
    () => ordenarParaReponer(filtrarParaReponer(paraPedir, busqueda), orden),
    [paraPedir, busqueda, orden]
  );
  const pedidosVisibles = useMemo(
    () => ordenarParaReponer(filtrarParaReponer(yaPedidos, busqueda), orden),
    [yaPedidos, busqueda, orden]
  );
  const desestimadosVisibles = useMemo(
    () => ordenarParaReponer(filtrarParaReponer(desestimados, busqueda), orden),
    [desestimados, busqueda, orden]
  );

  /**
   * Volver a considerar un faltante desestimado.
   *
   * Y desestimar está en el modal de abajo, que es el que pide el motivo. Las
   * dos recargan desde el servidor en vez de tocar el estado local: quién lo
   * desestimó, cuándo y contra qué movimiento se mide los decide la ruta, y
   * adivinarlos acá sería tener dos versiones de lo mismo en pantalla.
   */
  async function volverAConsiderar(articuloId: string) {
    setError("");
    const r = await fetch(
      `/api/inventario/faltantes-desestimados?articulo_id=${encodeURIComponent(articuloId)}`,
      { method: "DELETE" }
    );
    if (!r.ok) {
      setError((await r.json().catch(() => null))?.error ?? "No se pudo volver a considerarlo.");
      return;
    }
    router.refresh();
  }

  // Qué decir cuando arriba no hay nada, que no es siempre lo mismo. «No hay
  // nada para reponer» con filas debajo es mentira, y «nada coincide» mientras
  // el grupo de abajo muestra lo que se buscó, también.
  const nadaParaPedir =
    pedidosVisibles.length > 0
      ? buscando
        ? "Lo que coincide ya está pedido. Mirá abajo cuál es cada pedido."
        : "Lo que falta ya está pedido. Mirá abajo cuál es cada pedido."
      : buscando
        ? `Nada coincide con «${busqueda.trim()}».`
        : "No hay nada para reponer.";

  return (
    // `max-w-4xl` como `ListaClient`, la pantalla vecina con el mismo ritmo de
    // secciones: sin tope, en escritorio la lista se estira de lado a lado y el
    // botón queda lejos de los datos que le corresponden.
    <div className="mx-auto max-w-4xl space-y-6 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Para reponer</h1>
        <p className="text-sm text-slate-500">
          Artículos por debajo del stock de seguridad que además se usaron en los
          últimos {DIAS_DE_CONSUMO} días. El que no se mueve hace meses no entra
          acá: está en{" "}
          <Link href="/inventario/stock?faltantes=1" className="underline hover:text-slate-700">
            el stock con faltante
          </Link>.
        </p>
      </div>

      {/* Sólo si hay algo que filtrar: un buscador sobre una lista vacía es un
          control que promete que la pantalla podría decir otra cosa. */}
      {paraPedir.length + yaPedidos.length + desestimados.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {/* `w-full` abajo de `sm` y `flex-1` arriba: a 343px el buscador y el
              selector no entran en la misma línea, y partir el ancho deja dos
              controles que no se pueden usar en vez de uno que sí. */}
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por descripción o código"
            aria-label="Buscar en la lista"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-auto sm:flex-1"
          />
          <Select
            // No lleva rótulo aparte porque cada opción ya dice «Ordenar
            // por…», como en el listado de proveedores.
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-auto"
            aria-label="Ordenar la lista"
            value={orden}
            onChange={(e) => setOrden(e.target.value as OrdenDeReposicion)}
          >
            {ORDENES_DE_REPOSICION.map((o) => (
              <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
            ))}
          </Select>
        </div>
      )}

      {/* Arriba y no al final de la lista: son 17 filas o más, y quien aprieta
          Pedir en una del medio, parado en el pañol y con el celular en la mano,
          no ve lo que pasa debajo de la última. Sin esto la fila se va y no
          queda dicho adónde. */}
      {pedido && (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {pedido} Lo vas a ver en{" "}
          <Link href="/mis-pedidos" className="underline">Mis pedidos</Link>.
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="section-title">
          Para pedir <Cuenta visibles={pedirVisibles.length} total={paraPedir.length} />
        </h2>

        {pedirVisibles.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            {/* Tres vacíos distintos, y el porqué está arriba, donde se arma el
                texto: «No hay nada para reponer» con 17 artículos faltando
                debajo es mentira. */}
            {nadaParaPedir}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {pedirVisibles.map((c) => (
              // Sin `flex-wrap`: acá el botón no compite con nada que valga la
              // pena bajar de línea. `Detalle` tiene base 0 y se queda con lo que
              // sobra al lado del botón (~230px a 375px de ancho).
              <li key={c.articulo.id} className="flex items-center gap-3 px-4 py-3">
                {/* «Desestimar» va **debajo** del detalle y no al lado de
                    «Pedir». A 343px los dos botones juntos se comen 160px y
                    dejan la descripción en una palabra; y además no son dos
                    acciones del mismo peso: una abre el pedido y la otra saca
                    la fila de la lista. Chico y gris es lo que corresponde. */}
                <div className="min-w-0 flex-1">
                  <Detalle c={c} />
                  {puedeDesestimar && (
                    <button
                      onClick={() => { setError(""); setDesestimando(c); }}
                      className="mt-1 text-xs text-slate-500 underline hover:text-slate-900"
                    >
                      Desestimar
                    </button>
                  )}
                </div>
                {/* `min-h-10` (40px) y no el `py-1.5` de un botón de tabla: se
                    aprieta con el pulgar, de pie, a veces con guantes. */}
                <button
                  onClick={() => setPidiendo(altaDeReposicion(c.articulo))}
                  className="min-h-10 shrink-0 rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
                >
                  Pedir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Con una búsqueda puesta, el grupo entero desaparece si nada coincide:
          una sección con su título, su aclaración y ninguna fila se lee como
          un error. Lo que no coincide ya lo dice el vacío de arriba. */}
      {pedidosVisibles.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">
            Ya pedidos <Cuenta visibles={pedidosVisibles.length} total={yaPedidos.length} />
          </h2>
          <p className="text-xs text-slate-500">
            Faltan y se usan, pero ya tienen un pedido en curso. No hace falta
            volver a pedirlos.
          </p>

          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {pedidosVisibles.map((c) => {
              // Una sola vez: era la misma búsqueda dos veces en la misma línea,
              // una para el color y otra para el texto.
              const compra = COMPRA_LABELS[c.ri.estado_compra as keyof typeof COMPRA_LABELS];
              return (
                // Apilado, no `flex-wrap`. Con `flex-wrap` el `Detalle` tiene base 0
                // y el navegador lo deja en la misma línea que el bloque del RI,
                // dándole lo que sobra. Medido con una maqueta a 375px: con «RI
                // 1941 · hace 29 días · Pedido» el `Detalle` queda en 152px, y con
                // «3 pedidos abiertos» —que es el caso real del 00666— queda en
                // 37px: la descripción se corta en una letra y la fila mide 282px
                // de alto. Y no alcanza con ponerlo al lado desde `sm`: con el
                // menú lateral abierto (240px) el contenido a 768px es poco más de
                // 500px, el mismo problema. Dos líneas siempre es más corto que una
                // descripción ilegible, y acá no hay botón que compita.
                <li key={c.articulo.id} className="flex flex-col gap-1 px-4 py-3">
                  <Detalle c={c} />
                  <span className="text-xs text-slate-500">
                    <Link href={`/compras/requerimientos/${c.ri.id}`} className="underline hover:text-slate-900">
                      RI {c.ri.nro_ri}
                    </Link>
                    {" · "}
                    {c.diasDelRi === 0 ? "hoy" : `hace ${c.diasDelRi} días`}
                    {c.cuantosAbiertos > 1 && ` · ${c.cuantosAbiertos} pedidos abiertos`}
                    {" "}
                    <span className={`rounded px-1.5 py-0.5 ${compra?.color ?? "bg-gray-100 text-gray-600"}`}>
                      {compra?.label ?? "Sin iniciar"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Igual que «Ya pedidos»: con una búsqueda puesta, si nada coincide la
          sección entera desaparece en vez de mostrar un título sin filas. */}
      {desestimadosVisibles.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">
            Desestimados <Cuenta visibles={desestimadosVisibles.length} total={desestimados.length} />
          </h2>
          <p className="text-xs text-slate-500">
            Alguien decidió no reponerlos. Vuelven solos a «Para pedir» en cuanto
            el artículo tenga un movimiento de un día posterior al último que
            había cuando se desestimó.
          </p>

          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {desestimadosVisibles.map((c) => (
              // Apilado, por lo mismo que «Ya pedidos»: el texto de quién lo
              // desestimó y por qué es largo y al lado dejaría la descripción
              // cortada en una letra.
              <li key={c.articulo.id} className="flex flex-col gap-1 px-4 py-3">
                <Detalle c={c} />
                <span className="text-xs text-slate-500">
                  {textoDeLaDesestimacion(c.desestimacion, fecha)}
                </span>
                {puedeDesestimar && (
                  <button
                    onClick={() => volverAConsiderar(c.articulo.id)}
                    className="self-start text-xs font-medium text-[var(--primary)] underline hover:opacity-80"
                  >
                    Volver a considerarlo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {desestimando && (
        <DesestimarModal
          candidato={desestimando}
          onClose={() => setDesestimando(null)}
          onError={(m) => { setDesestimando(null); setError(m); }}
          onHecho={() => {
            setDesestimando(null);
            router.refresh();
          }}
        />
      )}

      {/* El formulario de Compras, tal cual: uno solo para los dos lados, así un
          campo que se agregue allá aparece acá sin que nadie se acuerde. Se
          abre, no se envía — el paso de aprobación que hoy da una persona
          apretando GENERAR PEDIDO en la planilla se conserva igual. */}
      {pidiendo && (
        <NuevoRequerimientoModal
          areas={areas}
          empresas={empresas}
          ubicaciones={ubicaciones}
          inicial={pidiendo}
          onClose={() => setPidiendo(null)}
          onSaved={() => {
            setPedido(`Pedido cargado: ${pidiendo.descripcion}.`);
            setPidiendo(null);
            // Sin esto la fila se queda en «Para pedir» con su botón, y quien
            // acaba de pedir lo ve y lo vuelve a apretar: un segundo RI. El alta
            // escribe la fila en la base en el momento (nace con el código y
            // `SIN_INICIAR`), así que al recargar los datos del servidor el
            // artículo ya cuenta como pedido y pasa solo a «Ya pedidos». No hay
            // que esperar ninguna sincronización con la planilla. Es lo mismo que
            // hace Mis pedidos después de un alta.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * El número al lado del título.
 *
 * Con una búsqueda puesta dice «3 de 75» y no «3». Es la misma trampa que el
 * filtro de órdenes de servicio deja anotada: un filtro puesto se vuelve
 * invisible al scrollear, y entonces una lista corta se lee como una lista
 * vacía en vez de como una lista filtrada.
 */
function Cuenta({ visibles, total }: { visibles: number; total: number }) {
  return (
    <span className="font-normal text-slate-400">
      · {visibles}
      {visibles !== total && ` de ${total}`}
    </span>
  );
}

/**
 * Desestimar un faltante, con el motivo.
 *
 * **El motivo es opcional**, y el modal existe igual. Obligarlo es la forma más
 * rápida de llenar la tabla de «x»; sacar el modal y desestimar de un click es
 * la forma más rápida de que alguien saque una fila sin querer. Un paso que se
 * puede contestar con Enter y que de paso dice qué va a pasar después es el
 * punto medio.
 */
function DesestimarModal({
  candidato, onClose, onHecho, onError,
}: {
  candidato: Candidato;
  onClose: () => void;
  onHecho: () => void;
  onError: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const r = await fetch("/api/inventario/faltantes-desestimados", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ articulo_id: candidato.articulo.id, motivo: motivo.trim() || null }),
    }).catch(() => null);

    if (!r?.ok) {
      onError((await r?.json().catch(() => null))?.error ?? "No se pudo desestimar.");
      return;
    }
    onHecho();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="card w-full max-w-md space-y-3">
        <h2 className="text-base font-semibold text-slate-900">No reponer este artículo</h2>
        <p className="text-sm text-slate-600">
          <span className="font-medium">{candidato.articulo.descripcion}</span>{" "}
          <span className="font-mono text-xs text-slate-500">{candidato.articulo.codigo}</span>
        </p>
        <p className="text-xs text-slate-500">
          Sale de «Para pedir» y pasa a «Desestimados». Vuelve solo en cuanto el
          artículo tenga un movimiento nuevo.
        </p>

        <label className="block text-sm">
          <span className="text-slate-700">Motivo (opcional)</span>
          <textarea
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Se discontinuó, el mínimo está mal cargado, se reemplazó por otro…"
            className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={guardando}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} className="btn-primary" disabled={guardando}>
            {guardando ? "Guardando…" : "Desestimar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lo que se ve de un artículo, igual en los tres grupos. */
function Detalle({ c }: { c: Candidato }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-slate-900">{c.articulo.descripcion}</p>
      <p className="text-xs text-slate-500">
        <span className="font-mono">{c.articulo.codigo}</span>
        {" · "}
        <span className={c.articulo.stock_actual === 0 ? "font-semibold text-red-600" : ""}>
          {c.articulo.stock_actual}
        </span>
        {" de un mínimo de "}{c.articulo.stock_seguridad}
        {" · "}
        {c.salidas === 1 ? "1 salida" : `${c.salidas} salidas`} en {DIAS_DE_CONSUMO} días
        {", la última "}
        {c.diasDesdeLaUltima === 0 ? "hoy" : `hace ${c.diasDesdeLaUltima} días`}
      </p>
    </div>
  );
}
