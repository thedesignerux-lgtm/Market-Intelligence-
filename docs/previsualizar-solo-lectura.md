# Ejecutar la previsualización en modo solo lectura

Cómo lanzar `previsualizar` contra una base real sin poder escribir en ella, ni siquiera por error.

## 1. Un rol que no puede escribir

Ejecuta esto **una vez**, como propietario de la base (en el editor SQL de Supabase o con `psql`). Es la única sentencia de escritura de todo el procedimiento, y no toca ningún dato: solo crea un rol.

```sql
create role previsualizador login password 'ELIGE-UNA-CONTRASEÑA';

grant connect on database postgres to previsualizador;
grant usage on schema public, extensions to previsualizador;
grant select on all tables in schema public to previsualizador;
grant execute on all functions in schema extensions to previsualizador;
alter default privileges in schema public grant select on tables to previsualizador;

-- Imprescindible: sin esto el rol lee CERO filas y la previsualización sale vacía
-- sin dar ningún error. Ver la nota de abajo.
alter role previsualizador bypassrls;
```

No se concede `insert`, `update`, `delete` ni `truncate`. **PostgreSQL rechaza cualquier escritura**, así que la garantía no depende del código: la impone el motor.

Comprobación de permisos efectivos:

```sql
select privilege_type, count(*) as tablas
  from information_schema.table_privileges
 where grantee = 'previsualizador' and table_schema = 'public'
 group by 1;
-- Debe salir SELECT y nada más.

select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
  from pg_roles where rolname = 'previsualizador';
-- Solo rolbypassrls debe ser true.
```

Verificado sobre una base local construida desde estas migraciones: el rol tiene `SELECT` sobre 32 tablas y ningún otro permiso. Estas ocho operaciones se rechazan:

| Operación | Respuesta |
|---|---|
| `insert into public.entities …` | permission denied for table entities |
| `update public.entities …` | permission denied for table entities |
| `delete from public.entities` | permission denied for table entities |
| `truncate public.entities` | permission denied for table entities |
| `create table public.prueba (…)` | permission denied for schema public |
| `alter table public.entities add column …` | must be owner of table entities |
| `drop table public.entity_notes` | must be owner of table entity_notes |
| `create index on public.entities (…)` | must be owner of table entities |

### Por qué hace falta `bypassrls`

Todas las tablas de `public` tienen RLS activa y sus políticas se escribieron para el rol `authenticated` de Supabase: comprueban `has_role_anywhere(...)`, que consulta `memberships`. Un rol nuevo no es miembro de ningún espacio de trabajo, así que **ninguna política se cumple**.

Cuando RLS no deja pasar una fila, PostgreSQL **no da error**: la omite. Un `select count(*) from category_mappings` devuelve `0` en lugar de `12`, y la previsualización termina con 0 candidatos y aspecto de haber funcionado.

Es el fallo más peligroso de este montaje porque es silencioso: no hay nada que revisar en los registros.

`bypassrls` es un **atributo del rol**, no un permiso sobre tablas. Permite ver todas las filas y **no concede ninguna escritura**: el rol sigue sin `insert`, `update`, `delete` ni `truncate`.

Alternativa si no quieres `bypassrls`: dar de alta al rol en `memberships` con papel `lector`. Es más fino, pero requiere escribir una fila de datos, que es justo lo que se intenta evitar.

### La herramienta se para sola

`previsualizar` comprueba antes de empezar que puede leer lo que espera, y **se detiene** si no puede garantizarlo:

```
El rol «previsualizador» no puede ver todas las filas: RLS está activa en
category_mappings, contact_points, entities, entity_sources, source_records
y este rol no la elude.
Las consultas no fallarían: devolverían cero filas y el informe saldría vacío
pareciendo correcto.
Solución: alter role previsualizador bypassrls;  (no concede ninguna escritura)
```

Comprueba dos cosas: que ninguna tabla imprescindible esté filtrando filas para el rol actual, y que se vea al menos una regla de categorías de `osm`. Sin reglas no puede salir ningún candidato, así que un `0` ahí nunca es un resultado legítimo.

## 2. Ejecutar

```bash
export CONTACT="tu-email-o-url-de-contacto"
export DATABASE_URL="postgresql://previsualizador:LA-CONTRASEÑA@HOST:5432/postgres"

npm run previsualizar -- osm 28 08 --json > previsualizacion.json
```

La contraseña va en una variable de entorno de tu terminal. **No hace falta escribirla en ningún fichero del repositorio ni compartirla.**

### El ámbito se indica por código de provincia

`osm madrid barcelona` **no funciona**: «madrid» es una comunidad autónoma y «barcelona» es una provincia, y `provincesForScope()` solo entiende `espana`, el slug de una comunidad o un código de provincia de dos dígitos.

| Lo que quieres | Escribe |
|---|---|
| Madrid y Barcelona | `osm 28 08` |
| Solo la capital | `osm 28079` |
| Toda Cataluña (4 provincias) | `osm cataluna` |

## 3. Comprobar que no ha escrito nada

```sql
-- Antes de ejecutar
select pg_stat_reset();

-- Después
select sum(n_tup_ins) as insertadas, sum(n_tup_upd) as actualizadas, sum(n_tup_del) as borradas
  from pg_stat_user_tables;
```

Las tres deben salir en cero. Es una medición del servidor, independiente de lo que diga el código.

## 4. Qué devuelve

JSON con `total`, `nuevas`, `existentes`, `duplicados`, `descartadas` y `contactos`. Cada fila lleva su `externalId` de OSM, el nombre, el motivo en lenguaje llano y los canales de contacto.

Siempre se cumple:

```
nuevas + existentes + duplicados + descartadas = total
```

## Duplicados dentro del mismo lote

Dos registros de la misma importación que son el mismo negocio no se pueden comparar con `findCandidates()`, porque ninguna de las dos entidades existe aún.

La previsualización simula lo que hará la ingesta: guarda los registros ya vistos indexados **igual que los preselecciona `findCandidates()`** (celda geográfica de ~1,1 km, o mismo municipio) y los puntúa con el **mismo `scoreMatch()`**. En la importación real ocurre lo mismo: cuando llega el segundo registro, el primero ya es una entidad, el emparejador lo encuentra y, al venir ambos de la misma fuente, acaban en revisión en vez de fusionarse.

Medido sobre Madrid y Barcelona: el emparejador completo encuentra **30 parejas** y la previsualización marca **26 registros**, cubriendo **las 30**. La diferencia entre 30 y 26 no es un hueco: cuando tres registros son el mismo negocio forman 3 parejas pero solo 2 se marcan, porque el primero es el que se crearía.

> Una versión anterior comparaba solo por nombre idéntico y mismo municipio, y se dejaba 5 parejas con nombres parecidos pero no iguales (por ejemplo «BiciHub» y «Taller Autoreparació Bicihub», a 6 m y con la misma web). Hay pruebas que cubren ese caso.

**Nada se fusiona ni se elimina automáticamente.** La previsualización solo informa; la importación crea ambas entidades y las deja marcadas para que una persona decida.
