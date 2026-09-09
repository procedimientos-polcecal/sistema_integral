import { describe, it, expect } from "vitest";
import {
  fusionarConLoQueYaHabia, type DeLaPlanilla, type LoQueYaHabia,
} from "./fusionDeLaPlanilla";

/** La planilla no dijo nada de nada: todas las celdas vacías. */
const NADA: DeLaPlanilla = {
  prioridad: null,
  estado_aprobacion: null,
  estado_compra: null,
  solicitante_nombre: null,
  compra_asignada_a: null,
  comparativa_drive_id: null,
  paga: null,
};

/** Un pedido cargado en el sistema, con todo lo que el sistema sabe de el. */
const DEL_SISTEMA: LoQueYaHabia = {
  prioridad: "1 SEMANA",
  estado_aprobacion: "PENDIENTE",
  estado_compra: "SIN_INICIAR",
  solicitante_nombre: "Admin SdG",
  compra_asignada_a: null,
  comparativa_drive_id: null,
  empresa_id: null,
  paga_ambas: true,
  origen: "app",
};

describe("lo que se conserva cuando la planilla vuelve a traer un RI", () => {
  it("un pedido cargado en el sistema sigue diciendo que entro por el sistema", () => {
    // El indicador de /compras/configuracion mide por aca por donde entran los
    // pedidos nuevos, y es el que decide cuando apagar el formulario. Si la
    // sincronizacion lo pisa con "sheets", mide siempre cero.
    expect(fusionarConLoQueYaHabia(NADA, DEL_SISTEMA).origen).toBe("app");
  });

  it("el que no existia entra como de la planilla", () => {
    expect(fusionarConLoQueYaHabia(NADA, undefined).origen).toBe("sheets");
  });

  it("una celda vacia no borra la prioridad ni quien paga", () => {
    // Las dos las elige quien pide, en el alta. En la planilla son columnas a
    // mano que recien se llenan al aprobar: vacias significan "todavia no",
    // no "borralo".
    const r = fusionarConLoQueYaHabia(NADA, DEL_SISTEMA);
    expect(r.prioridad).toBe("1 SEMANA");
    expect(r.paga_ambas).toBe(true);
  });

  it("pero lo que la planilla SI dice, manda", () => {
    const r = fusionarConLoQueYaHabia(
      { ...NADA, prioridad: "URGENTE", paga: { empresa_id: "e-polcecal", ambas: false } },
      DEL_SISTEMA
    );
    expect(r.prioridad).toBe("URGENTE");
    expect(r.empresa_id).toBe("e-polcecal");
    expect(r.paga_ambas).toBe(false);
  });

  it("sin planilla y sin previo, los estados caen al valor de un RI nuevo", () => {
    const r = fusionarConLoQueYaHabia(NADA, undefined);
    expect(r.estado_aprobacion).toBe("PENDIENTE");
    expect(r.estado_compra).toBe("SIN_INICIAR");
    expect(r.prioridad).toBeNull();
    expect(r.empresa_id).toBeNull();
    expect(r.paga_ambas).toBe(false);
  });

  it("el estado que trae la planilla no se pierde", () => {
    // Es el otro lado de la regla: 15 RI pasaron de PEDIDO a SIN_INICIAR en una
    // sola corrida cuando el default gano sobre lo que habia.
    const r = fusionarConLoQueYaHabia({ ...NADA, estado_compra: "RECIBIDO" }, DEL_SISTEMA);
    expect(r.estado_compra).toBe("RECIBIDO");
  });

  it("la comparativa enlazada no se pierde si esta vez no se pudo leer el link", () => {
    const conComparativa = { ...DEL_SISTEMA, comparativa_drive_id: "drive-1" };
    expect(fusionarConLoQueYaHabia(NADA, conComparativa).comparativa_drive_id).toBe("drive-1");
  });
});
