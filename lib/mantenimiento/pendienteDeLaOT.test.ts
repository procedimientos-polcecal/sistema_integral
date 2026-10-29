import { describe, it, expect } from "vitest";
import { elPendienteDelIntento } from "./pendienteDeLaOT";

/** Una orden con el registro que entró por el PATCH. */
const registrada = {
  estado: "REALIZADO",
  fecha_cierre: "2026-10-10",
  horas: 16,
  contratista: "CANDIA",
  operario_1: null,
  operario_2: null,
  operario_3: null,
};

/**
 * Una fila sin nada que la cola pueda rehacer.
 *
 * **Era `estado: "POR_HACER"` y dejó de servir el 29/10/2026.** Hasta
 * entonces «por hacer» no se exportaba, así que una orden recién creada no
 * tenía nada que mandar; desde que su estado viaja como fórmula, sí lo tiene
 * —y encolarla es lo correcto—. El único caso que sigue dando null es una
 * fila **sin estado** y sin nada cargado, que es lo que queda acá: el ejemplo
 * cambió, lo que el test afirma no.
 */
const sinNadaQueRehacer = {
  estado: null,
  fecha_cierre: null,
  horas: null,
  contratista: null,
  operario_1: null,
  operario_2: null,
  operario_3: null,
};

const LO_QUE_DIJO_GOOGLE =
  "La OT 2908 todavía no está en la planilla —el master la recibe por IMPORTRANGE y tarda—.";

describe("elPendienteDelIntento", () => {
  it("anota el fallo cuando la cola puede rehacer el registro", () => {
    expect(elPendienteDelIntento(registrada, LO_QUE_DIJO_GOOGLE)).toBe(LO_QUE_DIJO_GOOGLE);
  });

  it("guarda el motivo sin traducir: un diagnóstico que no se distingue de otro no sirve", () => {
    const otro = "Google respondió 403: la cuenta de servicio no es editora.";
    expect(elPendienteDelIntento(registrada, otro)).toBe(otro);
  });

  it("no anota nada cuando salió bien", () => {
    expect(elPendienteDelIntento(registrada, null)).toBeNull();
  });

  /**
   * El caso que hace que esto sea una función y no un `if` en la ruta:
   * `exportarLoPendiente` rearma el registro desde la fila. Si la fila no tiene
   * con qué, encuentra la marca, la limpia y sigue — un pendiente que se borra
   * solo es peor que ninguno, porque además protege a la orden de la
   * importación por una razón que ya no existe.
   */
  it("no encola un fallo que la cola no puede rehacer desde la fila", () => {
    expect(elPendienteDelIntento(sinNadaQueRehacer, LO_QUE_DIJO_GOOGLE)).toBeNull();
  });

  /**
   * Las horas y los operarios viajan solos, sin estado. Una fila así SÍ tiene
   * qué reintentar, así que el fallo se anota. Cero horas cuenta: hay trabajos
   * de minutos y ese dato tiene que llegar.
   */
  it("encola si hay horas u operarios, aunque no haya estado", () => {
    const soloHoras = { ...sinNadaQueRehacer, horas: 0, operario_1: "Lopez" };
    expect(elPendienteDelIntento(soloHoras, LO_QUE_DIJO_GOOGLE)).toBe(LO_QUE_DIJO_GOOGLE);
  });

  /**
   * Y desde el 29/10/2026 una orden recién creada también: su «por hacer» va a
   * la planilla como fórmula, así que si la escritura falla —y al crear falla
   * casi siempre, porque la fila del master llega por `IMPORTRANGE`— hay que
   * encolarla. Si no, la celda del ESTADO se queda en blanco para siempre, que
   * es exactamente lo que pasó con ocho órdenes.
   */
  it("encola una orden recién creada, que ahora sí tiene estado que exportar", () => {
    const reciencreada = { ...sinNadaQueRehacer, estado: "POR_HACER" };
    expect(elPendienteDelIntento(reciencreada, LO_QUE_DIJO_GOOGLE)).toBe(LO_QUE_DIJO_GOOGLE);
  });
});
