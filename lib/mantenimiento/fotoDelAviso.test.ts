import { describe, it, expect } from "vitest";
import { fotosDelAviso, linksDeFotos, urlsDeLasFotos } from "./fotoDelAviso";

describe("linksDeFotos", () => {
  // El formulario de Google deja TODAS las fotos de una respuesta en una sola
  // celda, separadas por coma. Medido el 23/11/2026 sobre la planilla real:
  // 24 celdas con algo, 6 con más de un link, 31 fotos en total — o sea que
  // leer la celda como un link solo pierde 13 fotos de 31.
  it("una celda con un link da un link", () => {
    expect(linksDeFotos("https://drive.google.com/open?id=abc1234567")).toEqual([
      "https://drive.google.com/open?id=abc1234567",
    ]);
  });

  it("una celda con varios links separados por coma los da todos", () => {
    const celda =
      "https://drive.google.com/open?id=1d76RKqrkXT, https://drive.google.com/open?id=1H1B9nZvZQF";
    expect(linksDeFotos(celda)).toEqual([
      "https://drive.google.com/open?id=1d76RKqrkXT",
      "https://drive.google.com/open?id=1H1B9nZvZQF",
    ]);
  });

  it("tres links, y aunque los separe un salto de línea", () => {
    expect(linksDeFotos("https://a.com/1.jpg,https://b.com/2.jpg\nhttps://c.com/3.jpg")).toEqual([
      "https://a.com/1.jpg", "https://b.com/2.jpg", "https://c.com/3.jpg",
    ]);
  });

  it("una celda que no tiene ningún link no da ninguno", () => {
    // `#REF!` es lo que tuvo esa columna durante meses: sin esto se guardaba
    // como si fuera una foto.
    for (const celda of [null, undefined, "", "   ", "#REF!", "sin foto", "C:\\fotos\\a.jpg"]) {
      expect(linksDeFotos(celda)).toEqual([]);
    }
  });

  it("rescata el link aunque venga pegado a texto", () => {
    expect(linksDeFotos("foto: https://a.com/1.jpg (la de la cinta)")).toEqual([
      "https://a.com/1.jpg",
    ]);
  });
});

describe("urlsDeLasFotos", () => {
  it("aplana las celdas en una sola lista", () => {
    expect(urlsDeLasFotos(["https://a.com/1.jpg, https://b.com/2.jpg", "https://c.com/3.jpg"]))
      .toEqual(["https://a.com/1.jpg", "https://b.com/2.jpg", "https://c.com/3.jpg"]);
  });

  it("sin fotos, lista vacía", () => {
    expect(urlsDeLasFotos(null)).toEqual([]);
    expect(urlsDeLasFotos(["", null, "#REF!"])).toEqual([]);
  });
});

describe("fotosDelAviso", () => {
  it("sin fotos no hay nada que mostrar", () => {
    expect(fotosDelAviso(null)).toEqual([]);
    expect(fotosDelAviso(undefined)).toEqual([]);
    expect(fotosDelAviso([])).toEqual([]);
  });

  it("descarta lo vacío y lo que no es un link", () => {
    expect(fotosDelAviso(["", "   ", null, "sin foto", "C:\\fotos\\a.jpg"])).toEqual([]);
  });

  it("descarta un `javascript:` aunque termine en .jpg", () => {
    // La columna K de la planilla es texto que tipea una persona y entra sin
    // validar (`avisos.ts`): sin este filtro iría derecho a un `href`.
    expect(fotosDelAviso(["javascript:alert(1)//a.jpg"])).toEqual([]);
    expect(fotosDelAviso(["data:text/html;base64,PHNjcmlwdD4="])).toEqual([]);
  });

  it("una foto del bucket se muestra como imagen", () => {
    const url =
      "https://abcd.supabase.co/storage/v1/object/public/execution-photos/avisos/A245/1763500000000.jpg";
    expect(fotosDelAviso([url])).toEqual([{ tipo: "imagen", url }]);
  });

  it("un link firmado también, aunque lleve el token en la query", () => {
    const url =
      "https://abcd.supabase.co/storage/v1/object/sign/execution-photos/avisos/A245/1.png?token=xx.yy.zz";
    expect(fotosDelAviso([url])).toEqual([{ tipo: "imagen", url }]);
  });

  it("la extensión se reconoce en mayúsculas", () => {
    const url = "https://ejemplo.com/foto.JPEG";
    expect(fotosDelAviso([url])[0].tipo).toBe("imagen");
  });

  it("sin el id del aviso, una foto de Drive queda como enlace", () => {
    // Es el caso de antes de compartir la carpeta, y sigue siendo el respaldo:
    // el link de Google no se puede dibujar, lo abre quien tenga permiso.
    const url = "https://drive.google.com/open?id=1IZS7xcwoEgR4hX9colEC4J_uPPbR6v6z";
    const [foto] = fotosDelAviso([url]);
    expect(foto).toMatchObject({ tipo: "enlace", url });
    expect(foto.tipo === "enlace" && foto.porQue).toMatch(/Drive/);
  });

  it("con el id del aviso, la trae el SdG y se muestra", () => {
    const url = "https://drive.google.com/open?id=1IZS7xcwoEgR4hX9colEC4J_uPPbR6v6z";
    expect(fotosDelAviso([url], "av-1")).toEqual([
      {
        tipo: "imagen",
        url: "/api/mantenimiento/avisos/foto?aviso=av-1&n=0",
        respaldo: url,
      },
    ]);
  });

  it("las otras formas del link de Drive también", () => {
    const fotos = fotosDelAviso([
      "https://drive.google.com/file/d/1IZS7x/view?usp=drivesdk",
      "https://docs.google.com/document/d/1IZS7x/edit",
      "https://lh3.googleusercontent.com/d/1IZS7x",
    ]);
    expect(fotos.map((f) => f.tipo)).toEqual(["enlace", "enlace", "enlace"]);
    expect(fotosDelAviso(fotos.map((f) => f.url), "av-1").map((f) => f.tipo)).toEqual([
      "imagen", "imagen", "imagen",
    ]);
  });

  it("un dominio que sólo TERMINA como el de Google no es Drive", () => {
    const url = "https://evilgoogleusercontent.com/d/1IZS7x/a.jpg";
    // Cae por extensión como cualquier otro link, no por ser de Google.
    expect(fotosDelAviso([url], "av-1")).toEqual([{ tipo: "imagen", url }]);
  });

  it("el `n` es la posición en la lista aplanada, la misma que usa la ruta", () => {
    // Pantalla y ruta tienen que contar igual o la ruta sirve otra foto. Las
    // dos entran por `urlsDeLasFotos`, así que el número significa lo mismo
    // de los dos lados aunque las celdas traigan varias fotos o basura.
    const drive = "https://drive.google.com/open?id=1IZS7xcwoEgR4hX";
    const fotos = fotosDelAviso(["", null, drive], "av-1");
    expect(fotos).toEqual([
      { tipo: "imagen", url: "/api/mantenimiento/avisos/foto?aviso=av-1&n=0", respaldo: drive },
    ]);
    expect(urlsDeLasFotos(["", null, drive])[0]).toBe(drive);
  });

  it("una celda con dos fotos de Drive se muestra como dos fotos", () => {
    // Los 6 avisos que el formulario dejó con varias fotos mostraban UNA
    // imagen rota: el link pegado no es una URL de nada.
    const celda =
      "https://drive.google.com/open?id=1d76RKqrkXT, https://drive.google.com/open?id=1H1B9nZvZQF";
    const fotos = fotosDelAviso([celda], "av-140");
    expect(fotos).toEqual([
      {
        tipo: "imagen",
        url: "/api/mantenimiento/avisos/foto?aviso=av-140&n=0",
        respaldo: "https://drive.google.com/open?id=1d76RKqrkXT",
      },
      {
        tipo: "imagen",
        url: "/api/mantenimiento/avisos/foto?aviso=av-140&n=1",
        respaldo: "https://drive.google.com/open?id=1H1B9nZvZQF",
      },
    ]);
  });

  it("un link que no se sabe qué es queda como enlace, no se adivina", () => {
    const url = "https://ejemplo.com/una/pagina";
    expect(fotosDelAviso([url])).toEqual([
      { tipo: "enlace", url, porQue: "No se sabe si este link es una foto; se abre aparte." },
    ]);
  });

  it("conserva el orden y limpia los espacios de los costados", () => {
    const fotos = fotosDelAviso([
      "  https://ejemplo.com/a.jpg  ",
      "https://drive.google.com/open?id=x",
    ]);
    expect(fotos).toEqual([
      { tipo: "imagen", url: "https://ejemplo.com/a.jpg" },
      {
        tipo: "enlace",
        url: "https://drive.google.com/open?id=x",
        porQue: "Está en Drive: la abre quien tenga permiso sobre esa carpeta.",
      },
    ]);
  });
});
