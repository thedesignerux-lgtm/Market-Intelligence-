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

Comprobación:

```sql
-- Como previsualizador. Debe responder: ERROR: permission denied for table admin_areas
insert into public.admin_areas (code, level, name) values ('99999','municipio','Prueba');
```

### Por qué hace falta `bypassrls`

Todas las tablas tienen RLS y sus políticas se escribieron para el rol `authenticated` de Supabase. Un rol nuevo no las cumple, así que **las consultas no fallan: devuelven cero filas**. La previsualización saldría con 0 registros y parecería correcta.

Es el fallo más peligroso de este montaje, porque es silencioso. `bypassrls` lo resuelve sin conceder ninguna escritura.

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

## Limitación conocida: la previsualización cuenta de menos los duplicados

Los duplicados **dentro del mismo lote** se detectan por nombre idéntico y mismo municipio, porque las entidades aún no existen y `findCandidates()` no puede verlas.

La importación real es más estricta: cuando llega el segundo registro, el primero ya existe como entidad, así que `scoreMatch()` lo encuentra también por cercanía y nombre parecido.

Medido sobre Madrid y Barcelona: **la previsualización marca 22 registros; el emparejador completo encuentra 30 parejas.** Las 5 parejas que se escapan son nombres parecidos pero no idénticos a pocos metros.

**El número de duplicados de la previsualización es un suelo, no la cifra final.** Para dimensionar la revisión manual, usa el listado completo de parejas.
