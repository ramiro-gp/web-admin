import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { clients, siteTypes, websites } from "../src/db/schema";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const demo = process.argv.includes("--demo");
  if (demo && (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production")) {
    throw new Error("Los datos ficticios están prohibidos en producción.");
  }
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) throw new Error("Configurá DIRECT_DATABASE_URL para cargar el catálogo inicial.");
  if (new URL(connectionString).hostname.includes("-pooler")) throw new Error("Usá la conexión directa, sin -pooler.");
  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(siteTypes).values(["Landing", "Institucional", "Catálogo", "Ecommerce", "Otro"].map((name) => ({ name }))).onConflictDoNothing();
      if (!demo) return;
      const clientId = "00000000-0000-4000-8000-000000000001";
      await tx.insert(clients).values({ id: clientId, contactName: "Ana Ejemplo", companyName: "Estudio Demo", email: "ana@example.com", notes: "Datos ficticios de desarrollo" }).onConflictDoNothing();
      const [type] = await tx.select({ id: siteTypes.id }).from(siteTypes).where(eq(siteTypes.name, "Institucional"));
      if (!type) throw new Error("Falta el tipo de sitio inicial.");
      await tx.insert(websites).values({
        id: "00000000-0000-4000-8000-000000000002", clientId, siteTypeId: type.id,
        name: "Estudio Demo", url: "https://example.com", soldOn: "2026-10-01",
        salePriceMinor: 30000000n, currency: "ARS", salePaymentTracked: false,
        description: "Sitio ficticio para explorar la interfaz",
      }).onConflictDoNothing();
    });
    console.log(demo ? "Catálogo y datos ficticios cargados." : "Catálogo de tipos de sitio cargado.");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("No se pudo cargar el catálogo. Revisá DIRECT_DATABASE_URL y ejecutá las migraciones primero.");
  process.exitCode = 1;
});
