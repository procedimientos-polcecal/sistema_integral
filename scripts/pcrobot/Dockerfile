# El subidor de zips del PC Robot, en un contenedor.
#
# Existe para no tener que instalar Node en el servidor: la imagen lo trae, y
# lo que se actualiza es la imagen y no la máquina. De paso el planificador va
# adentro (`--diario`), así que tampoco hace falta una tarea programada.
#
# Se construye desde este directorio:
#   docker compose build
#
# `node:22-slim` y no `alpine`: alpine trae un ICU recortado y acá se depende
# de la zona horaria para saber cuándo son las 09:30 de Argentina. Son 60 MB
# más y evitan una clase entera de sorpresas.
FROM node:22-slim

# Zona horaria de la planta. `--diario` compara contra la hora local del
# proceso, así que ESTO es lo que decide a qué hora sube. Se puede pisar desde
# el compose.
ENV TZ=America/Argentina/Buenos_Aires

WORKDIR /app

# El script no tiene dependencias: no hay package.json, ni npm install, ni
# node_modules. Un solo archivo, a propósito — ver su encabezado.
COPY subir-zips.mjs ./

# Corre como el usuario `node`, que la imagen ya trae sin privilegios. Lo único
# que necesita es leer /datos (montado de sólo lectura) y /config.
USER node

# Sin configuración no arranca, y el mensaje lo dice. La config y la credencial
# se montan desde afuera: no van adentro de la imagen, que se comparte y se
# versiona.
CMD ["node", "subir-zips.mjs", "/config/subir-zips.config.json", "--diario", "09:30"]
