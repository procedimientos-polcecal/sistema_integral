import { describe, it, expect } from "vitest";
import {
  loQueHayQueExportarDeLaOS, elPendienteDelIntentoDeOS, fechaDeOSParaLaPlanilla,
  type LoQueLaPlanillaDeOSNoSabe,
} from "@/lib/mantenimiento/pendienteDeLaOS";

/** Una OS ya aprobada, viviendo en la pestaña de su área. */
function enSuArea(extra: Partial<LoQueLaPlanillaDeOSNoSabe> = {}): LoQueLaPlanillaDeOSNoSabe {
  return {
    sheets_tab: "CALCINACION",
    estado: null, proveedor_elegido: null,
    fecha_pedido: null, fecha_realizacion: null, observaciones: null,
    ...extra,
  };
}

/** Una OS que todavía no se aprobó: vive sólo en el maestro. */
function enElMaestro(extra: Partial<LoQueLaPlanillaDeOSNoSabe> = {}): LoQueLaPlanillaDeOSNoSabe {
  return enSuArea({ sheets_tab: "SERVICIOS", ...extra });
}

describe("loQueHayQueExportarDeLaOS", () => {
  it("arma el seguimiento que la planilla no sabe", () => {
    const campos = loQueHayQueExportarDeLaOS(
      enSuArea({ estado: "EN CURSO", proveedor_elegido: "Metalúrgica Sur" })
    );
    expect(campos).toEqual([
      { clave: "estado", valor: "EN CURSO" },
      { clave: "proveedor_elegido", valor: "Metalúrgica Sur" },
    ]);
  });

  it("null cuando no hay nada: una cola con filas vacías deja de decir si algo está trabado", () => {
    expect(loQueHayQueExportarDeLaOS(enSuArea())).toBeNull();
    // Y el motivo de rechazo no cuenta: no va a la planilla a propósito.
    expect(loQueHayQueExportarDeLaOS(enSuArea({ observaciones: "   " }))).toBeNull();
  });

  it("lo vacío no viaja: no borra una celda que nadie llenó", () => {
    // El seguimiento de una OS lo carga Mantenimiento a mano desde antes de que
    // existiera el SdG. Vaciarle el proveedor porque el sistema no lo tiene
    // sería escribir de más en una planilla que mira gente.
    const campos = loQueHayQueExportarDeLaOS(
      enSuArea({ estado: "EN CURSO", proveedor_elegido: "", observaciones: null })
    );
    expect(campos).toEqual([{ clave: "estado", valor: "EN CURSO" }]);
  });

  it("las fechas van como las escribe la planilla, no en ISO", () => {
    const campos = loQueHayQueExportarDeLaOS(
      enSuArea({ fecha_pedido: "2026-11-02", fecha_realizacion: "2026-11-20" })
    );
    expect(campos).toEqual([
      { clave: "fecha_pedido", valor: fechaDeOSParaLaPlanilla("2026-11-02") },
      { clave: "fecha_realizacion", valor: fechaDeOSParaLaPlanilla("2026-11-20") },
    ]);
    // Y el mediodía evita que la zona horaria corra el día hacia atrás.
    expect(fechaDeOSParaLaPlanilla("2026-11-02")).toBe("2/11/2026");
  });

  describe("APROBADO nunca sale de la cola hacia el maestro", () => {
    it("lo saca del registro: la cola no puede comprobar si correría filas", () => {
      // Aprobar mete la fila en la pestaña de su área y eso corre las de abajo,
      // dejando el seguimiento escrito a mano colgado de otra orden. El PATCH
      // lo hace con la cuenta hecha y escribiendo antes de guardar; un drenaje
      // no puede. Si lo dejara pasar, `escribirEnLaFilaDeLaOS` lo descartaría y
      // devolvería "todavía no está aprobada": un pendiente irresoluble.
      const campos = loQueHayQueExportarDeLaOS(
        enElMaestro({ estado: "APROBADO", observaciones: "para la parada" })
      );
      expect(campos).toEqual([{ clave: "observaciones", valor: "para la parada" }]);
    });

    it("pero en la pestaña de un área es seguimiento como cualquier otro", () => {
      // Esa fila ya está adentro: escribirlo no mueve nada.
      const campos = loQueHayQueExportarDeLaOS(enSuArea({ estado: "APROBADO" }));
      expect(campos).toEqual([{ clave: "estado", valor: "APROBADO" }]);
    });

    it("y un estado que no aprueba sí va al maestro: es el caso de denegar", () => {
      const campos = loQueHayQueExportarDeLaOS(enElMaestro({ estado: "DENEGADO" }));
      expect(campos).toEqual([{ clave: "estado", valor: "DENEGADO" }]);
    });

    it("sin que nada más quede para el maestro, no hay nada que encolar", () => {
      expect(loQueHayQueExportarDeLaOS(enElMaestro({ estado: "APROBADO" }))).toBeNull();
    });
  });
});

describe("elPendienteDelIntentoDeOS", () => {
  it("sin error no se anota nada", () => {
    expect(elPendienteDelIntentoDeOS(enSuArea({ estado: "EN CURSO" }), null)).toBeNull();
  });

  it("con error se anota lo que dijo Google, sin traducir", () => {
    const porque = "The caller does not have permission (403)";
    expect(elPendienteDelIntentoDeOS(enSuArea({ estado: "EN CURSO" }), porque)).toBe(porque);
  });

  it("NO se anota lo que la cola no sabe rehacer", () => {
    // Un PATCH que sólo cambió `motivo_rechazo` no escribe la planilla, así que
    // encolarlo dejaría un pendiente que el primer drenaje limpia solo — y la
    // orden habría estado protegida de la importación por una razón que ya no
    // existe.
    expect(elPendienteDelIntentoDeOS(enSuArea(), "lo que sea")).toBeNull();
  });
});
