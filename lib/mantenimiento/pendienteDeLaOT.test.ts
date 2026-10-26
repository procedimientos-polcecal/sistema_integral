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

/** Una recién creada: sin nada que la planilla no sepa ya. */
const reciencreada = {
  estado: "POR_HACER",
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
    expect(elPendienteDelIntento(reciencreada, LO_QUE_DIJO_GOOGLE)).toBeNull();
  });

  /**
   * «Por hacer» no se exporta —la `M` trae la fórmula de atrasado/al día— pero
   * las horas y los operarios viajan solos. Una orden así SÍ tiene qué
   * reintentar, así que el fallo se anota.
   */
  it("encola aunque el estado sea POR_HACER, si hay horas u operarios", () => {
    const soloHoras = { ...reciencreada, horas: 0, operario_1: "Lopez" };
    expect(elPendienteDelIntento(soloHoras, LO_QUE_DIJO_GOOGLE)).toBe(LO_QUE_DIJO_GOOGLE);
  });
});
