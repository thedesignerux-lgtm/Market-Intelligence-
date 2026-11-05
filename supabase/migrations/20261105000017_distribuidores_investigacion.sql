-- Fuente y categorías para la investigación de distribuidores, mayoristas, fabricantes y marcas.
-- Cambios aditivos: no modifica ni borra datos existentes. NO APLICADA TODAVÍA.

-- 1. Fuente propia. Es investigación en páginas públicas, como investigacion_comunidades:
--    confianza por defecto 0,70 porque un directorio sectorial no es un registro oficial.
insert into public.sources (id, name, kind, license, attribution, default_confidence)
values ('investigacion_distribuidores',
        'Investigación de distribuidores (directorios sectoriales y webs de empresa)',
        'web',
        'Datos públicos consultados; sin licencia de reutilización',
        'AMBE (Asociación de Marcas y Bicicletas de España), directorio bicicleta.es y webs de las propias empresas',
        0.70)
on conflict (id) do nothing;

-- 2. Subtipos de distribuidor. El tipo de entidad «distribuidor» ya existe: lo que falta es
--    distinguir mayorista, fabricante, marca y central de compras, que negocian de forma distinta.
insert into public.categories (id, name, parent_id, entity_type, sort) values
  ('distribuidor.ciclismo.mayorista',        'Mayorista de ciclismo',        'distribuidor.ciclismo', 'distribuidor', 60),
  ('distribuidor.ciclismo.fabricante',       'Fabricante de ciclismo',       'distribuidor.ciclismo', 'distribuidor', 61),
  ('distribuidor.ciclismo.marca',            'Marca de ciclismo',            'distribuidor.ciclismo', 'distribuidor', 62),
  ('distribuidor.ciclismo.central_compras',  'Central de compras',           'distribuidor.ciclismo', 'distribuidor', 63)
on conflict (id) do nothing;

-- 3. Campos propios de un distribuidor, con la misma trazabilidad que el resto:
--    cada valor guarda fuente, método (found/verified/inferred/manual), confianza y fecha.
--    Por eso no hace falta una tabla nueva: field_values ya da «fuente» y «fecha de verificación».
alter table public.field_values drop constraint field_values_field_check;
alter table public.field_values add constraint field_values_field_check
  check (field = any (array['name', 'address', 'postal_code', 'location', 'municipality_code',
                            'phone', 'website', 'email', 'opening_hours',
                            -- distribuidores
                            'catalogo', 'portal_b2b', 'especializacion', 'cobertura', 'afiliacion']));
