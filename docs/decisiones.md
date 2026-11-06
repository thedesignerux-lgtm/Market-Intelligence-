# Decisiones de arquitectura

Registro breve de las decisiones relevantes. Cada una indica el contexto, la decisión y sus consecuencias.

## ADR-0001 · Proyecto aislado y stack base

- **Contexto:** la plataforma no debe compartir recursos con GROPO.
- **Decisión:** repositorio, proyecto de Supabase (base de datos y claves), y despliegues propios.
  Por decisión del propietario (17-10-2026), el proyecto de Supabase vive en la organización «Gropo»:
  comparte facturación y miembros de la organización con GROPO, pero no comparte base de datos,
  claves ni código. Se puede transferir a otra organización más adelante sin cambiar el código. Stack: PostgreSQL + PostGIS (Supabase), worker en Node.js/TypeScript, aplicación web en Next.js (fase 1, siguiente paso) y mapa con MapLibre.
- **Consecuencias:** las migraciones viven en `supabase/migrations` y son la única fuente de verdad del esquema.

## ADR-0002 · OpenStreetMap: extractos provinciales en lugar de Overpass para cargas masivas

- **Contexto:** la instancia pública principal de Overpass pide, para uso regular, del orden de 100 consultas y 10 MB al día, y ahora exige registro y clave. Una importación por municipios y categorías lo superaría pronto.
- **Decisión:** descargar el extracto provincial (OSM France; Geofabrik como alternativa), verificar su MD5, reutilizarlo durante 24 h y filtrarlo localmente con `osmium`. Overpass queda reservado para exploraciones puntuales desde el mapa (fase posterior).
- **Consecuencias:** el worker necesita `osmium-tool` instalado. El mismo método escala a toda España (hay extractos por comunidad y provincia).

## ADR-0003 · Herramienta interna con espacios de trabajo desde el día 1

- **Contexto:** hoy es una herramienta interna, pero añadir separación de clientes después sería costoso.
- **Decisión:** dos capas. **Conocimiento** (entidades, fuentes, importaciones): compartida, de solo lectura para los miembros y escrita solo por el worker o por funciones controladas. **Comercial** (estado CRM, notas, historial): separada por espacio de trabajo con RLS.
- **Roles:** `admin`, `editor`, `comercial`, `lector`.

## ADR-0004 · Procedencia por campo y reglas de calidad

- **Decisión:** cada registro de origen se guarda intacto (`source_records`). Cada valor de campo se guarda con su fuente, método (`found`/`verified`/`inferred`/`manual`), confianza y fecha (`field_values`). La ficha (`entities`) se recalcula eligiendo el mejor valor: manual > verificado > encontrado > inferido; después confianza y fecha.
- **Geocodificación (CartoCiudad, CC BY 4.0):**
  - Las coordenadas obtenidas de una dirección se marcan como `inferred`, con precisión `address` o `street`.
  - Se rechaza un resultado de otro municipio, de una calle distinta o que no sea de tipo calle/portal.
  - No se inventan coordenadas: sin resultado válido, la entidad no aparece en el mapa.
- **Datos personales:**
  - Si la dirección de un club parece un domicilio (piso, puerta), se marca como dato personal y solo se geocodifica a nivel de calle.
  - Los móviles de los registros de clubes se marcan como dato personal.
- **Duplicados:** puntuación configurable (`src/lib/domain/matching.ts`).
  - Fusión automática solo con señal fuerte (mismo NIF, o nombre parecido más teléfono, web o proximidad).
  - Nunca entre dos registros de la misma fuente.
  - El resto va a revisión manual.
  - Fusiones auditadas y reversibles.
- **Desaparición:** un registro que deja de publicarse se marca `missing_since` y la entidad pasa a «sin verificar». Nunca se borra.

## ADR-0005 · Cola de tareas en PostgreSQL (sin Redis ni pg-boss)

- **Contexto:** el plan inicial proponía pg-boss.
- **Decisión:** la propia tabla `import_tasks` actúa como cola. Las tareas se reclaman con `FOR UPDATE SKIP LOCKED` y tienen reintentos con backoff exponencial y jitter, recuperación de tareas huérfanas, pausa, reanudación, cancelación y reintento de fallidas.
- **Por qué:** evita duplicar estado entre la cola y nuestras tablas de importación, y elimina una dependencia. Se revisará si el volumen lo exige (fase 6).

## ADR-0006 · Mapa con agrupación en servidor

- **Decisión:** `map_features` devuelve solo lo que hay en el área visible.
  - Si hay más de 1.500 puntos o el zoom es bajo, agrupa en celdas de unos 60 px directamente en PostGIS.
  - Nunca devuelve más de 5.000 puntos.
- **Consecuencias:** el navegador nunca recibe la base completa. Las vector tiles quedan para cuando las mediciones con toda España lo justifiquen.

## ADR-0007 · Roles comerciales separados del estado del CRM; participación en GROPO solo con prueba

**Contexto.** El resumen necesita distinguir compradores y vendedores potenciales de los que ya participan en GROPO. Market Intelligence no tiene datos de GROPO: está aislado a propósito (ADR-0001).

**Decisión.**
- Tabla `entity_roles` por espacio de trabajo con cuatro marcas: comprador potencial, vendedor potencial, comprador participante y vendedor participante. Una entidad puede tener varias.
- Las marcas de potencial se deducen del tipo de entidad (clubes, asociaciones y comunidades → comprador; comercios y distribuidores → vendedor) mientras nadie las cambie. Las cambian admin, editor y comercial.
- La participación **nunca se deduce** del directorio, del contacto ni del interés. La marca un admin o editor con una prueba (ID o enlace de la cuenta o del pedido en GROPO). Se guarda quién y cuándo, y queda en la auditoría. Opción elegida por el responsable del producto frente a sincronizar con la base de datos de GROPO, que rompería el aislamiento.
- Escritura solo a través de `set_entity_roles()`, que valida permisos y prueba. Los estados del CRM (Nuevo, Contactado…) no cambian.
- El CRM gana «próxima acción» y su fecha. Sin sistema de tareas aparte.

**Consecuencias.** El indicador de participantes empieza en 0 y crece solo con marcas verificadas. Si en el futuro se integra GROPO, la sincronización escribiría las mismas marcas con su prueba.

## ADR-0008 · Importador en GitHub Actions en lugar de un servidor propio

**Contexto.** El importador necesita Node y osmium, y conexión directa a PostgreSQL. Mantener un contenedor siempre encendido (Railway u otro) cuesta dinero y otra cuenta que gestionar. El responsable del producto prefirió no usar Railway.

**Decisión.** El importador se ejecuta en GitHub Actions: cada noche (refresco completo de Galicia y cola pendiente) y bajo demanda (la web lanza el workflow con la API de GitHub al pedir una importación). El modo `--once` procesa la cola y termina. La cola en PostgreSQL (ADR-0005) no cambia: el mismo código sirve como proceso continuo si algún día hace falta.

**Consecuencias.** Gratis mientras el repositorio sea público. Una importación pedida desde la web tarda alrededor de un minuto en empezar (arranque del runner). La contraseña de la base de datos vive solo en los secretos de GitHub. Si el repositorio pasa a privado, hay un cupo mensual de minutos gratuitos: la ejecución nocturna consume unos minutos al día.

## Licencias de las fuentes

| Fuente | Licencia | Obligaciones |
|---|---|---|
| OpenStreetMap | ODbL 1.0 | Atribución «© OpenStreetMap contributors». Las bases derivadas que se distribuyan deben compartirse con ODbL. |
| Rexistro de Entidades Deportivas (Xunta) | CC BY-SA 4.0 | Atribución. Lo derivado que se distribuya, con la misma licencia. |
| CartoCiudad (IGN/CNIG) | CC BY 4.0 | Atribución. |

Para uso interno no hay obligación de compartir. Las exportaciones a terceros deberán revisarse (fase 3).

## ADR-0009 · Cortacircuitos cuando una fuente deja de responder

**Contexto.** El 23-10-2026 el servidor de `abertos.xunta.gal` dejó de responder. El importador trató cada fallo como temporal y siguió reintentando: 13 días después la importación seguía en estado `running`, con 161 tareas fallidas y 151 en cola. Nadie se enteró, porque el aviso de la pantalla Importaciones solo miraba las importaciones en estado `queued`, no las que llevan días `running`. Además, mientras una importación sigue activa, el índice `import_runs_one_active_idx` impide lanzar otra de la misma fuente y alcance.

**Decisión.**
- El worker distingue un fallo de red (sin respuesta del servidor: `HttpError` con `status` nulo) de un fallo de datos.
- Si una misma fuente acumula 12 fallos de red seguidos dentro de una ejecución, el worker registra una incidencia de nivel `error` con código `source_unreachable` y cancela la importación con `control_import(run, 'cancel')`, que ya existía. Una sola tarea correcta reinicia la cuenta.
- La pantalla Importaciones avisa en rojo de cualquier importación que lleve más de 24 h en `running` o `paused`, y explica que bloquea otras de la misma fuente.
- La URL del registro gallego ya era configurable (`RED_CSV_URL`): un cambio de dirección de la fuente se arregla con una variable de entorno, sin desplegar.

**Consecuencias.** Una fuente caída deja de consumir la ventana nocturna del workflow y deja de bloquear otras importaciones. El coste es que una caída larga de verdad obliga a relanzar la importación a mano (`retry_failed` o una nueva), que es el comportamiento deseado: que alguien lo vea.

## ADR-0010 · Cargador propio para datos comerciales curados

**Contexto.** La investigación de distribuidores produce datos curados a mano: empresas nacionales, sin municipio, con la procedencia distinta en cada campo. La cola de importación no sirve para esto: `request_import()` exige entre 1 y 400 códigos INE de municipio y solo admite fuentes de tipo `osm` u `open_data`.

**Decisión.** Un cargador propio (`worker/cargar-curados.ts`), no una ampliación de `request_import()`.

- El cargador **no reimplementa la ingesta**: llama a `ingestRecord()`, la misma función que usa el worker. La deduplicación, la vinculación a entidades existentes y los candidatos a duplicado son idénticos.
- Abre y cierra un `import_runs` propio, para que estos registros queden trazados como cualquier otro.
- **En seco por defecto.** Sin `--escribir` solo imprime la previsualización.
- `NormalizedRecord` gana `extraFields`: campos con su propio método, confianza, URL y fecha de observación. Así «la web de la empresa confirma la especialización» y «el directorio deduce la web» no se guardan con la misma fiabilidad, sin necesidad de ninguna tabla nueva.

**Consecuencias.** No se toca una función de base de datos que usa toda la aplicación. El precio es un punto de entrada más, que se asume porque su ciclo de vida es distinto: un fichero curado se revisa en un diff y se carga a mano, no se refresca cada noche.

## ADR-0011 · Exclusión comercial de cadenas, separada de las reglas de categorías

**Contexto.** Decathlon y Sprinter venden bicicletas y algunas de sus tiendas están etiquetadas en OSM con servicios de bicicleta, así que las reglas de `category_mappings` las clasifican correctamente. Lo que no encaja es el modelo comercial: son cadenas con precios centralizados y sin capacidad de decisión en tienda, de modo que no pueden cerrar una compra agrupada.

**Decisión.** Una lista de exclusión comercial (`src/lib/domain/exclusiones.ts`) aplicada **después** de clasificar, no una modificación de las reglas de categorías. El descarte se cuenta como `skipped_excluded_chain` en las estadísticas de la importación, así que queda visible y es reversible quitando una línea.

El patrón exige palabra completa por los dos lados. Sin ese límite, «Bicicletas Sprinterman» —una tienda independiente— quedaría excluida por contener «sprinter»: un falso positivo elimina un vendedor real en silencio, así que se prefiere pecar de incluir de más. Hay prueba de ello.

**Consecuencias.** Las reglas generales siguen valiendo para cualquier otra fuente. Hoy la lista descarta 2 establecimientos en Barcelona.

## ADR-0012 · Previsualización con las mismas reglas que la carga

**Contexto.** Antes de incorporar cientos de entidades hace falta saber cuántas son nuevas, cuántas ya existen y cuántas acabarán en revisión. Una previsualización que use criterios propios sería peor que no tenerla: daría confianza falsa.

**Decisión.** `worker/preview.ts` reutiliza `findCandidates()` y `scoreMatch()`, las mismas piezas que la ingesta, incluida la regla de que dos registros de la misma fuente nunca se unen solos. Solo lee; hay una prueba que falla si aparece cualquier `insert`, `update` o `delete`. Clasifica en nuevas, existentes, duplicados y descartados, con el motivo en lenguaje llano, y cuenta los canales de contacto disponibles.

Para que previsualización e importación vean exactamente los mismos candidatos, `runOsmTask` y la previsualización comparten `construirRegistrosOsm()`.

**Consecuencias.** Si la previsualización y la carga difieren, es un error, no una diferencia de criterio.

## ADR-0013 · El proveedor de límites municipales se inyecta

**Contexto.** `construirRegistrosOsm()` necesita saber qué municipios tiene una provincia y qué puntos caen dentro de cada uno. Las dos cosas salían de `admin_areas`, y `ensureMunicipality()` las escribe si faltan. Eso convertía cualquier previsualización de una provincia no cargada en una escritura de miles de filas: Madrid y Barcelona tenían 0 municipios, así que previsualizarlas habría insertado unos 2.100 límites antes de leer nada.

**Decisión.** Quién provee los límites se inyecta (`worker/limites.ts`):

- `limitesDeBaseDeDatos(db)` — los lee de `admin_areas`. Es el valor por defecto, así que `runOsmTask` se comporta igual que antes. Solo el camino por defecto llama a `ensureMunicipality()`, de modo que la única escritura posible está a la vista en una línea.
- `limitesDelExtracto(db, config)` — los lee del propio extracto de OSM con `extractMunicipalities()`, que ya existía y solo ejecuta osmium sobre un fichero local. No escribe.

No son dos fuentes distintas: `admin_areas` se rellena justamente con lo que devuelve `extractMunicipalities()`. El proveedor de extracto lee lo mismo, antes de guardarlo.

La contención sigue resolviéndola PostGIS en los dos casos, con el mismo `st_contains`, el mismo SRID y el mismo `st_makevalid`. Lo único que cambia es que el polígono llega como parámetro en lugar de leerse de una tabla: sigue siendo un `SELECT`. Implementar aquí un punto-en-polígono propio habría sido una segunda versión de una regla ya existente.

**Consecuencias.** La previsualización se puede ejecutar sobre cualquier provincia sin escribir una sola fila, que era el objetivo. La importación real sigue necesitando los límites en `admin_areas` (los usan `markMissing` y el mapa), así que esto permite mirar antes de decidir, no evita la escritura de la importación.

La prueba que lo sostiene no es un comentario: una base de datos centinela lanza excepción ante cualquier `insert`, `update`, `delete`, `truncate`, `alter`, `drop`, `create`, `grant`, `revoke`, `merge` o `copy` en el camino completo. Se verificó por mutación: al reintroducir a propósito la llamada a `ensureMunicipality()`, la prueba falla con el `insert into public.admin_areas` en el mensaje.

## ADR-0014 · La previsualización se detiene si no puede garantizar que lee los datos

**Contexto.** Todas las tablas de `public` tienen RLS, y sus políticas comprueban `has_role_anywhere(...)` contra `memberships`. Un rol de solo lectura creado a mano no es miembro de ningún espacio de trabajo, así que ninguna política se cumple. PostgreSQL entonces **no da error: omite las filas**. `select count(*) from category_mappings` devuelve 0 en lugar de 12 y la previsualización termina con 0 candidatos, con aspecto de haber funcionado.

Ocurrió de verdad al validar contra una base local: la primera ejecución dio 0 registros sin ningún mensaje.

**Decisión.** `worker/lectura.ts` comprueba antes de empezar que ninguna tabla imprescindible esté filtrando filas para el rol actual, y que se vea al menos una regla de categorías de `osm`. Si no puede garantizarlo, lanza `LecturaNoGarantizada` con la causa y la solución. Prefiere pararse a entregar un informe vacío que parezca correcto.

**Consecuencias.** Un fallo silencioso pasa a ser ruidoso. El coste es una consulta más al arrancar.

## ADR-0015 · Los choques de lote se detectan con el emparejador real

**Contexto.** Dos registros de la misma importación que son el mismo negocio no se pueden comparar con `findCandidates()`, porque ninguna de las dos entidades existe todavía. La primera versión los buscaba por nombre idéntico y mismo municipio.

Al reconciliar la previsualización con el análisis completo apareció el hueco: el emparejador encontraba 30 parejas y la previsualización solo cubría 25. Las 5 que faltaban tenían nombres parecidos pero no iguales, a pocos metros y con la misma web; el caso más claro, «BiciHub» y «Taller Autoreparació Bicihub», a 6 metros.

**Decisión.** La previsualización guarda los registros ya vistos indexados **igual que los preselecciona `findCandidates()`** —celda geográfica de ~1,1 km, o mismo municipio— y los puntúa con el **mismo `scoreMatch()`**. Es lo que hará la ingesta: cuando llega el segundo registro, el primero ya es una entidad.

El índice por celdas evita comparar todos contra todos, que no escalaría a una importación grande.

**Consecuencias.** Las 30 parejas quedan cubiertas (26 registros marcados; un trío de registros son 3 parejas pero solo 2 marcas, porque el primero es el que se crearía). Nada se fusiona ni se elimina automáticamente: la previsualización informa y la importación deja las entidades marcadas para revisión humana.
