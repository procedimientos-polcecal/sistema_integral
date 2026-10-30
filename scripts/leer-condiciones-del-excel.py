"""
Lee la hoja `CI Operativas` del Excel de condiciones inseguras y escribe las
filas como JSON por la salida estándar. Sólo lee: no abre macros, no escribe.

Lo usa `scripts/importar-condiciones-del-excel.mts`, que lo corre así:

    python -I scripts/leer-condiciones-del-excel.py <ruta al .xlsm>

`-I` (modo aislado) no es un detalle: el archivo llegó de afuera y se lo trata
como dato. Con `-I` Python no mira el directorio actual ni las variables
PYTHONPATH al importar, así que una carpeta con un `openpyxl.py` plantado al
lado del archivo no se ejecuta.

QUÉ ES UNA FILA DE DATOS
La hoja tiene la columna A numerada hasta la fila 596 como plantilla, y de la 54
para abajo hay valores viejos cacheados en celdas con fórmulas: eso no es dato.
Una fila es de datos si **tiene descripción** (columna D). Nada más. Las filas
que no la tienen pero sí algo en las columnas que se escriben a mano se cuentan
en `ignoradas_con_algo`, para que quede dicho qué se descartó.

LAS COLUMNAS se buscan por encabezado y no por posición, y si falta una se corta:
escribir o leer por posición ya costó caro en este repo.
"""
import json
import sys
import unicodedata
from datetime import date, datetime

import openpyxl

HOJA = "CI Operativas"
FILA_DEL_ENCABEZADO = 9
PRIMERA_FILA_DE_DATOS = 10


def comparable(texto):
    """El encabezado sin acentos, en minúsculas y sin saltos: 'Descripción' == 'descripcion'."""
    t = unicodedata.normalize("NFD", str(texto or ""))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return " ".join(t.lower().split())


def texto(valor):
    if valor is None:
        return None
    t = str(valor)
    return t if t.strip() else None


def fecha(valor):
    """Una fecha de verdad como AAAA-MM-DD. Cualquier otra cosa pasa como texto, y la rechaza el importador."""
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor.date().isoformat()
    if isinstance(valor, date):
        return valor.isoformat()
    return texto(valor)


def entero(valor):
    """Un número entero, o None. Un 3.0 es un 3; un 3.5 se deja pasar como está para que se vea."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        return int(valor) if float(valor).is_integer() else valor
    t = str(valor).strip()
    if not t:
        return None
    try:
        n = float(t.replace(",", "."))
        return int(n) if n.is_integer() else n
    except ValueError:
        return t


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("Uso: python -I leer-condiciones-del-excel.py <ruta al .xlsm>\n")
        sys.exit(2)

    # data_only: los valores que Excel dejó calculados. keep_vba=False: no se carga la macro.
    libro = openpyxl.load_workbook(sys.argv[1], data_only=True, keep_vba=False)
    if HOJA not in libro.sheetnames:
        sys.stderr.write("No encuentro la hoja «%s». Hojas: %s\n" % (HOJA, ", ".join(libro.sheetnames)))
        sys.exit(1)
    hoja = libro[HOJA]

    encabezados = {}
    for col in range(1, hoja.max_column + 1):
        h = comparable(hoja.cell(FILA_DEL_ENCABEZADO, col).value)
        # El primero que aparece gana: «Total» y «Observaciones» no se repiten donde importa.
        if h and h not in encabezados:
            encabezados[h] = col

    def columna(*nombres, prefijo=False):
        for n in nombres:
            if comparable(n) in encabezados:
                return encabezados[comparable(n)]
            if prefijo:
                for h, col in encabezados.items():
                    if h.startswith(comparable(n)):
                        return col
        sys.stderr.write(
            "No encuentro la columna «%s». Encabezados: %s\n" % (nombres[0], " | ".join(sorted(encabezados)))
        )
        sys.exit(1)

    c_numero = columna("N°")
    c_lugar = columna("Equipo o sector")
    c_detectada = columna("Fecha de detección")
    c_descripcion = columna("Descripción")
    c_detecto = columna("Motivo o herramienta de detección")
    c_accion = columna("Acción propuesta")
    c_responsable = columna("Responsable")
    c_maxima = columna("Fecha máxima de ejecución")
    c_ejecucion = columna("Fecha de ejecucion")
    c_prioridad = columna("Prioridad")
    c_estado = columna("Estado")
    c_inversion = columna("Requiere inversion")
    c_observaciones = columna("Observaciones")
    c_frecuencia = columna("Frecuencia")
    c_antecedentes = columna("Antecedentes de accidentes")
    c_controles = columna("Controles y Capacitación")
    c_magnitud = columna("Magnitud del daño")
    c_legislacion = columna("Legislación aplicable")
    # El encabezado lleva un salto de línea y un punto medio: «Nivel de riesgo (P·G)».
    c_nivel = columna("Nivel de riesgo", prefijo=True)
    c_foto = columna("FOTO")
    # Las fotos son la columna FOTO y las siguientes **hasta el próximo encabezado**: más a
    # la derecha la hoja tiene otra cosa (la programación de la tarea), que no son fotos.
    siguientes = [c for c in range(c_foto + 1, hoja.max_column + 1) if hoja.cell(FILA_DEL_ENCABEZADO, c).value is not None]
    ultima_foto = (siguientes[0] - 1) if siguientes else hoja.max_column

    filas = []
    ignoradas_con_algo = []
    # Las columnas que alguien escribe a mano; las demás son fórmulas con valores viejos cacheados.
    a_mano = [c_lugar, c_detectada, c_detecto, c_accion, c_responsable, c_maxima, c_ejecucion, c_prioridad]

    for f in range(PRIMERA_FILA_DE_DATOS, hoja.max_row + 1):
        valor = lambda c: hoja.cell(f, c).value
        if texto(valor(c_descripcion)) is None:
            if any(texto(valor(c)) is not None for c in a_mano):
                ignoradas_con_algo.append(f)
            continue

        fotos = []
        for c in range(c_foto, ultima_foto + 1):
            celda = hoja.cell(f, c)
            t = texto(celda.value)
            if t is not None:
                # El vínculo de la celda apunta al disco de quien armó la planilla; se informa, no se sigue.
                fotos.append(t.strip())

        filas.append(
            {
                "fila": f,
                "numero": entero(valor(c_numero)),
                "lugar": texto(valor(c_lugar)),
                "detectada": fecha(valor(c_detectada)),
                "descripcion": texto(valor(c_descripcion)),
                "detecto": texto(valor(c_detecto)),
                "accion": texto(valor(c_accion)),
                "responsable": texto(valor(c_responsable)),
                "fecha_maxima": fecha(valor(c_maxima)),
                "fecha_ejecucion": fecha(valor(c_ejecucion)),
                "prioridad": entero(valor(c_prioridad)),
                "estado": texto(valor(c_estado)),
                "requiere_inversion": texto(valor(c_inversion)),
                "observaciones": texto(valor(c_observaciones)),
                "frecuencia": entero(valor(c_frecuencia)),
                "antecedentes": entero(valor(c_antecedentes)),
                "controles": entero(valor(c_controles)),
                "magnitud_dano": entero(valor(c_magnitud)),
                "legislacion": entero(valor(c_legislacion)),
                "nivel": entero(valor(c_nivel)),
                "fotos": fotos,
            }
        )

    # ensure_ascii: la salida es ASCII puro, así que la consola de Windows no la puede deformar.
    json.dump({"filas": filas, "ignoradas_con_algo": ignoradas_con_algo}, sys.stdout, ensure_ascii=True)


main()
