# Roadmap y aceptación

El H0 revisado establece una herramienta personal de cobranza manual. H1–H8 están implementados y verificados. H9 tiene QA aprobado, credenciales productivas configuradas, el primer despliegue Vercel `READY` y una copia operativa verificada del catálogo productivo. Falta configurar OAuth productivo y comprobar manualmente el acceso completo.

| Hito | Entrega | Criterio de aceptación |
| --- | --- | --- |
| H1 — Base técnica | Next.js, TypeScript estricto, Tailwind, pnpm, entorno, lint, pruebas y CI | Instalación reproducible, tipos, lint y build correctos; secretos fuera de Git |
| H2 — Persistencia | Drizzle, schema, cuatro migraciones, restricciones y catálogo | Base vacía reconstruible; precisión monetaria y relaciones verificadas |
| H3 — Auth privada | GitHub y Better Auth para un ID autorizado | Otra identidad no crea sesión; lecturas y acciones sin autorización rechazadas |
| H4 — Clientes y sitios | Shell oscuro, formularios, archivo, tipos y venta original | Gestionar varios sitios por cliente desde desktop y mobile |
| H5 — Planes y dominios | Frecuencias, ancla, corte, versiones de precio, dominios y renovaciones | Historial conservado; calendario y vencimiento real independientes |
| H6 — Cobranzas | Períodos, pago completo, vencidos, ajustes e importación histórica | Sin duplicados ni deriva; descuentos explícitos y caja por fecha real |
| H7 — Trabajos | Pedidos, estado, precio, gratuitos, finalización y pago | La venta original permanece independiente; operación y cobro no se confunden |
| H8 — Dashboard | Deuda, caja, vencimientos, dominios, últimos pagos y precios antiguos | Totales con las tres fuentes de cobro y monedas separadas |
| H9 — QA y producción | QA aprobado; secretos configurados; despliegue `READY`; backup del catálogo restaurado localmente | Configurar OAuth productivo y comprobar login y flujo productivo |

## Evidencia final de verificación local y QA

- La ejecución final de Vitest aprobó **68 pruebas en 8 archivos**, con código de salida 0. Incluye dominio, auth, acciones, migraciones y backups.
- Lint, tipos y build final pasaron; todas las rutas privadas quedaron dinámicas.
- Playwright aprobó **3 de 3 pruebas** con una rama QA real de Neon, aislada de desarrollo y producción.
- La verificación visual registró **12 capturas**, en mobile de 390 px y desktop de 1440 px.
- Desarrollo, producción y QA tienen las **4 migraciones aplicadas**. Desarrollo y producción tienen solamente el catálogo inicial; los fixtures permanecen en QA y no se agregaron datos comerciales reales.
- Proyecto Vercel: `prj_FeiQwRwK7oFmMwMUZPCVbORzeJQG`. Primer despliegue: `dpl_DNr7ebm5yCZaD5BzjDYySZaddc7W`, confirmado en estado `READY`.
- Backup operativo de producción creado mediante lectura: **5 filas del catálogo**, sin datos comerciales. Restaurado en PGlite temporal con 4 migraciones, tablas idénticas y 0 registros de autenticación; no hubo escrituras en producción.

La autorización para enviar los secretos productivos a Vercel está resuelta y la configuración fue realizada. El origen principal es [web-admin en Vercel](https://web-admin-ramiroariel-carp-hotmailcoms-projects.vercel.app), con alias adicional [web-admin-phi-two](https://web-admin-phi-two.vercel.app). El login productivo todavía no está verificado: la protección de Vercel solicita su propio acceso y falta la segunda OAuth App. Sus credenciales se entregan mediante el archivo local ignorado `.local/github-production.env`, conservando la app de desarrollo.

La revisión de la exportación está resuelta. El archivo cifrado operativo está en `.backups/production-2026-10-14-operational.webadmin.enc`, con contraseña en el archivo local ignorado `.local/backup-password.env`. La restauración comprobada fue local en PostgreSQL WASM, no en otro servicio Neon. Repetir la prueba cuando existan datos comerciales reales.
