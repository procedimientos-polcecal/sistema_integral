import { describe, expect, it } from "vitest";
import { avisosDeConteos, avisosDeRitmo, avisosDeSalud, CRECE_CON_EL_DIA } from "./avisos";
import { filtrarDescartadas } from "./notificaciones";
import type { EntradaCaida } from "@/lib/core/saludDeLasSincronizaciones";

const caida = (clave: string): EntradaCaida =>
  ({ clave, titulo: `Caído: ${clave}`, estado: "fallo", cuantoLlevaMal: 1, detalle: "x" });

describe("avisosDeConteos", () => {
  it("los dos avisos de Seguridad e Higiene salen con sus títulos y links", () => {
    const avisos = avisosDeConteos({ syhVencidas: 3, syhSinCompletar: 12 });
    expect(avisos).toEqual([
      { id: "syh-vencidas", titulo: "Condiciones inseguras vencidas", cantidad: 3, href: "/seguridad-higiene/condiciones?estado=Vencida" },
      { id: "syh-sin-completar", titulo: "Condiciones inseguras sin completar", cantidad: 12, href: "/seguridad-higiene/condiciones?estado=abierta&falta=alguna" },
    ]);
  });

  it("los de Seguridad e Higiene salen al final, después de todo lo demás", () => {
    const avisos = avisosDeConteos({ syhSinCompletar: 1, trituracionSinPlanilla: 1, rrhhSinClasificar: 1 });
    expect(avisos.map((a) => a.id)).toEqual(["rrhh-sin-clasificar", "trituracion-sin-planilla", "syh-sin-completar"]);
  });

  it("las fotos sin respaldar salen como su propio aviso, con id estable, y al final de todo", () => {
    const avisos = avisosDeConteos({ syhFotosSinRespaldar: 2, syhSinCompletar: 1, rrhhSinClasificar: 1 });
    expect(avisos.map((a) => a.id)).toEqual(["rrhh-sin-clasificar", "syh-sin-completar", "syh-fotos-sin-respaldar"]);
    expect(avisos[2]).toEqual({
      id: "syh-fotos-sin-respaldar",
      titulo: "Fotos de condiciones inseguras sin copia de respaldo en Drive",
      cantidad: 2,
      href: "/seguridad-higiene",
    });
  });

  it("con cero fotos atascadas no avisa", () => {
    expect(avisosDeConteos({ syhFotosSinRespaldar: 0 })).toEqual([]);
  });

  it("no genera avisos cuando está todo en cero", () => {
    expect(avisosDeConteos({ mantenimientoAtrasadas: 0, comprasEsperandoAprobacion: 0 })).toEqual([]);
  });

  it("ignora los conteos que no le pasaron", () => {
    expect(avisosDeConteos({})).toEqual([]);
  });

  it("genera un aviso por cada conteo mayor que cero", () => {
    const avisos = avisosDeConteos({ mantenimientoAtrasadas: 20, facturacionSinVincular: 1 });
    expect(avisos.map((a) => a.id)).toEqual(["mant-atrasadas", "facturacion-sin-vincular"]);
    expect(avisos[0]).toEqual({
      id: "mant-atrasadas",
      titulo: "Órdenes de trabajo atrasadas",
      cantidad: 20,
      href: "/mantenimiento/ordenes?estado=ATRASADO",
    });
  });

  /*
   * La bandeja de carbonilla es lo único que queda sin aplicarse después del
   * 23/10/2026, cuando una fila cambiada pasó a releerse sola. Lo que cae ahí
   * es lo que el SdG NO puede resolver: una fila vaciada, un código que no es
   * de ningún carbonillero, un id duplicado por copiar y pegar.
   *
   * Existe desde el 13/10 y no la miró nadie. Mientras tanto el SdG estuvo 8 t
   * abajo una semana y 59 t abajo dos días después, y las dos veces me enteré
   * porque alguien me lo pidió. Un tablero que hay que acordarse de abrir no es
   * un tablero.
   */
  it("avisa de las filas de carbonilla que el SdG no pudo resolver", () => {
    expect(avisosDeConteos({ calidadCarbonillaBandeja: 3 })).toEqual([
      {
        id: "calidad-carbonilla-bandeja",
        titulo: "Filas de la planilla de carbonilla que el sistema no pudo leer",
        cantidad: 3,
        href: "/calidad/carbonilla",
      },
    ]);
  });

  it("incluye los dos módulos nuevos", () => {
    const avisos = avisosDeConteos({ calidadEnvasesSinPlanilla: 2, trituracionSinPlanilla: 2 });
    expect(avisos.map((a) => a.id)).toEqual(["calidad-envases-sin-planilla", "trituracion-sin-planilla"]);
  });

  /*
   * El aviso que reemplazó a los dos de service de 250 hs, que medían una tabla
   * con un solo service y sólo podían decir 0 o 1. El `id` se fija acá a
   * propósito: tiene que ser **nuevo** y no reusar
   * `taller-vial-service-vencido` ni `taller-vial-service-proximo`, porque a
   * quien hubiera descartado alguno de esos le llegaría ya silenciado un aviso
   * que nunca vio.
   */
  it("avisa de los equipos sin ningún service registrado, con un id propio", () => {
    expect(avisosDeConteos({ tallerVialSinService: 15 })).toEqual([
      {
        id: "taller-vial-sin-service",
        titulo: "Equipos sin ningún service registrado",
        cantidad: 15,
        href: "/taller-vial/services",
      },
    ]);
  });

  it("sale después del aviso de cargas sin equipo, como antes salían los de service", () => {
    const avisos = avisosDeConteos({ tallerVialSinEquipo: 3, tallerVialSinService: 15, trituracionSinPlanilla: 1 });
    expect(avisos.map((a) => a.id)).toEqual([
      "taller-vial-sin-equipo",
      "taller-vial-sin-service",
      "trituracion-sin-planilla",
    ]);
  });
});

describe("avisosDeRitmo", () => {
  const ritmo = {
    despacho: { ultimaFecha: "2026-10-01", diasSinCargar: 5, umbral: 4, atrasado: true },
    trituracion: { ultimaFecha: "2026-08-31", diasSinCargar: 36, umbral: 4, atrasado: true },
    inventario: { ultimaFecha: "2026-10-05", diasSinCargar: 1, umbral: 5, atrasado: false },
    produccion: { ultimaFecha: null, diasSinCargar: null, umbral: 3, atrasado: true },
  };

  /*
   * En la tarjeta la señal aparece apenas pasa el umbral; en la campana recién
   * al doble, para que Despacho con 5 días no haga ruido y Trituración con 36 sí.
   */
  it("sólo avisa pasado el doble del umbral", () => {
    const avisos = avisosDeRitmo(ritmo, ["despacho", "trituracion", "inventario"]);
    expect(avisos.map((a) => a.id)).toEqual(["ritmo-trituracion"]);
  });

  it("un módulo que nunca se cargó avisa siempre, con cantidad 1", () => {
    const avisos = avisosDeRitmo(ritmo, ["produccion"]);
    expect(avisos).toEqual([
      {
        id: "ritmo-produccion",
        titulo: "Producción: nunca se cargó nada",
        cantidad: 1,
        href: "/produccion",
      },
    ]);
  });

  it("la cantidad no crece de un día para el otro", () => {
    const hoy = avisosDeRitmo({ trituracion: { ultimaFecha: "x", diasSinCargar: 36, umbral: 4, atrasado: true } }, ["trituracion"]);
    const manana = avisosDeRitmo({ trituracion: { ultimaFecha: "x", diasSinCargar: 37, umbral: 4, atrasado: true } }, ["trituracion"]);
    expect(manana[0].cantidad).toBe(hoy[0].cantidad);
  });

  it("no avisa de un módulo al que el usuario no tiene acceso", () => {
    expect(avisosDeRitmo(ritmo, ["inventario"])).toEqual([]);
  });
});

describe("los avisos de la Agenda", () => {
  it("las divergencias salen con id propio y llevan a la Agenda", () => {
    expect(avisosDeConteos({ agendaDivergencias: 2 })).toEqual([
      {
        id: "agenda-divergencias",
        titulo: "Eventos del calendario que alguien cambió desde Google",
        cantidad: 2,
        href: "/agenda",
      },
    ]);
  });

  it("con cero no avisa", () => {
    expect(avisosDeConteos({ agendaDivergencias: 0 })).toEqual([]);
  });

  /*
   * Los dos avisos de salud de la Agenda —`agenda-pasos-caidos` y
   * `agenda-salud-sin-comprobar`— se retiraron el 05/11/2026: los reemplaza
   * `avisosDeSalud`, que hace lo mismo para los 29 recursos. Esto fija que no
   * volvieron por la puerta de atrás: reusar uno de esos ids le entregaría a
   * quien lo había descartado un aviso ya silenciado que nunca vio.
   */
  it("los dos avisos de salud de la Agenda no existen más, con ningún conteo", () => {
    const todos = avisosDeSalud({
      caidas: [caida("agenda/canales")],
      sinDeclarar: ["x/y"],
      sinComprobar: true,
      corridas: [],
    }).map((a) => a.id);
    expect(todos).not.toContain("agenda-pasos-caidos");
    expect(todos).not.toContain("agenda-salud-sin-comprobar");
  });
});

describe("avisosDeSalud", () => {
  it("cada recurso caído es su propio aviso, con id estable", () => {
    const avisos = avisosDeSalud({
      caidas: [
        { clave: "agenda/canales", titulo: "Agenda: los canales de Google", estado: "fallo", cuantoLlevaMal: 1, detalle: "x" },
        { clave: "calidad/carbonilla-odoo", titulo: "Calidad: la lectura de Odoo", estado: "fallo", cuantoLlevaMal: 2, detalle: "y" },
      ],
      sinDeclarar: [], sinComprobar: false, corridas: [],
    });
    expect(avisos.map((a) => a.id)).toEqual(["salud-agenda/canales", "salud-calidad/carbonilla-odoo"]);
    expect(avisos.every((a) => a.href === "/administracion/salud")).toBe(true);
  });

  /*
   * El caso que tiró abajo la forma de un solo aviso con el conteo: se arregla
   * uno y se rompe otro el mismo día. Con un conteo agregado la cantidad queda
   * en 1, `loQueSeMovio` no ve movimiento y el fallo nuevo es invisible.
   */
  it("un fallo que reemplaza a otro es un aviso nuevo y no un empate", () => {
    const ayer = avisosDeSalud({ caidas: [caida("calidad/carbonilla-odoo")], sinDeclarar: [], sinComprobar: false, corridas: [] });
    const hoy = avisosDeSalud({ caidas: [caida("agenda/canales")], sinDeclarar: [], sinComprobar: false, corridas: [] });
    expect(hoy[0].id).not.toBe(ayer[0].id);
  });

  it("la cantidad es cuánto lleva mal, para que el descarte se suelte", () => {
    const [a] = avisosDeSalud({ caidas: [{ ...caida("agenda/canales"), cuantoLlevaMal: 3 }], sinDeclarar: [], sinComprobar: false, corridas: [] });
    expect(a.cantidad).toBe(3);
    expect(filtrarDescartadas([a], [{ notificacion_id: a.id, cantidad_vista: 1 }])).toEqual([a]);
  });

  it("un recurso sin declarar también avisa", () => {
    const avisos = avisosDeSalud({ caidas: [], sinDeclarar: ["nuevo/cosa"], sinComprobar: false, corridas: [] });
    expect(avisos).toHaveLength(1);
  });

  it("no se pudo comprobar es su propio aviso y no un cero", () => {
    const avisos = avisosDeSalud({ caidas: [], sinDeclarar: [], sinComprobar: true, corridas: [] });
    expect(avisos.map((a) => a.id)).toEqual(["salud-sin-comprobar"]);
  });

  /*
   * EL PEOR DE TODOS PARA DEJAR DESCARTABLE PARA SIEMPRE: es el aviso que avisa
   * que **el vigilante quedó ciego**. Con una cantidad fija, una lectura
   * fallida, un descarte, y una rotura posterior de `ultima_sincronizacion` no
   * se anuncia nunca más.
   *
   * No hay estado persistido del que sacar una racha —no se sabe cuántas veces
   * seguidas falló la lectura—, así que el número **es el día**: crece solo, de
   * a uno, y con eso el descarte dura exactamente una jornada.
   */
  it("el de «no se pudo comprobar» crece con el día, así el descarte dura un día", () => {
    const sinComprobar = { caidas: [], sinDeclarar: [], sinComprobar: true, corridas: [] };
    const [hoy] = avisosDeSalud(sinComprobar, "2026-11-05");
    const [manana] = avisosDeSalud(sinComprobar, "2026-11-06");
    expect(manana.cantidad).toBe(hoy.cantidad + 1);

    const descartado = [{ notificacion_id: hoy.id, cantidad_vista: hoy.cantidad }];
    expect(filtrarDescartadas([hoy], descartado)).toEqual([]);
    expect(filtrarDescartadas([manana], descartado)).toEqual([manana]);
  });

  it("el mismo día es el mismo número: no se multiplica por cada vez que se mira", () => {
    const sinComprobar = { caidas: [], sinDeclarar: [], sinComprobar: true, corridas: [] };
    expect(avisosDeSalud(sinComprobar, "2026-11-05")[0].cantidad).toBe(
      avisosDeSalud(sinComprobar, "2026-11-05")[0].cantidad
    );
  });

  /*
   * Y por eso no puede entrar al resumen de movimiento: un número que sube solo
   * todos los días saldría como novedad todos los días, que es exactamente lo
   * que dejó a 2 de 13 personas con los 13 avisos descartados.
   */
  it("queda fuera del movimiento diario, que es la otra mitad de que esto se banque", () => {
    expect(CRECE_CON_EL_DIA.has("salud-sin-comprobar")).toBe(true);
  });

  it("con todo sano no avisa nada", () => {
    expect(avisosDeSalud({ caidas: [], sinDeclarar: [], sinComprobar: false, corridas: [] })).toEqual([]);
  });

  /*
   * El título es lo único que llega al teléfono, así que tiene que decir **cuál**
   * se rompió y **qué dijo el sistema** —el texto sin traducir, que es la regla
   * de las planillas—. El detalle entero vive en la pantalla, a un toque.
   */
  it("el título dice cuál se rompió y qué dijo el sistema, sin traducir", () => {
    const [a] = avisosDeSalud({
      caidas: [{ clave: "agenda/canales", titulo: "Canales de Google de la Agenda", estado: "fallo", cuantoLlevaMal: 1, detalle: "403 PERMISSION_DENIED" }],
      sinDeclarar: [], sinComprobar: false, corridas: [],
    });
    expect(a.titulo).toBe("Canales de Google de la Agenda: falló — 403 PERMISSION_DENIED");
  });

  /*
   * Con racha, cuántas corridas seguidas lleva fallando es mejor dato que el
   * error solo: distingue «se cayó recién» de «hace una semana que nadie mira».
   * Con una sola no se escribe, porque «falló 1 corrida seguida» no dice nada
   * que «falló» no diga.
   */
  it("un fallo que se repite dice cuántas corridas seguidas lleva", () => {
    const [a] = avisosDeSalud({
      caidas: [{ clave: "calidad/carbonilla-odoo", titulo: "Carbonilla contra Odoo", estado: "fallo", cuantoLlevaMal: 7, detalle: "No se pudo llegar a Odoo" }],
      sinDeclarar: [], sinComprobar: false, corridas: [],
    });
    expect(a.titulo).toBe("Carbonilla contra Odoo: falló 7 corridas seguidas — No se pudo llegar a Odoo");
  });

  /*
   * Lo que hace que el descarte caduque: `filtrarDescartadas` pide
   * `cantidad > cantidad_vista`, así que la corrida fallida de mañana —una más
   * en la racha— vuelve a mostrar el aviso que alguien silenció hoy. Es el
   * caso que tenía a `calidad/carbonilla-odoo` roto y mudo para siempre.
   */
  it("un descarte caduca en la corrida fallida siguiente", () => {
    const deHoy = avisosDeSalud({ caidas: [{ ...caida("calidad/carbonilla-odoo"), cuantoLlevaMal: 1 }], sinDeclarar: [], sinComprobar: false, corridas: [] });
    const descartes = [{ notificacion_id: deHoy[0].id, cantidad_vista: deHoy[0].cantidad }];
    expect(filtrarDescartadas(deHoy, descartes)).toEqual([]);

    const deManana = avisosDeSalud({ caidas: [{ ...caida("calidad/carbonilla-odoo"), cuantoLlevaMal: 2 }], sinDeclarar: [], sinComprobar: false, corridas: [] });
    expect(filtrarDescartadas(deManana, descartes)).toEqual(deManana);
  });

  it("el que no corre dice desde cuándo, y el que nunca corrió lo dice", () => {
    const [viejo, nunca, ilegible] = avisosDeSalud({
      caidas: [
        { clave: "a/b", titulo: "Equis", estado: "vieja", cuantoLlevaMal: 2, detalle: "hace 3 días" },
        { clave: "c/d", titulo: "Zeta", estado: "nunca", cuantoLlevaMal: 1, detalle: "nunca corrió" },
        // `haceCuantoCorto` dice esto de un `created_at` que no se entiende, y
        // con un «desde» adelante saldría en castellano roto.
        { clave: "e/f", titulo: "Ye", estado: "vieja", cuantoLlevaMal: 1, detalle: "en una fecha ilegible" },
      ],
      sinDeclarar: [], sinComprobar: false, corridas: [],
    });
    expect(viejo.titulo).toBe("Equis: no corre — hace 3 días");
    expect(nunca.titulo).toBe("Zeta: nunca corrió");
    expect(ilegible.titulo).toBe("Ye: no corre — en una fecha ilegible");
  });

  /*
   * El cuerpo del push junta los títulos con saltos de línea, así que un error
   * de Google de tres renglones le rompe el formato al resumen entero; y un
   * título largo lo corta el sistema operativo donde se le ocurre.
   */
  it("un error largo o de varias líneas entra en una línea y cortado por nosotros", () => {
    const [a] = avisosDeSalud({
      caidas: [{ clave: "a/b", titulo: "Equis", estado: "fallo", cuantoLlevaMal: 1, detalle: `Se cayó:\n${"x".repeat(200)}` }],
      sinDeclarar: [], sinComprobar: false, corridas: [],
    });
    expect(a.titulo).not.toContain("\n");
    expect(a.titulo.length).toBeLessThan(120);
    expect(a.titulo.endsWith("…")).toBe(true);
  });

  it("los sin declarar van en un aviso que los nombra, porque el número no se imprime", () => {
    const [a] = avisosDeSalud({ caidas: [], sinDeclarar: ["nuevo/cosa", "otro/mas"], sinComprobar: false, corridas: [] });
    expect(a.id).toBe("salud-sin-declarar");
    expect(a.cantidad).toBe(2);
    expect(a.titulo).toContain("nuevo/cosa");
    expect(a.titulo).toContain("otro/mas");
  });

  it("los caídos salen antes que lo sin declarar: un recurso roto manda sobre uno sin fichar", () => {
    const avisos = avisosDeSalud({
      caidas: [caida("agenda/canales")], sinDeclarar: ["nuevo/cosa"], sinComprobar: false, corridas: [],
    });
    expect(avisos.map((a) => a.id)).toEqual(["salud-agenda/canales", "salud-sin-declarar"]);
  });
});
