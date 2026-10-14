import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) throw new Error("Configurá DIRECT_DATABASE_URL para ejecutar migraciones.");
  if (new URL(connectionString).hostname.includes("-pooler")) {
    throw new Error("Las migraciones requieren la conexión directa de Neon, sin -pooler.");
  }
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("Migraciones aplicadas correctamente.");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error("No se pudieron aplicar las migraciones. Revisá la conexión directa y las migraciones SQL.");
  process.exitCode = 1;
});
