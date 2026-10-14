# web-admin

Herramienta privada para administrar clientes, sitios web, planes, dominios, trabajos adicionales y cobranzas manuales. Pensada para un único administrador y una cartera pequeña.

La V1 guarda un pago completo por período de un plan. Conserva precios, períodos y planes anteriores sin introducir cargos, aplicaciones contables ni saldos reutilizables.

## Estado

H1–H8 están implementados y verificados: 68 pruebas aprobadas, lint, tipos, build y E2E correctos. El primer despliegue en Vercel está `READY` y las credenciales productivas están configuradas. H9 sigue pendiente de OAuth productivo y de comprobar el acceso completo a la aplicación. Usar el origen principal [web-admin en Vercel](https://web-admin-ramiroariel-carp-hotmailcoms-projects.vercel.app); la protección de Vercel solicita su propio acceso antes de la aplicación. La configuración de desarrollo permanece local y no se versiona.

## Stack

Next.js con App Router, React, TypeScript estricto, Tailwind exclusivamente oscuro y Lucide. PostgreSQL en Neon, Drizzle con `pg`, Better Auth con GitHub y Zod en las entradas del servidor. Node.js 24, pnpm 11.8.0 y TypeScript 6.0.3, fijado por compatibilidad con el linter.

Server Components para lecturas; Server Actions autenticadas para operaciones. El dashboard y cobranzas sincronizan períodos mediante POST, sin escrituras en GET ni dependencia de un cron.

## Desarrollo

1. Usar Node.js 24 y pnpm 11.8.0.
2. Ejecutar `pnpm install --frozen-lockfile`.
3. Copiar `.env.example` a `.env.local` sólo si ese archivo todavía no existe y completar sus valores. Conservar la configuración local existente.
4. Configurar la OAuth App de GitHub para `http://localhost:3000`, con callback `http://localhost:3000/api/auth/callback/github`.
5. Ejecutar `pnpm db:migrate` y `pnpm db:seed` contra desarrollo.
6. Ejecutar `pnpm dev` y abrir [localhost:3000](http://localhost:3000) usando ese mismo host durante todo el login.

El único administrador es `ramiro-gp`, identificado por `ADMIN_GITHUB_ID=60619769`. La autorización compara el ID numérico de GitHub; nombre de usuario y email no conceden acceso.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión pooled de Neon para la aplicación |
| `DIRECT_DATABASE_URL` | Conexión directa para migraciones, seed y backups |
| `BETTER_AUTH_URL` | Origen exacto de la aplicación |
| `BETTER_AUTH_SECRET` | Secreto independiente por entorno, de al menos 32 caracteres |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth App del entorno |
| `ADMIN_GITHUB_ID` | ID numérico del administrador autorizado |
| `BACKUP_PASSWORD` | Contraseña local de al menos 16 caracteres para backups cifrados |

Neon de desarrollo: `weathered-bar-44036989`. Neon de producción: `shiny-voice-40524177`. Sus conexiones y credenciales deben mantenerse separadas; las previews nunca utilizan producción.

## Comandos

| Comando | Función |
| --- | --- |
| `pnpm dev` | Desarrollo local |
| `pnpm build` / `pnpm start` | Build y servidor de producción local |
| `pnpm lint` / `pnpm typecheck` | Estilo y tipos |
| `pnpm test` | Pruebas de dominio, seguridad, acciones y PostgreSQL WASM |
| `pnpm test:e2e` | Playwright sobre QA preparado en localhost:3001 |
| `pnpm db:generate` | Generar migraciones a revisar y versionar |
| `pnpm db:migrate` | Aplicar migraciones usando conexión directa |
| `pnpm db:seed` | Cargar solamente el catálogo inicial de tipos de sitio |
| `pnpm db:seed --demo` | Agregar un cliente y sitio ficticios; prohibido en producción |
| `pnpm db:backup --out .backups/respaldo.webadmin.enc` | Exportar dominio con cifrado |
| `pnpm db:restore --file .backups/respaldo.webadmin.enc` | Descifrar y validar formato sin conectar a una base |

La CI ejecuta instalación con lockfile, lint, tipos, pruebas y build. E2E requiere una rama QA aislada y una sesión local preparada; no se ejecuta automáticamente contra producción.

## Documentación

- [Modelo y reglas de negocio](docs/modelo.md)
- [Operación, backups, QA y producción](docs/operacion.md)
- [Hitos y criterios de aceptación](docs/roadmap.md)

V1 excluye pagos parciales, anticipos sobre períodos futuros, reembolsos, facturación fiscal, gastos, conversión de monedas, prorrateos y notificaciones externas.
