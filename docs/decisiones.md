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
