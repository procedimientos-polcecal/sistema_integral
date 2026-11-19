"use client";

import { useCallback, useEffect, useState } from "react";
import { comoSeLee } from "@/lib/core/fechas";
import CalendarioDeOT, { type OrdenDelDia } from "./CalendarioDeOT";
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
  const [rango, setRango] = useState<{ desde: string; hasta: string } | null>(null);
  const [taller, setTaller] = useState<TallerDelMes | null>(null);
  const [falloDelTaller, setFalloDelTaller] = useState<string | null>(null);

  // El rango lo decide el calendario, que es el que tiene el mes.
  const anotarElRango = useCallback((desde: string, hasta: string) => {
    setRango((r) => (r && r.desde === desde && r.hasta === hasta ? r : { desde, hasta }));
  }, []);

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
        para verlo{puedeMover ? ", y desde ahí podés correrle la fecha a una orden." : "."}
      </p>

      {aviso && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
          {aviso}
        </div>
      )}

      <CalendarioDeOT
        recarga={recarga}
        onRango={puedeAsignar ? anotarElRango : undefined}
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
