-- Cobertura nacional: las 19 comunidades/ciudades autónomas y las 52 provincias (códigos INE).
-- Los municipios y sus límites los carga el importador desde OpenStreetMap la primera vez que importa una provincia.
insert into public.admin_areas (code, level, name, parent_code) values
  ('ca01', 'ccaa', 'Andalucía', null),
  ('ca02', 'ccaa', 'Aragón', null),
  ('ca03', 'ccaa', 'Principado de Asturias', null),
  ('ca04', 'ccaa', 'Illes Balears', null),
  ('ca05', 'ccaa', 'Canarias', null),
  ('ca06', 'ccaa', 'Cantabria', null),
  ('ca07', 'ccaa', 'Castilla y León', null),
  ('ca08', 'ccaa', 'Castilla-La Mancha', null),
  ('ca09', 'ccaa', 'Cataluña', null),
  ('ca10', 'ccaa', 'Comunitat Valenciana', null),
  ('ca11', 'ccaa', 'Extremadura', null),
  ('ca12', 'ccaa', 'Galicia', null),
  ('ca13', 'ccaa', 'Comunidad de Madrid', null),
  ('ca14', 'ccaa', 'Región de Murcia', null),
  ('ca15', 'ccaa', 'Comunidad Foral de Navarra', null),
  ('ca16', 'ccaa', 'País Vasco', null),
  ('ca17', 'ccaa', 'La Rioja', null),
  ('ca18', 'ccaa', 'Ceuta', null),
  ('ca19', 'ccaa', 'Melilla', null)
on conflict (code) do nothing;

insert into public.admin_areas (code, level, name, parent_code) values
  ('01', 'provincia', 'Araba/Álava', 'ca16'),
  ('02', 'provincia', 'Albacete', 'ca08'),
  ('03', 'provincia', 'Alicante/Alacant', 'ca10'),
  ('04', 'provincia', 'Almería', 'ca01'),
  ('05', 'provincia', 'Ávila', 'ca07'),
  ('06', 'provincia', 'Badajoz', 'ca11'),
  ('07', 'provincia', 'Illes Balears', 'ca04'),
  ('08', 'provincia', 'Barcelona', 'ca09'),
  ('09', 'provincia', 'Burgos', 'ca07'),
  ('10', 'provincia', 'Cáceres', 'ca11'),
  ('11', 'provincia', 'Cádiz', 'ca01'),
  ('12', 'provincia', 'Castellón/Castelló', 'ca10'),
  ('13', 'provincia', 'Ciudad Real', 'ca08'),
  ('14', 'provincia', 'Córdoba', 'ca01'),
  ('15', 'provincia', 'A Coruña', 'ca12'),
  ('16', 'provincia', 'Cuenca', 'ca08'),
  ('17', 'provincia', 'Girona', 'ca09'),
  ('18', 'provincia', 'Granada', 'ca01'),
  ('19', 'provincia', 'Guadalajara', 'ca08'),
  ('20', 'provincia', 'Gipuzkoa', 'ca16'),
  ('21', 'provincia', 'Huelva', 'ca01'),
  ('22', 'provincia', 'Huesca', 'ca02'),
  ('23', 'provincia', 'Jaén', 'ca01'),
  ('24', 'provincia', 'León', 'ca07'),
  ('25', 'provincia', 'Lleida', 'ca09'),
  ('26', 'provincia', 'La Rioja', 'ca17'),
  ('27', 'provincia', 'Lugo', 'ca12'),
  ('28', 'provincia', 'Madrid', 'ca13'),
  ('29', 'provincia', 'Málaga', 'ca01'),
  ('30', 'provincia', 'Murcia', 'ca14'),
  ('31', 'provincia', 'Navarra', 'ca15'),
  ('32', 'provincia', 'Ourense', 'ca12'),
  ('33', 'provincia', 'Asturias', 'ca03'),
  ('34', 'provincia', 'Palencia', 'ca07'),
  ('35', 'provincia', 'Las Palmas', 'ca05'),
  ('36', 'provincia', 'Pontevedra', 'ca12'),
  ('37', 'provincia', 'Salamanca', 'ca07'),
  ('38', 'provincia', 'Santa Cruz de Tenerife', 'ca05'),
  ('39', 'provincia', 'Cantabria', 'ca06'),
  ('40', 'provincia', 'Segovia', 'ca07'),
  ('41', 'provincia', 'Sevilla', 'ca01'),
  ('42', 'provincia', 'Soria', 'ca07'),
  ('43', 'provincia', 'Tarragona', 'ca09'),
  ('44', 'provincia', 'Teruel', 'ca02'),
  ('45', 'provincia', 'Toledo', 'ca08'),
  ('46', 'provincia', 'Valencia/València', 'ca10'),
  ('47', 'provincia', 'Valladolid', 'ca07'),
  ('48', 'provincia', 'Bizkaia', 'ca16'),
  ('49', 'provincia', 'Zamora', 'ca07'),
  ('50', 'provincia', 'Zaragoza', 'ca02'),
  ('51', 'provincia', 'Ceuta', 'ca18'),
  ('52', 'provincia', 'Melilla', 'ca19')
on conflict (code) do nothing;

-- Distribuidores mayoristas de bicicletas (en OSM: shop=wholesale + wholesale=bicycle).
insert into public.categories (id, name, parent_id, entity_type, sort) values
  ('distribuidor.ciclismo', 'Distribuidor de bicicletas', null, 'distribuidor', 100)
on conflict (id) do nothing;

insert into public.category_mappings (source_id, match, category_id, entity_type, priority)
select 'osm', '{"shop": "wholesale", "wholesale": "bicycle"}'::jsonb, 'distribuidor.ciclismo', 'distribuidor', 100
where not exists (
  select 1 from public.category_mappings
   where source_id = 'osm' and match = '{"shop": "wholesale", "wholesale": "bicycle"}'::jsonb
);
