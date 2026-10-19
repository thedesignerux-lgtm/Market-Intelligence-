# Puesta en marcha

Tres piezas:

| Pieza | Dónde | Coste orientativo |
|---|---|---|
| Base de datos y acceso de usuarios | Supabase (ya creado) | Plan gratuito |
| Aplicación web | Vercel | Plan gratuito (Hobby) |
| Importador (worker) | GitHub Actions (repositorio público) | Gratis |

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

## 3. Importador en GitHub Actions

El importador descarga los datos abiertos, los normaliza y los guarda. Se ejecuta en GitHub Actions (`.github/workflows/importador.yml`), sin servidor propio:

- **Cada noche** actualiza toda Galicia y procesa las importaciones pendientes.
- **Al pedir una importación** desde la pantalla **Importaciones**, la web lo lanza en el momento (si tiene el token del paso 2).
- **A mano**: GitHub → pestaña **Actions** → «Importador» → **Run workflow**.

### Paso 1 · Conexión con la base de datos (obligatorio)

1. En Supabase pulsa **Connect**, elige **Session pooler** y copia la cadena. Sustituye `[YOUR-PASSWORD]` por la contraseña de la base de datos.
2. En GitHub, en el repositorio: **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `DATABASE_URL`
   - Secret: la cadena del punto 1. Pégala solo ahí, nunca en el chat.
3. Prueba: pestaña **Actions** → «Importador» → **Run workflow**. En unos minutos debe terminar en verde.

### Paso 2 · Arranque inmediato desde la web (opcional)

Sin este paso, lo que pidas en **Importaciones** se procesa en la ejecución nocturna.

1. En GitHub: foto de perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Repository access: **Only select repositories** → `Market-Intelligence-`.
   - Permissions → Repository permissions → **Actions: Read and write**. Nada más.
   - Caducidad: la que prefieras (al caducar, vuelve a crear uno).
2. En Vercel, proyecto **market-intelligence** → **Settings → Environment Variables** → añade `GITHUB_DISPATCH_TOKEN` (tipo **Secret**) con ese token, en Production.
3. **Deployments → Redeploy** para que la web lo use.

La conexión con Supabase va cifrada (TLS). Para verificar además el certificado del servidor, añade el certificado de Supabase (**Project Settings → Database → SSL Configuration**) como secreto `DATABASE_CA_CERT` y pásalo en el workflow.

Alternativa: `Dockerfile.worker` permite ejecutar el importador como proceso continuo en cualquier servicio de contenedores.
