# Puesta en marcha

Tres piezas:

| Pieza | Dónde | Coste orientativo |
|---|---|---|
| Base de datos y acceso de usuarios | Supabase (ya creado) | Plan gratuito |
| Aplicación web | Vercel | Plan gratuito (Hobby) |
| Importador (worker) | Railway, u otro servicio que ejecute contenedores | Unos pocos euros al mes |

Las claves **secretas** (la contraseña de la base de datos) se pegan solo en el panel de cada servicio, nunca en el chat ni en el código.

## 1. Cuentas de usuario

La aplicación no tiene registro público: las cuentas las crea un administrador.

1. En Supabase, abre **Authentication → Users → Add user → Create new user**.
2. Escribe el email y una contraseña, y marca **Auto Confirm User**.
3. Pide a Claude que añada ese email al equipo con el rol que corresponda (admin, editor, comercial o lector).
4. Recomendado: en **Authentication → Sign In / Providers**, desactiva que cualquiera pueda registrarse por su cuenta.

## 2. Aplicación web en Vercel

1. En vercel.com: **Add New → Project** e importa el repositorio `Market-Intelligence-`.
2. En **Environment Variables** añade estas dos claves. Son públicas; la seguridad la ponen las políticas de la base de datos.
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://wzpfswvhpbjvwezccfyx.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = la clave «publishable» de Supabase (**Project Settings → API Keys**)
3. Pulsa **Deploy**. Cuando termine, abre la URL que te da Vercel y entra con tu cuenta.

## 3. Importador en Railway

El importador descarga los datos abiertos, los normaliza y los guarda. Atiende las importaciones que se piden desde la pantalla **Importaciones**.

1. En railway.com: **New Project → Deploy from GitHub repo** y elige el repositorio.
2. En **Variables** añade:
   - `RAILWAY_DOCKERFILE_PATH` = `Dockerfile.worker`
   - `CONTACT` = un email o URL de contacto **del proyecto**. Se envía a los servicios públicos para que puedan avisar si hay un problema.
   - `DATABASE_URL` = cadena de conexión de Supabase. Obtenla en **Connect → Session pooler** y sustituye `[YOUR-PASSWORD]` por la contraseña de la base de datos que guardaste al crear el proyecto.
3. Despliega. En los registros (logs) debe aparecer `[worker] … iniciado`.
4. Prueba: en la aplicación, ve a **Importaciones**, elige «Clubes» y el municipio `15078`, y pulsa **Importar**. En menos de un minuto debe aparecer como «Completada».

Si una importación se queda «En cola» más de 3 minutos, la pantalla avisa: casi siempre significa que el importador no está en marcha o que `DATABASE_URL` no es correcta.
