import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseDeMentira, type Fila } from "@/lib/core/supabaseDeMentira";

/**
 * La ruta con la que Compras contesta, con un Supabase de mentira.
 *
 * **Es el segundo test de una ruta del repo, y sigue sin ser una plantilla.** La
 * regla de la casa no cambió: la lógica que decide se saca a `lib/` y se prueba ahí,
 * y acá no se repite nada de `consultas.test.ts` —quién puede contestar, a quién se
 * le avisa, cómo se arma la bandeja, qué dice el push—. Lo que se prueba acá es lo
 * que pasa *entre* la ruta y la base, que `lib/` no puede ver: qué lee, qué inserta,
 * qué escribe en la planilla y a quién avisa; y que lo que rechaza no hace nada de
 * eso.
 *
 * **Las columnas de los `select` ya no se afirman acá.** Hasta el 31/10/2026 este
 * archivo tenía una lista escrita a mano de las columnas sin las que la bandeja sale
 * vacía, y le faltaba `creado_en`: sacarla del `select` pasaba los 164 tests y mataba
 * en silencio «la más vieja arriba». Esa guarda se mudó a
 * `lib/mantenimiento/selectsDeLasNotas.test.ts`, que lee el **texto** de todas las
 * rutas y cubre también la que nadie escribió todavía. Acá quedó lo que el texto no
 * puede ver.
 *
 * Lo que este test NO prueba, y conviene no creerle: que las tablas y columnas
 * existan con esos nombres, ni las claves foráneas, ni que el embed
 * `usuarios(nombre)` resuelva. Para eso hace falta la base, y la migración
 * 20261029082249 todavía no estaba aplicada cuando se escribió.
 */

const base = supabaseDeMentira({ nombres: { ana: "Ana", facundo: "Facundo" } });

/** Quién mira y qué puede. Lo leen los mocks, así que cada test lo puede cambiar. */
const sesion = { usuario: { id: "facundo" } as { id: string } | null, accesoCompras: true };

const avisar = vi
  .fn<(admin: unknown, opciones: { usuarioId: string; aviso: Record<string, string> }) => Promise<{ enviadas: number; personas: number; motivo?: string }>>()
  .mockResolvedValue({ enviadas: 1, personas: 1 });

/** Lo que se mandó a la columna X de la planilla. */
const planilla: unknown[] = [];
const escribirPlanilla = vi.fn(async (_orden: unknown, celdas: unknown): Promise<string | null> => {
  planilla.push(celdas);
  return null;
});

/*
 * Los factories se evalúan al importar la ruta, que es antes que las constantes de
 * arriba; por eso cada uno lee lo suyo **adentro de una función** y nunca en el
 * cuerpo del factory. Es lo que permite no usar `vi.hoisted` y poder compartir el
 * fake con el otro test de ruta.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sesion.usuario } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => base.admin }));
vi.mock("@/lib/compras/auth", () => ({ tieneAccesoCompras: async () => sesion.accesoCompras }));
vi.mock("@/lib/mantenimiento/planillaDeOT", () => ({
  escribirEnLaFilaDeLaOT: (orden: unknown, celdas: unknown) => escribirPlanilla(orden, celdas),
}));
// Lo único que se cambia es quién manda el push: a quién, cuándo y con qué texto ya
// tienen sus tests. Acá interesa a quién se le pide y si se pide.
vi.mock("@/lib/core/avisoAUnaPersona", () => ({
  avisarAUnaPersona: (admin: unknown, opciones: never) => avisar(admin, opciones),
}));

import { GET, POST } from "@/app/api/compras/consultas/route";

// Sin `Request`: el GET no lee nada de la URL —la bandeja no tiene filtros—, así que
// la ruta no lo recibe.
const get = () => GET();
const post = (cuerpo: unknown) =>
  POST(new Request("http://prueba/api", { method: "POST", body: JSON.stringify(cuerpo) }));

/** Una PREGUNTA de Ana sobre el rodamiento de la OT 2885. */
const pregunta = (p: Fila = {}): Fila => ({
  id: "n1", orden_id: "ot1", tipo: "PREGUNTA", texto: "¿Llega antes del jueves?",
  creado_en: "2026-10-29T10:00:00Z", creado_por: "ana",
  repuesto_id: "r1", responde_a: null, ...p,
});

beforeEach(() => {
  sesion.usuario = { id: "facundo" };
  sesion.accesoCompras = true;
  planilla.length = 0;
  base.reiniciar({
    ordenes_trabajo: [
      { id: "ot1", ot_number: 2885, descripcion: "Pérdida en el filler", estado: "POR_HACER" },
      { id: "ot2", ot_number: 2886, descripcion: "Cambio de correa", estado: "REALIZADO" },
    ],
    ordenes_trabajo_repuestos: [
      { id: "r1", work_order_id: "ot1", nombre: "Rodamiento 6206", codigo: "00473" },
      { id: "r2", work_order_id: "ot2", nombre: "Correa B-75", codigo: null },
    ],
    ordenes_trabajo_notas: [pregunta()],
  });
  avisar.mockClear();
  escribirPlanilla.mockClear();
});

describe("la bandeja", () => {
  it("trae la consulta abierta con su orden, su repuesto y quién preguntó", async () => {
    const res = await get();
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: "n1",
      texto: "¿Llega antes del jueves?",
      creado_en: "2026-10-29T10:00:00Z",
      autor: "Ana",
      orden: { ot_number: 2885, descripcion: "Pérdida en el filler" },
      repuesto: { nombre: "Rodamiento 6206", codigo: "00473" },
    });
  });

  // Cada orden con su propio estado: la de la OT realizada no tiene que aparecer
  // aunque la otra siga por hacer.
  it("no muestra la pregunta de una orden que ya no espera nada", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [
      pregunta(),
      pregunta({ id: "n2", orden_id: "ot2", repuesto_id: "r2" }),
    ];

    const { data } = await (await get()).json();
    expect(data.map((c: { id: string }) => c.id)).toEqual(["n1"]);
  });

  it("una pregunta ya contestada no sigue en la bandeja", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [
      pregunta(),
      pregunta({ id: "n2", tipo: "RESPUESTA", repuesto_id: null, responde_a: "n1", creado_por: "facundo" }),
    ];

    expect((await (await get()).json()).data).toEqual([]);
  });

  /*
   * PostgREST corta en 1.000 filas y no avisa, y el fake hace lo mismo. Sin
   * `traerTodo` la bandeja miente hacia abajo: esconde justamente las que quedaron
   * afuera del tope, que con el orden de la pantalla son las más viejas.
   *
   * Las mil y una preguntas van en mil y una órdenes distintas, así que de paso
   * pasan por los lotes de 200 del `.in("id", …)`: pedir las 1.001 de una vez
   * también vuelve con 1.000 y una consulta se quedaría sin orden. En la base de
   * verdad eso no sería un tope sino un 400 por el largo de la URL, pero el límite
   * que se quiere fijar —no pedir todo junto— es el mismo.
   */
  it("con más de 1.000 preguntas no se pierde ninguna", async () => {
    const CUANTAS = 1001;
    base.estado.tablas.ordenes_trabajo = [];
    base.estado.tablas.ordenes_trabajo_notas = [];

    for (let i = 0; i < CUANTAS; i++) {
      base.estado.tablas.ordenes_trabajo.push({
        id: `ot-${i}`, ot_number: 1000 + i, descripcion: "x", estado: "POR_HACER",
      });
      base.estado.tablas.ordenes_trabajo_notas.push(
        pregunta({ id: `n-${i}`, orden_id: `ot-${i}` })
      );
    }

    const { data } = await (await get()).json();
    expect(data).toHaveLength(CUANTAS);
  });

  it("sin acceso a Compras no se ve: 403", async () => {
    sesion.accesoCompras = false;
    expect((await get()).status).toBe(403);
  });

  it("sin sesión: 401", async () => {
    sesion.usuario = null;
    expect((await get()).status).toBe(401);
  });
});

describe("contestar", () => {
  it("guarda la respuesta apuntando a la pregunta, escribe la celda X y avisa a quien preguntó", async () => {
    const res = await post({ pregunta_id: "n1", texto: "Lo entrega el jueves" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(base.estado.inserts[0]).toMatchObject({
      orden_id: "ot1",
      tipo: "RESPUESTA",
      responde_a: "n1",
      // El repuesto es el de la pregunta: repetirlo sería un segundo dato.
      repuesto_id: null,
      creado_por: "facundo",
      texto: "Lo entrega el jueves",
    });

    // La respuesta de Compras pasa a ser la justificación vigente de la OT.
    expect(planilla).toEqual([[{ columna: 23, valor: "Lo entrega el jueves" }]]);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0][1]).toMatchObject({ usuarioId: "ana" });
    expect(cuerpo.aviso).toEqual({ enviadas: 1, personas: 1 });
    expect(cuerpo.planilla_error).toBeNull();
  });

  // El push es a UNA persona nombrada: la que preguntó, no la lista de consultados.
  it("el aviso lleva la OT, el repuesto y lo que se contestó", async () => {
    await post({ pregunta_id: "n1", texto: "Lo entrega el jueves" });
    const { aviso } = avisar.mock.calls[0][1];

    expect(Object.keys(aviso).sort()).toEqual(["body", "title", "url"]);
    expect(aviso.body).toContain("OT 2885");
    expect(aviso.body).toContain("Rodamiento 6206");
    expect(aviso.url).toBe("/mantenimiento/ordenes?q=2885");
  });

  // La ruta no repite las dos condiciones del aviso: pide el destinatario, y si viene
  // `null` no avisa. Quien contesta su propia pregunta no se interrumpe a sí mismo.
  it("quien contesta su propia pregunta no recibe un push de lo que acaba de escribir", async () => {
    sesion.usuario = { id: "ana" };
    const res = await post({ pregunta_id: "n1", texto: "Ya lo gestioné yo" });

    expect(res.status).toBe(200);
    expect(base.estado.inserts).toHaveLength(1);
    expect(avisar).not.toHaveBeenCalled();
    expect((await res.json()).aviso).toBeNull();
  });

  // Review Focus 5: la respuesta ya está guardada, así que un push que falla no la
  // puede voltear. Lo único que queda es el motivo en la respuesta de la ruta.
  it("si el push falla, la respuesta queda igual y vuelve el motivo", async () => {
    avisar.mockRejectedValueOnce(new Error("push service caído"));
    const res = await post({ pregunta_id: "n1", texto: "Lo entrega el jueves" });
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(base.estado.inserts).toHaveLength(1);
    expect(cuerpo.aviso.motivo).toContain("push service caído");
  });

  // La planilla escribe con USER_ENTERED: una respuesta que arranca con `=` entraría
  // como fórmula.
  it("una respuesta que arranca con = va a la planilla como texto", async () => {
    await post({ pregunta_id: "n1", texto: "=IMPORTRANGE(\"x\";\"A1\")" });
    expect(planilla).toEqual([[{ columna: 23, valor: "'=IMPORTRANGE(\"x\";\"A1\")" }]]);
  });

  // Un fallo de escritura nunca es un `console.warn`: se le dice a quien lo hizo.
  it("si la planilla falla, lo dice y la respuesta queda guardada igual", async () => {
    escribirPlanilla.mockResolvedValueOnce("Google dijo que no");
    const cuerpo = await (await post({ pregunta_id: "n1", texto: "Llega el lunes" })).json();

    expect(base.estado.inserts).toHaveLength(1);
    expect(cuerpo.planilla_error).toBe("Google dijo que no");
  });
});

/*
 * Lo que la ruta rechaza no se guarda, no escribe la planilla y no avisa. Qué se
 * rechaza y por qué lo deciden `puedeResponderConsulta` y `preguntasAbiertas`, con sus
 * tests en `lib/`; acá se prueba sólo que la ruta les hace caso y que no toca nada
 * cuando dicen que no. Cada caso existe porque mata una rotura que sólo se ve acá:
 *
 *  - la pregunta ya contestada y la superada: la ruta tiene que LEER las demás notas
 *    de esa orden, y no sólo la que le nombraron;
 *  - la orden realizada: la ruta tiene que pasarle a la regla el estado de la orden;
 *  - la nota que no es una pregunta: no se le puede «responder» a una justificación,
 *    y sin esto quedaría un hilo que `preguntasAbiertas` no sabe leer;
 *  - el 403: el permiso se comprueba en la ruta, y sin nivel de Mantenimiento.
 */
describe("lo que la ruta rechaza no se guarda, ni escribe la planilla, ni avisa", () => {
  const casos: { nombre: string; status: number; preparar?: () => void; cuerpo: unknown }[] = [
    {
      nombre: "una pregunta que ya tiene respuesta",
      status: 409,
      preparar: () => {
        base.estado.tablas.ordenes_trabajo_notas = [
          pregunta(),
          pregunta({ id: "n2", tipo: "RESPUESTA", repuesto_id: null, responde_a: "n1", creado_por: "facundo" }),
        ];
      },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "una pregunta superada por un seguimiento",
      status: 409,
      preparar: () => {
        base.estado.tablas.ordenes_trabajo_notas = [
          pregunta(),
          pregunta({ id: "n3", responde_a: "n1", texto: "Sigue sin llegar." }),
        ];
      },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "una pregunta de una orden ya realizada",
      status: 409,
      preparar: () => {
        base.estado.tablas.ordenes_trabajo_notas = [pregunta({ orden_id: "ot2", repuesto_id: "r2" })];
      },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "una nota que no es una pregunta",
      status: 409,
      preparar: () => {
        base.estado.tablas.ordenes_trabajo_notas = [
          pregunta({ tipo: "JUSTIFICACION", repuesto_id: null, texto: "Esperamos la parada" }),
        ];
      },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "una consulta que no existe",
      status: 404,
      cuerpo: { pregunta_id: "no-existe", texto: "Lo entrega el jueves" },
    },
    {
      nombre: "sin decir qué consulta se contesta",
      status: 400,
      cuerpo: { texto: "Lo entrega el jueves" },
    },
    {
      nombre: "sin escribir nada",
      status: 400,
      cuerpo: { pregunta_id: "n1", texto: "   " },
    },
    {
      nombre: "una respuesta más larga que la celda",
      status: 400,
      cuerpo: { pregunta_id: "n1", texto: "x".repeat(1001) },
    },
    {
      nombre: "quien no tiene Compras",
      status: 403,
      preparar: () => { sesion.accesoCompras = false; },
      cuerpo: { pregunta_id: "n1", texto: "Lo entrega el jueves" },
    },
  ];

  for (const caso of casos) {
    it(`${caso.nombre}: ${caso.status}`, async () => {
      caso.preparar?.();
      const res = await post(caso.cuerpo);

      expect(res.status).toBe(caso.status);
      expect(base.estado.inserts).toHaveLength(0);
      expect(escribirPlanilla).not.toHaveBeenCalled();
      expect(avisar).not.toHaveBeenCalled();
    });
  }

  it("sin sesión: 401", async () => {
    sesion.usuario = null;
    expect((await post({ pregunta_id: "n1", texto: "hola" })).status).toBe(401);
    expect(base.estado.inserts).toHaveLength(0);
  });

  /*
   * El texto se valida con `validarNota`, que es la regla de la casa para lo que
   * termina en la celda X. Lo único propio de esta ruta es el mensaje del caso vacío:
   * el de `validarNota` dice «Falta decir por qué no se hizo», que es correcto del
   * lado de Mantenimiento y absurdo en la bandeja de Compras. Sin fijarlo, sacar esas
   * tres líneas dejaba el 400 igual y nadie se enteraba del mensaje equivocado.
   */
  it("al que no escribió nada le dice que falta la respuesta, y no «por qué no se hizo»", async () => {
    const res = await post({ pregunta_id: "n1", texto: "   " });
    const { error } = await res.json();

    expect(res.status).toBe(400);
    expect(error).toBe("Falta escribir la respuesta.");
  });
});
