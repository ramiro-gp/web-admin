import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { BackupError, backupRowCount, encryptBackup, requireBackupPassword } from "../src/lib/backup-codec";
import { readDomainBackup } from "./backup-data";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log("pnpm db:backup [--out .backups/respaldo.webadmin.enc]"); return; }
  if (args.length && (args.length !== 2 || args[0] !== "--out" || !args[1])) throw new BackupError("Uso: pnpm db:backup [--out archivo]");
  const password = requireBackupPassword(process.env.BACKUP_PASSWORD);
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) throw new BackupError("Configurá DIRECT_DATABASE_URL para crear el respaldo.");
  if (new URL(connectionString).hostname.includes("-pooler")) throw new BackupError("Usá la conexión directa de Neon, sin -pooler.");
  const out = resolve(args[1] || `.backups/web-admin-${new Date().toISOString().replace(/[:.]/g, "-")}.webadmin.enc`);
  const pool = new Pool({ connectionString, max: 1 });
  try {
    // Repeatable read gives a consistent snapshot across all ten tables.
    const payload = await drizzle(pool).transaction((tx) => readDomainBackup(tx), { isolationLevel: "repeatable read", accessMode: "read only" });
    const encrypted = encryptBackup(payload, password);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, encrypted, { encoding: "utf8", flag: "wx", mode: 0o600 });
    console.log(`Respaldo cifrado creado: ${out}\n${backupRowCount(payload)} registros de dominio. No incluye credenciales ni sesiones.`);
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof BackupError ? error.message : "No se pudo crear el respaldo. Revisá la conexión, la ruta y que el archivo no exista.");
  process.exitCode = 1;
});
