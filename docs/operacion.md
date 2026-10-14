# Operación

## Entornos y acceso

| Entorno | Base | Uso |
| --- | --- | --- |
| Desarrollo | Neon `weathered-bar-44036989` | Trabajo local y datos de desarrollo |
| Producción | Neon `shiny-voice-40524177` | Datos reales; credenciales independientes |
| QA | Rama aislada confirmada expresamente | Fixtures y E2E; nunca producción |

Desarrollo, producción y QA tienen las cuatro migraciones aplicadas. Desarrollo y producción tienen únicamente el catálogo inicial; los fixtures utilizados por E2E están en QA y no se añadieron datos comerciales reales.

Los IDs identifican proyectos; no contienen credenciales. Las URLs de conexión permanecen en archivos ignorados o variables del host. `DATABASE_URL` es pooled; `DIRECT_DATABASE_URL` es directa, sin `-pooler`.

La aplicación autoriza únicamente `ADMIN_GITHUB_ID=60619769` (`ramiro-gp`). Better Auth valida la identidad antes de crear cuenta o sesión y vuelve a verificarla en cada acceso privado. Las sesiones duran siete días, pueden revocarse y no usan una caché de cookies como fuente de autorización.

La OAuth App de desarrollo utiliza homepage `http://localhost:3000` y callback `http://localhost:3000/api/auth/callback/github`. Usar `localhost` de forma consistente: cambiar a `127.0.0.1` durante OAuth cambia el origen y las cookies. Cada host productivo tiene su propia OAuth App y callback `<origen>/api/auth/callback/github`.

Conservar `.env.local` para desarrollo. Un archivo local `.env.production` puede guardar la configuración productiva, incluyendo `NODE_ENV=production`, pero los scripts no lo cargan automáticamente. Para usarlo explícitamente, Node 24 permite:

```powershell
node --env-file=.env.production --import tsx scripts/migrate.ts
```

Las variables preinyectadas tienen precedencia sobre dotenv. No reutilizar secretos, conexiones o sesiones de producción en previews o QA. No registrar DSNs, contraseñas, tokens ni contenido de archivos de entorno en logs.

## Migraciones y catálogo

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Revisar el SQL generado antes de aplicarlo y versionar migraciones y snapshots. Las restricciones de calendario e historial también incluyen SQL personalizado. No ejecutar migraciones dentro de requests ni sustituirlas por `drizzle-kit push` en producción.

El seed normal sólo carga Landing, Institucional, Catálogo, Ecommerce y Otro, sin duplicarlos. `pnpm db:seed --demo` agrega un cliente y sitio ficticios y rechaza producción. Una restauración se hace sobre una base migrada **sin ejecutar el seed**, porque también restaura ese catálogo.

## Backups y restauración

Configurar `BACKUP_PASSWORD` de al menos 16 caracteres en un archivo local ignorado o mediante un gestor de secretos. Conservarla fuera del archivo de respaldo y evitar comandos que la impriman o la dejen literal en el historial de la terminal.

```powershell
pnpm db:backup --out .backups/respaldo.webadmin.enc
pnpm db:restore --file .backups/respaldo.webadmin.enc
```

El backup toma una instantánea consistente de las diez tablas de dominio. Guarda importes como strings y fechas con formato explícito. Cifra el contenido con AES-256-GCM y una clave derivada mediante scrypt, salt e IV aleatorios. No exporta cuentas, sesiones, tokens ni configuración. Un destino existente no se sobrescribe.

La restauración predeterminada descifra y valida formato, versión y tipos; no conecta a ninguna base. Las restricciones relacionales y de dominio se comprueban al aplicar dentro de una transacción.

Para recuperar datos:

1. Preparar una base aislada y vacía; configurar su conexión directa.
2. Aplicar las migraciones, sin ejecutar seed.
3. Validar el archivo con el comando anterior.
4. Aplicar explícitamente:

```powershell
pnpm db:restore --file .backups/respaldo.webadmin.enc --apply
```

`--apply` exige vacías las diez tablas de dominio. Inserta en orden de relaciones y revierte la transacción ante cualquier error. No elimina, trunca ni reemplaza datos existentes. La autenticación del destino se configura por separado y los usuarios ingresan nuevamente.

Para un backup de producción con el archivo de entorno explícito:

```powershell
node --env-file=.env.production --import tsx scripts/backup.ts --out .backups/produccion.webadmin.enc
```

Hacer un backup semanal y antes de migraciones; guardar una copia cifrada fuera del equipo. Probar regularmente una restauración en una base aislada y comprobar cantidades, períodos, pagos y renovaciones. Los tests verifican este roundtrip con PostgreSQL WASM; esa prueba no reemplaza comprobar una copia operativa de producción.

La copia operativa de producción está creada en `.backups/production-2026-10-14-operational.webadmin.enc`; su contraseña aleatoria fuerte está en `.local/backup-password.env`, ambos ignorados por Git. La revisión de la exportación quedó resuelta después de comprobar que producción contenía exclusivamente cinco filas del catálogo público y cero datos comerciales.

Se descifró esa copia real y se restauró exclusivamente en PGlite temporal vacío, con las cuatro migraciones: cinco registros recuperados, tablas idénticas y cero registros de autenticación. No hubo escrituras en producción ni restauración en otro servicio Neon. Repetir la comprobación operativa cuando existan clientes, períodos y pagos reales, usando un destino aislado.

## Verificación

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Vitest cubre calendario, dinero, métricas, política OAuth, auth, acciones, migraciones y backups. PGlite ejecuta PostgreSQL WASM y aplica las migraciones SQL reales en bases temporales, sin necesitar Docker ni credenciales remotas. La CI ejecuta esos cuatro controles con Node 24 y lockfile congelado.

La ejecución final aprobó 68 pruebas en 8 archivos, con salida 0. Lint, tipos y build final pasaron, con todas las rutas privadas dinámicas. Playwright aprobó 3 de 3 pruebas completas sobre Neon QA real. La revisión visual produjo 12 capturas en anchos de 390 px y 1440 px. Estos resultados verifican la implementación y QA; no confirman que el primer despliegue productivo haya finalizado.

Playwright utiliza `http://localhost:3001`, una rama QA confirmada y `.local/e2e-storage.json`. El runner de fixtures mantiene intacta la autenticación de la aplicación: recorre Better Auth con respuestas del proveedor controladas y obtiene una sesión válida para una identidad exclusiva de QA. No incorpora un bypass de login al producto.

Para preparar QA, crear localmente `.local/qa-env.json` con estas claves, sin versionarlo:

```json
{
  "QA_DATABASE_URL": "<conexion-de-la-rama-QA>",
  "BETTER_AUTH_SECRET": "<secreto-QA-de-al-menos-32-caracteres>",
  "qaProjectId": "<proyecto-QA>",
  "qaBranchId": "<br-rama-QA>",
  "qaEndpointHost": "<ep-endpoint-QA.neon.tech>",
  "purpose": "web-admin-e2e"
}
```

Confirmar rama y hostname contra el destino aislado real y preparar la sesión:

```powershell
$env:NODE_ENV = "test"
pnpm exec tsx scripts/qa-session.ts --confirm-qa-branch <br-rama-QA> --confirm-qa-host <ep-endpoint-QA.neon.tech>
```

Iniciar un proceso separado de la aplicación en el puerto 3001 con `NODE_ENV=development`, `DATABASE_URL` y `BETTER_AUTH_SECRET` de ese archivo, `BETTER_AUTH_URL=http://localhost:3001`, `ADMIN_GITHUB_ID=123`, `GITHUB_CLIENT_ID=qa-fixture-client` y `GITHUB_CLIENT_SECRET=qa-fixture-secret`. Son valores exclusivos del proceso QA; no reemplazan `.env.local`. Ejecutar allí `pnpm exec next dev --hostname 127.0.0.1 --port 3001` y, desde otra terminal, `pnpm test:e2e`.

Los archivos `.local/`, reportes y trazas están ignorados. La sesión exportada es sensible: no compartirla y retirarla cuando termine QA. El runner rechaza producción y no procede si la rama y el hostname no coinciden con los confirmados.

## Producción en Vercel

El proyecto Vercel `prj_FeiQwRwK7oFmMwMUZPCVbORzeJQG` tiene autorizadas y configuradas las variables productivas `DATABASE_URL`, `DIRECT_DATABASE_URL`, `BETTER_AUTH_SECRET`, `ADMIN_GITHUB_ID` y `BETTER_AUTH_URL`. El primer despliegue `dpl_DNr7ebm5yCZaD5BzjDYySZaddc7W` está confirmado `READY`.

El origen principal es [web-admin en Vercel](https://web-admin-ramiroariel-carp-hotmailcoms-projects.vercel.app), con alias adicional [web-admin-phi-two](https://web-admin-phi-two.vercel.app). Usar el principal durante login y OAuth. El navegador solicita acceso SSO de Vercel antes de llegar a la aplicación, por lo que el login productivo todavía no fue comprobado. La inspección automatizada de logs y acceso protegido devolvió 403 por alcance del conector y no hay CLI disponible; eso no demuestra un fallo de la aplicación. La comprobación final será manual una vez configurado OAuth.

La OAuth App productiva, independiente de desarrollo, debe tener:

- Homepage: `https://web-admin-ramiroariel-carp-hotmailcoms-projects.vercel.app`.
- Callback: `https://web-admin-ramiroariel-carp-hotmailcoms-projects.vercel.app/api/auth/callback/github`.

Guardar localmente las nuevas claves `GITHUB_CLIENT_ID` y `GITHUB_CLIENT_SECRET` en `.local/github-production.env`, sin imprimirlas ni versionarlas. La OAuth App de desarrollo ya está configurada en `.env.local` y debe conservarse. H9 permanece pendiente de completar esa configuración productiva y verificar despliegue y login.

Antes de habilitar datos reales:

1. Configurar la segunda OAuth App y sus variables en Production; generar un nuevo despliegue si las variables cambian después de construirlo.
2. Comprobar acceso a través de la protección de Vercel y verificar el despliegue que incluya OAuth; el primero ya está `READY`.
3. Verificar las cuatro migraciones y el catálogo ya aplicados; futuras migraciones se ejecutan de forma controlada.
4. Comprobar login autorizado, rechazo de otra identidad y flujo de cobro en el host productivo.
5. Conservar la copia operativa del catálogo ya comprobada y repetir la recuperación aislada cuando existan datos comerciales reales.

Las previews deben disponer de una base y OAuth propios o permanecer sin configurar. Un build correcto no confirma que las credenciales productivas, OAuth o el despliegue estén operativos. Ante errores de configuración, revisar nombres de variables y callbacks sin exponer sus valores.
