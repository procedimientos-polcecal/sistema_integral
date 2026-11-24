"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { comoSeLee, hoyEnArgentina } from "@/lib/core/fechas";
import CalendarioDeOT, { type OrdenDelDia, type EstadoDelCalendario } from "./CalendarioDeOT";
import {
  indicadoresDelMes, indicadoresDeHoy,
  type IndicadoresDelMes, type IndicadoresDeHoy,
} from "@/lib/mantenimiento/resumenImpreso";
import { LEYENDA_IMPRESA } from "@/lib/mantenimiento/marcasImpresas";
import FranjaDelTaller from "./FranjaDelTaller";
import PostergarOTModal from "./PostergarOTModal";
import AsignarOperariosModal from "./AsignarOperariosModal";
import type { FranjaDeLaSemana } from "@/lib/mantenimiento/rotacionDeLaSemana";
import type { OperarioDelCatalogo } from "@/lib/mantenimiento/operarioDelCatalogo";
import type { Turno } from "@/lib/mantenimiento/programacion";

/** Lo que trae `/api/mantenimiento/taller-del-mes`. */
export interface TallerDelMes {
  franjas: FranjaDeLaSemana[];
  catalogo: OperarioDelCatalogo[];
  noVienen: Record<string, string[]>;
  turnos: Record<string, Turno>;
}

/**
 * La pestaña «Mes»: el mismo calendario que se abre al cargar una OT, pero acá
 * sirve para **correrle la fecha a una orden que ya existe**.
 *
 * ── LA MONTAN DOS PANTALLAS, Y POR ESO VIVE ACÁ ─────────────────────────────
 *
 * Programar el taller es decidir dos cosas a la vez —el trabajo y la gente— y
 * cada una tiene su pantalla:
 *
 * - **«Programación»**, que es `/mantenimiento/planificacion`: el plan del día.
 * - **«Asignación RR.HH»**, que es `/mantenimiento/programacion`: la semana de
 *   turnos del taller.
 *
 * (Los dos rótulos no coinciden con su ruta a propósito desde el 17/11/2026;
 * el porqué está en `lib/core/nav.ts`. Por eso este archivo no vive en ninguna
 * de las dos carpetas sino al lado del calendario, que es de lo que habla.)
 *
 * Ninguna de las dos sabía nada de las OT en el calendario, así que para ubicar
 * un trabajo había que tener las dos cosas en la cabeza. El calendario trae las
 * dos: cuántas órdenes tiene cada día y cuánta gente de cada oficio hay.
 *
 * ── LO QUE HAY QUE SABER ANTES DE TOCARLO ───────────────────────────────────
 *
 * - **Mover una OT no es un update: es `postergar`.** Escribe primero la
 *   planilla —que es donde manda la fecha— y recién después la base, pide
 *   justificación obligatoria y queda auditado con el par viejo/nuevo. Nada de
 *   eso está acá: está en `/api/mantenimiento/ordenes/[id]/postergar`, y ésta
 *   es la tercera punta que lo llama.
 * - **Sólo hacia adelante y hasta 90 días.** No es una decisión de esta
 *   pantalla: es lo único que esa ruta sabe hacer. Adelantar una orden no
 *   existe hoy en ninguna punta del sistema.
 * - **La mayoría de las órdenes no se puede mover desde acá, y es lo
 *   esperado.** Medido el 17/11/2026 contra producción: de las 55 órdenes
 *   abiertas, **17 son del sistema** (`app_created`) y las otras 38 entraron
 *   por el formulario, donde la fecha vive en la pestaña que maneja Google
 *   Forms. Por eso cada orden que no se puede mover **dice por qué** en vez de
 *   quedarse sin botón: con 38 de 55 mudas, la pantalla parecería rota.
 * - **Después de mover se vuelve a pedir el mes.** La grilla la dibuja el
 *   servidor, no el estado de acá; sin el `recarga` la orden seguiría pintada
 *   en el día viejo hasta que alguien cambiara de mes.
 */
/** Un número grande con su rótulo abajo. */
function Tarjeta({ valor, rotulo, alerta = false }: {
  valor: number | string;
  rotulo: string;
  /** Un número que vale la pena mirar: se pinta, pero **sólo si no es cero**. */
  alerta?: boolean;
}) {
  const pintar = alerta && valor !== 0;
  return (
    <div className={`rounded-lg border px-3 py-2 ${
      pintar ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"
    }`}>
      <div className={`text-xl font-semibold ${pintar ? "text-red-700" : "text-slate-800"}`}>
        {valor}
      </div>
      <div className="text-xs text-slate-500">{rotulo}</div>
    </div>
  );
}

/**
 * Los indicadores de arriba del mes.
 *
 * **Salen de lo que la grilla ya tiene y respetan el filtro puesto.** No es una
 * comodidad: el encabezado del calendario ya imprime «N órdenes en el mes»
 * calculado sobre lo filtrado, así que una barra que dijera otro número para el
 * mismo mes dejaría a la pantalla contradiciéndose sola a dos centímetros de
 * distancia.
 *
 * El desglose va con las mismas letras que la hoja impresa, a propósito: quien
 * las ve acá las reconoce en el papel sin tener que leer la leyenda.
 */
function BarraDeIndicadores({ delMes, deHoy, hayFiltro, onIrAHoy }: {
  delMes: IndicadoresDelMes;
  /** `null` cuando el mes que se está mirando no contiene hoy. */
  deHoy: IndicadoresDeHoy | null;
  hayFiltro: boolean;
  onIrAHoy?: () => void;
}) {
  return (
    <div className="space-y-2">
      {deHoy ? (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Hoy</div>
          {/* Dos columnas en el teléfono: 343 px de ancho útil partidos en tres
              dejan 114 px por tarjeta, que es lo que `revisar-responsive` marca
              como apretado. La tercera cae abajo y se ve bien. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tarjeta valor={deHoy.total} rotulo={deHoy.total === 1 ? "orden" : "órdenes"} />
            <Tarjeta valor={deHoy.atrasadas} rotulo="atrasadas" alerta />
            <Tarjeta valor={deHoy.sinOperario} rotulo="sin operario" />
          </div>
        </div>
      ) : (
        onIrAHoy && (
          <button type="button" onClick={onIrAHoy} className="btn-secondary text-sm">
            Ir a hoy
          </button>
        )
      )}

      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
          El mes que se está mirando{hayFiltro ? ", con el filtro puesto" : ""}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tarjeta valor={delMes.total} rotulo={delMes.total === 1 ? "orden" : "órdenes"} />
          <Tarjeta valor={delMes.atrasadas} rotulo="atrasadas" alerta />
          <Tarjeta
            valor={delMes.diaMasCargado ? `${delMes.diaMasCargado.cantidad}` : "—"}
            rotulo={
              delMes.diaMasCargado
                ? `el día más cargado (${comoSeLee(delMes.diaMasCargado.dia)})`
                : "el día más cargado"
            }
          />
        </div>
        {delMes.porLetra.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {delMes.porLetra.map(({ letra, cantidad }) => (
              <span key={letra} className="inline-flex items-center gap-1">
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded border border-slate-400 text-xs font-semibold text-slate-700"
                  title={LEYENDA_IMPRESA.find((e) => e.letra === letra)?.nombre ?? ""}
                >
                  {letra}
                </span>
                {cantidad}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MesDeOrdenes({ puedeMover, puedeAsignar }: {
  /**
   * Si quien mira tiene nivel de edición en Mantenimiento. Es obligatoria y no
   * tiene default a propósito: las dos pantallas que montan esto reparten
   * permisos distintos —`/programacion` es sólo de admin y `/planificacion` la
   * ve cualquiera con el módulo— y un default haría que la de todos heredara
   * el permiso de la otra sin que nada lo dijera.
   */
  puedeMover: boolean;
  /**
   * Si quien mira puede ver el taller con nombre y apellido, o sea si es admin
   * de Mantenimiento. Obligatoria y sin default por lo mismo que `puedeMover`,
   * y acá importa más: lo que depende de esto no es un botón sino **quiénes
   * son**. En `false` no se pide siquiera la ruta.
   */
  puedeAsignar: boolean;
}) {
  const [moviendo, setMoviendo] = useState<OrdenDelDia | null>(null);
  const [destino, setDestino] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [asignando, setAsignando] = useState<{ orden: OrdenDelDia; dia: string } | null>(null);
  const [estado, setEstado] = useState<EstadoDelCalendario | null>(null);
  const [taller, setTaller] = useState<TallerDelMes | null>(null);
  const [falloDelTaller, setFalloDelTaller] = useState<string | null>(null);
  const hoy = hoyEnArgentina();

  /*
   * Qué está mirando el calendario, que es el que tiene el mes y los filtros.
   *
   * La comparación campo por campo no es prolijidad: `onEstado` va en las
   * dependencias de un efecto del hijo, así que guardar un objeto nuevo cuando
   * nada cambió vuelve a renderizar al hijo, que vuelve a llamar, y así. Los
   * cinco campos se comparan por identidad porque los cinco la conservan del
   * otro lado (`dias` sale de un estado, `filtros` también).
   */
  const anotarElEstado = useCallback((e: EstadoDelCalendario) => {
    setEstado((v) =>
      v && v.mes === e.mes && v.desde === e.desde && v.hasta === e.hasta
        && v.filtros === e.filtros && v.dias === e.dias
        ? v
        : e
    );
  }, []);

  // El rango que mira la grilla, para pedir el taller de las mismas semanas.
  // Se saca aparte para que el pedido no se repita cada vez que alguien toca un
  // filtro: eso cambia el estado pero no las semanas.
  const desde = estado?.desde ?? null;
  const hasta = estado?.hasta ?? null;
  const rango = useMemo(
    () => (desde && hasta ? { desde, hasta } : null),
    [desde, hasta]
  );

  const delMes = useMemo(
    () => (estado ? indicadoresDelMes(estado.dias, estado.mes, estado.filtros) : null),
    [estado]
  );
  const deHoy = useMemo(
    () => (estado ? indicadoresDeHoy(estado.dias, hoy, estado.filtros) : null),
    [estado, hoy]
  );
  const hayFiltro = Boolean(
    estado && (estado.filtros.especialidad || estado.filtros.tipo || estado.filtros.quien)
  );

  /*
   * El taller del mes, para las mismas semanas que la grilla.
   *
   * Un fallo acá **no rompe el mes**: la grilla de OT es lo que esta pantalla
   * vino a mostrar y se sigue viendo entera; lo que falta es la franja, y eso
   * se dice arriba de cada semana con el error que contestó el servidor.
   */
  useEffect(() => {
    if (!puedeAsignar || !rango) return;
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/mantenimiento/taller-del-mes?desde=${rango.desde}&hasta=${rango.hasta}`
        );
        const cuerpo = await res.json().catch(() => ({}));
        if (cancelado) return;
        if (!res.ok || !Array.isArray(cuerpo.franjas)) {
          setFalloDelTaller(cuerpo.error ?? `El servidor contestó ${res.status}.`);
          setTaller(null);
          return;
        }
        setFalloDelTaller(null);
        setTaller(cuerpo as TallerDelMes);
      } catch (e) {
        if (!cancelado) {
          setFalloDelTaller(e instanceof Error ? e.message : String(e));
          setTaller(null);
        }
      }
    })();
    return () => { cancelado = true; };
  }, [puedeAsignar, rango, recarga]);

  // El aviso de éxito se va solo, como en la semana.
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 9000);
    return () => clearTimeout(t);
  }, [aviso]);

  function cancelar() {
    setMoviendo(null);
    setDestino(null);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Qué órdenes tiene cada día y cuánta gente del taller hay
        {puedeAsignar ? ", con la rotación de turnos arriba de cada semana" : ""}. Tocá un día
        para verlo
        {puedeMover && puedeAsignar
          ? ", y desde ahí podés correrle la fecha a una orden o ponerle operarios."
          : puedeMover
            ? ", y desde ahí podés correrle la fecha a una orden."
            : puedeAsignar
              ? ", y desde ahí podés ponerle operarios a una orden."
              : "."}
      </p>

      {aviso && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
          {aviso}
        </div>
      )}

      {delMes && (
        <BarraDeIndicadores
          delMes={delMes}
          deHoy={deHoy}
          hayFiltro={hayFiltro}
          onIrAHoy={estado?.irAlMesDeHoy}
        />
      )}

      <CalendarioDeOT
        recarga={recarga}
        onEstado={anotarElEstado}
        franjaDeLaSemana={
          puedeAsignar
            ? (lunes) => (
                <FranjaDelTaller
                  franja={taller?.franjas.find((f) => f.lunes === lunes) ?? null}
                  // El error va en la primera semana y no en las seis: es uno
                  // solo —la ruta trae el mes entero de una— y repetirlo seis
                  // veces convierte un aviso en un muro.
                  error={lunes === rango?.desde ? falloDelTaller : null}
                />
              )
            : undefined
        }
        modo={{
          tipo: "programar",
          puedeMover,
          moviendo,
          onEmpezarAMover: (o) => { setMoviendo(o); setDestino(null); },
          onCancelarElMovimiento: cancelar,
          onElegirElDestino: (dia) => setDestino(dia),
          onAsignar: puedeAsignar ? (orden, dia) => setAsignando({ orden, dia }) : null,
        }}
      />

      {asignando && (
        <AsignarOperariosModal
          orden={asignando.orden}
          dia={asignando.dia}
          catalogo={taller?.catalogo ?? []}
          noVienenEseDia={taller?.noVienen[asignando.dia] ?? []}
          turnos={taller?.turnos ?? {}}
          falloDelTaller={falloDelTaller}
          cargandoElTaller={!taller && !falloDelTaller}
          onCerrar={() => setAsignando(null)}
          onAsignada={() => {
            setAsignando(null);
            // La grilla la dibuja el servidor: sin esto la orden seguiría
            // mostrando los operarios de antes hasta que alguien cambie de mes.
            setRecarga((n) => n + 1);
          }}
        />
      )}

      {moviendo && destino && (
        <PostergarOTModal
          orden={moviendo}
          destino={destino}
          // Cancelar en el modal vuelve a elegir el día, no sale del movimiento:
          // el destino es lo que se acaba de tocar y es lo más probable que se
          // quiera corregir.
          onCerrar={() => setDestino(null)}
          onPostergada={() => {
            setAviso(`La OT ${moviendo.ot_number} quedó para el ${comoSeLee(destino)}.`);
            cancelar();
            setRecarga((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
