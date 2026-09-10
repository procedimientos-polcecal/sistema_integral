import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelProduccionDe } from "@/lib/produccion/auth";
import { parteAnterior, TURNOS } from "@/lib/produccion/turnos";
import { traerRenglonesDePapel, traerParte, traerDepositoDe } from "@/lib/produccion/consultas";
import { totalesDeDespacho, roturaTotal } from "@/lib/produccion/despachos";
import { produccionDelTurno, produccionDelDia, type ProduccionPorRenglon } from "@/lib/produccion/produccion";
import type { TotalesDeDespacho } from "@/lib/produccion/despachos";
import type { Despacho, Parte, Turno } from "@/lib/produccion/types";
import DiaClient from "./DiaClient";

export interface TurnoDelDia {
  turno: Turno;
  cargado: boolean;
  parte: Parte | null;
  despachos: Despacho[];
  totales: TotalesDeDespacho | null;
  faltaAnterior: boolean;
  /** `null` = el turno no está cargado. No es lo mismo que un turno sin renglonesDePapel. */
  produccion: ProduccionPorRenglon | null;
  /**
   * El depósito de este turno y el del turno anterior, tal como se contaron.
   * `null` = el turno no está cargado (`deposito`) o no existe el parte
   * anterior (`depositoAnterior`, mismo dato que `faltaAnterior`).
   *
   * Se llevan hasta el cliente para que el desglose de una producción
   * negativa muestre los números reales del papel, en vez de despejar la
   * fórmula al revés a partir de `produccion` — eso es lo que hacía
   * `DiaClient` y lo que un día terminó mostrando un "depósito" que no salía
   * de ningún renglón, porque en realidad era la variación del depósito.
   */
  deposito: Record<string, number> | null;
  depositoAnterior: Record<string, number> | null;
}

export default async function ProduccionPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { fecha: pedida } = await searchParams;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(pedida ?? "") ? pedida! : hoyEnArgentina();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelProduccionDe(supabase, user.id);
  if (!nivel) redirect("/");

  const renglonesDePapel = await traerRenglonesDePapel(supabase);

  // Las dos ramas empujan la **misma forma**: un turno sin cargar no es un
  // objeto distinto, es el mismo con todo en vacío. Si las formas difieren, el
  // tipo que infiere TS es una unión y el cliente termina lleno de `in`.
  const turnos: TurnoDelDia[] = [];
  for (const turno of TURNOS) {
    const completo = await traerParte(supabase, { fecha, turno });

    if (!completo) {
      turnos.push({
        turno, cargado: false, parte: null, despachos: [],
        totales: null, faltaAnterior: false, produccion: null,
        deposito: null, depositoAnterior: null,
      });
      continue;
    }

    const totales = totalesDeDespacho(completo.despachos);
    const anterior = await traerDepositoDe(supabase, parteAnterior({ fecha, turno }));

    turnos.push({
      turno,
      cargado: true,
      parte: completo.parte,
      despachos: completo.despachos,
      totales,
      // `null` es el dato: sin el parte anterior no hay resta posible.
      faltaAnterior: anterior === null,
      produccion: produccionDelTurno({
        deposito: completo.deposito,
        depositoAnterior: anterior,
        despachado: totales.despachado,
        rotura: roturaTotal(totales),
      }),
      deposito: completo.deposito,
      depositoAnterior: anterior,
    });
  }

  return (
    <DiaClient
      fecha={fecha}
      renglonesDePapel={renglonesDePapel}
      turnos={turnos}
      delDia={produccionDelDia(turnos.map((t) => t.produccion))}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
