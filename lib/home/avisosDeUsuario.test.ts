import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseDeMentira } from "@/lib/core/supabaseDeMentira";
import { avisosDeConteos, avisosDeSalud, type ConteosParaAvisos } from "./avisos";
import type { Notificacion } from "./notificaciones";
import type { UsuarioModulo } from "@/lib/core/types";

const base = supabaseDeMentira();

// La misma base de los dos lados: el cliente de sesión que recibe `avisosDeUsuario`
// y el admin con el que se cuentan las consultas. Es lo más parecido a la verdad que
// se puede sin RLS — y que el admin haga falta **es** una diferencia de RLS, así que
// eso no se prueba acá: está medido contra producción y escrito en `consultas.ts`.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => base.admin }));

import { sinLoQueNoPuedeAtender, avisosDeUsuario } from "./avisosDeUsuario";

/**
 * Los avisos salen de `avisosDeConteos` y **no de una lista de ids escrita
 * acá**, y ése es el punto de este archivo.
 *
 * Con los ids literales, alguien podía renombrar un id en `avisos.ts` y
 * olvidarse de `DE_UNA_LISTA`: el filtro dejaba de reconocerlo, el aviso
 * empezaba a llegarle a todos los que ven el módulo —y por push— y estos
 * tests seguían verdes, porque probaban el id viejo contra el mapa viejo.
 * Pidiéndoselos a la función que los arma, las dos puntas quedan atadas: un id
 * renombrado sólo de un lado pone esto en rojo.
 */
function avisoDe(clave: keyof ConteosParaAvisos): Notificacion {
  const [aviso] = avisosDeConteos({ [clave]: 1 });
  if (!aviso) throw new Error(`\`${clave}\` no genera ningún aviso en avisos.ts`);
  return aviso;
}

/** Nadie puede nada: el corte más duro. */
const NADA = {
  apruebaCompras: false, contestaConsultas: false, evaluaSyh: false, administraElSistema: false,
};

const COMPRAS = avisoDe("comprasEsperandoAprobacion");
const ATRASADAS = avisoDe("mantenimientoAtrasadas");
const avisos: Notificacion[] = [COMPRAS, ATRASADAS];

/** Quien no está en ninguna de las dos listas. */

describe("sinLoQueNoPuedeAtender", () => {
  /*
   * Medido el 18/10/2026: "Requerimientos esperando aprobacion" le llegaba a 6
   * personas y 3 no estaban en `compras_aprobadores`. Pedirle a alguien algo
   * que no puede hacer enseña que un aviso tuyo puede no ser tuyo.
   */
  it("quien no aprueba no recibe el aviso de aprobacion", () => {
    expect(sinLoQueNoPuedeAtender(avisos, NADA).map((a) => a.id)).toEqual([ATRASADAS.id]);
  });

  it("quien aprueba lo recibe", () => {
    expect(
      sinLoQueNoPuedeAtender(avisos, { ...NADA, apruebaCompras: true }).map((a) => a.id)
    ).toEqual([COMPRAS.id, ATRASADAS.id]);
  });

  /*
   * Las consultas de repuestos van a `compras_consultados` y no a todo el que
   * vea Compras, por lo mismo que la aprobacion va a los aprobadores: el aviso
   * sale por los dos lados —campana y push—, asi que pedirle a seis personas
   * algo que contesta una es una notificacion en el telefono de cinco que no
   * pueden hacer nada. Medido el 26/10/2026, `compras_aprobadores` tiene cuatro
   * y solo una es quien contesta.
   *
   * Y son listas **distintas**: estar en una no pone en la otra.
   */
  const consultas: Notificacion[] = [
    { id: "compras-consultas-repuestos", titulo: "Consultas de repuestos sin responder", cantidad: 3, href: "/c" },
    { id: "mant-atrasadas", titulo: "Órdenes de trabajo atrasadas", cantidad: 23, href: "/b" },
  ];

  it("a quien no contesta consultas no le llega la de los repuestos", () => {
    expect(
      sinLoQueNoPuedeAtender(consultas, NADA).map((a) => a.id)
    ).toEqual(["mant-atrasadas"]);
  });

  it("a quien contesta consultas si", () => {
    expect(
      sinLoQueNoPuedeAtender(consultas, { ...NADA, contestaConsultas: true }).map((a) => a.id)
    ).toEqual(["compras-consultas-repuestos", "mant-atrasadas"]);
  });

  it("aprobar no es contestar: cada lista reparte lo suyo", () => {
    const todo = [...avisos, ...consultas.slice(0, 1)];

    expect(
      sinLoQueNoPuedeAtender(todo, { ...NADA, apruebaCompras: true }).map((a) => a.id)
    ).toEqual(["compras-por-aprobar", "mant-atrasadas"]);
    expect(
      sinLoQueNoPuedeAtender(todo, { ...NADA, contestaConsultas: true }).map((a) => a.id)
    ).toEqual(["mant-atrasadas", "compras-consultas-repuestos"]);
  });

  /*
   * El filtro mira la LISTA, no el rol ni el nivel. Los administradores siguen
   * recibiendo todo lo demas, decidido a pedido el 18/10/2026: esto no es
   * repartir por permiso, es respetar una lista de responsables que ya existe.
   */
  it("no toca ningun otro aviso", () => {
    const otros: Notificacion[] = [
      { id: "ritmo-remises", titulo: "Remises: hace 82 días que no se carga", cantidad: 1, href: "/c" },
      avisoDe("tallerVialSinService"),
    ];
    expect(sinLoQueNoPuedeAtender(otros, NADA)).toEqual(otros);
  });

  it("sin avisos no devuelve nada y no rompe", () => {
    expect(sinLoQueNoPuedeAtender([], { ...NADA, apruebaCompras: true })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * De punta a punta: de las filas de la base al aviso que recibe una persona.
 *
 * ── POR QUÉ HACE FALTA, SI LAS TRES PIEZAS YA ESTÁN PROBADAS ─────────────────
 *
 * Porque lo que se rompe es **el empalme**. `esConsultadoDeCompras` lee la lista
 * bien, `DE_UNA_LISTA` nombra la suya y `sinLoQueNoPuedeAtender` filtra bien, y aun
 * así, cambiar acá `{ apruebaCompras, contestaConsultas }` por
 * `contestaConsultas: apruebaCompras` dejaba los 4.576 tests en verde y mandaba el
 * push de las consultas a los cuatro aprobadores: exactamente el error que el diseño
 * del 26/10/2026 existe para no cometer, y el único que esta tarea vino a evitar.
 *
 * Es la lección que el repo ya tiene escrita con el service worker: los dos handlers
 * por separado estaban bien, lo roto era el empalme, y eso no lo prueba ningún test
 * de a uno.
 *
 * El otro empalme que sólo se ve desde acá es el `tiene("compras")` que gatea el
 * conteo: sin él, a quien está en la lista pero no tiene el módulo le llegaría un
 * aviso a una pantalla a la que su layout no lo deja entrar.
 *
 * Con el Supabase de mentira y sin tocarlo: `contarSiTiene` devuelve 0 **antes** de
 * armar la consulta de un módulo que la persona no tiene, así que con un solo grant
 * lo único que se arma es lo que el fake ya sabe hacer.
 */
describe("los avisos que termina recibiendo una persona", () => {
  const grant = (modulo: string): UsuarioModulo =>
    ({ id: `g-${modulo}`, usuario_id: "x", modulo, nivel: "edicion" }) as UsuarioModulo;

  const quien = (id: string, modulos: string[]) => ({
    id,
    rol: "encargado" as const,
    grants: modulos.map(grant),
  });

  const avisosDe = (id: string, modulos: string[]) =>
    avisosDeUsuario(base.admin as unknown as SupabaseClient, quien(id, modulos));

  beforeEach(() => {
    base.reiniciar({
      // Una OT por hacer con una pregunta que nadie contestó.
      ordenes_trabajo: [{ id: "ot1", ot_number: 2885, estado: "POR_HACER" }],
      ordenes_trabajo_notas: [{
        id: "n1", orden_id: "ot1", tipo: "PREGUNTA", texto: "¿Llega el jueves?",
        creado_en: "2026-10-29T10:00:00Z", creado_por: "ana",
        repuesto_id: "r1", responde_a: null,
      }],
      // El reparto real: Facundo contesta, Bernardo aprueba. No son la misma persona.
      compras_consultados: [{ usuario_id: "facundo" }],
      compras_aprobadores: [{ usuario_id: "bernardo", alias_planilla: "BS" }],
      notificaciones_descartes: [],
      inicio_ritmo_modulos: [],
    });
  });

  it("a quien contesta le llega la consulta sin responder", async () => {
    const avisos = await avisosDe("facundo", ["compras"]);

    expect(avisos.map((a) => a.id)).toContain("compras-consultas-repuestos");
    expect(avisos.find((a) => a.id === "compras-consultas-repuestos")?.cantidad).toBe(1);
  });

  /*
   * La que mata el empalme por el otro lado: estar en la lista de aprobadores no
   * pone en la de consultados. Mandarle esto a los cuatro aprobadores no rompe
   * nada y no se ve: sólo le suena el teléfono a tres que no contestan nada.
   */
  it("a quien sólo aprueba el gasto, no", async () => {
    const avisos = await avisosDe("bernardo", ["compras"]);
    expect(avisos.map((a) => a.id)).not.toContain("compras-consultas-repuestos");
  });

  it("a quien no está en ninguna lista tampoco", async () => {
    const avisos = await avisosDe("ana", ["compras"]);
    expect(avisos.map((a) => a.id)).not.toContain("compras-consultas-repuestos");
  });

  /*
   * Estar en la lista no abre el módulo —lo dice la migración 20261029082249—, así
   * que a quien no tiene Compras no se le cuenta ni se le avisa: el aviso llevaría a
   * `/compras/consultas`, y ese layout lo manda a `/mis-pedidos`. Y no es sólo que
   * no aparezca: la lectura no se hace, que es lo que hace barato el barrido del
   * cron persona por persona.
   */
  it("a quien está en la lista pero no tiene Compras, no se le cuenta ni se le avisa", async () => {
    const avisos = await avisosDe("facundo", ["mantenimiento"]);

    expect(avisos.map((a) => a.id)).not.toContain("compras-consultas-repuestos");
    expect(base.estado.lecturas).not.toContain("ordenes_trabajo_notas");
  });

  it("lo que descartó no vuelve", async () => {
    base.estado.tablas.notificaciones_descartes = [
      { usuario_id: "facundo", notificacion_id: "compras-consultas-repuestos", cantidad_vista: 1 },
    ];
    const avisos = await avisosDe("facundo", ["compras"]);

    expect(avisos.map((a) => a.id)).not.toContain("compras-consultas-repuestos");
  });
});

describe("sinLoQueNoPuedeAtender — Seguridad e Higiene", () => {
  const VENCIDAS = avisoDe("syhVencidas");
  const SIN_COMPLETAR = avisoDe("syhSinCompletar");
  const deLosQueEvalua = [VENCIDAS, SIN_COMPLETAR];

  it("los dos de gestión van sólo a quien puede evaluar y cerrar", () => {
    expect(sinLoQueNoPuedeAtender(deLosQueEvalua, { ...NADA, apruebaCompras: true })).toEqual([]);
    expect(sinLoQueNoPuedeAtender(deLosQueEvalua, { ...NADA, evaluaSyh: true })).toHaveLength(2);
  });

  it("evaluar condiciones no habilita los avisos de aprobación, ni al revés", () => {
    const todos = [...avisos, ...deLosQueEvalua];
    expect(
      sinLoQueNoPuedeAtender(todos, { ...NADA, evaluaSyh: true }).map((a) => a.id)
    ).toEqual([ATRASADAS.id, VENCIDAS.id, SIN_COMPLETAR.id]);
    expect(
      sinLoQueNoPuedeAtender(todos, { ...NADA, apruebaCompras: true }).map((a) => a.id)
    ).toEqual([COMPRAS.id, ATRASADAS.id]);
  });

  /*
   * EL DEL RESPALDO NO ES DEL ADMIN DEL MÓDULO, Y ÉSA ES LA DIFERENCIA.
   *
   * Lo que ese aviso pide —crear la carpeta en una unidad compartida de Drive
   * y poner `GOOGLE_DRIVE_SYH_FOTOS_FOLDER_ID`— no lo puede hacer nadie desde
   * el SdG: es `admin_sistema`. Mandado al admin del módulo repetía el patrón
   * de `compras-por-aprobar` que este repo ya midió, y peor: si la carpeta no
   * existe al estrenar el módulo, suena todas las mañanas desde el cuarto día.
   */
  it("el del respaldo va a admin_sistema y no a quien evalúa condiciones", () => {
    const respaldo = [avisoDe("syhFotosSinRespaldar")];
    expect(sinLoQueNoPuedeAtender(respaldo, { ...NADA, evaluaSyh: true })).toEqual([]);
    expect(sinLoQueNoPuedeAtender(respaldo, { ...NADA, administraElSistema: true })).toEqual(
      respaldo
    );
  });
});

describe("los avisos de la Agenda", () => {
  // El de divergencias es de cada uno y lo decide su propio conteo: filtrarlo
  // por rol le sacaría el aviso al dueño de un evento que sólo usa la Agenda.
  it("el de divergencias le llega a cualquiera que tenga alguna", () => {
    const propias = [avisoDe("agendaDivergencias")];
    expect(sinLoQueNoPuedeAtender(propias, NADA)).toEqual(propias);
  });
});

/*
 * Acá estaban los dos de la Agenda —`agenda-pasos-caidos` y
 * `agenda-salud-sin-comprobar`—, que se retiraron el 05/11/2026. Lo que los
 * reemplaza se filtra igual y por lo mismo, pero **por prefijo**: sus ids
 * llevan el recurso adentro y no se pueden teclear en un mapa.
 *
 * Los avisos se le piden a `avisosDeSalud` por la misma razón que los otros se
 * le piden a `avisosDeConteos`: con un id literal escrito acá, cambiar el
 * prefijo en `avisos.ts` dejaría estos tests en verde mientras el aviso empieza
 * a llegarle por push a los catorce.
 */
describe("sinLoQueNoPuedeAtender — la salud de las sincronizaciones", () => {
  const deSalud = avisosDeSalud({
    caidas: [{ clave: "agenda/canales", titulo: "Canales de Google de la Agenda", estado: "fallo", cuantoLlevaMal: 1, detalle: "403" }],
    sinDeclarar: ["nuevo/cosa"],
    sinComprobar: true,
    corridas: [],
  });

  it("los tres van sólo a admin_sistema: nadie más toca Vercel ni las credenciales", () => {
    expect(deSalud).toHaveLength(3);
    expect(sinLoQueNoPuedeAtender(deSalud, { ...NADA, evaluaSyh: true, apruebaCompras: true })).toEqual([]);
    expect(sinLoQueNoPuedeAtender(deSalud, { ...NADA, administraElSistema: true })).toEqual(deSalud);
  });

  it("el filtro por prefijo no se come ningún otro aviso", () => {
    expect(sinLoQueNoPuedeAtender([ATRASADAS, ...deSalud], NADA)).toEqual([ATRASADAS]);
  });
});
