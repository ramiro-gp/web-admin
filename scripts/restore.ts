import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { BackupError, backupRowCount, decryptBackup, requireBackupPassword } from "../src/lib/backup-codec";
import { insertDomainBackup } from "./restore-data";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log("pnpm db:restore --file .backups/respaldo.webadmin.enc [--apply]\nPor defecto sólo descifra y valida el archivo, sin conectar a la base."); return; }
  const apply = args.includes("--apply");
  const fileArgs = args.filter((arg) => arg !== "--apply");
  if (fileArgs.length !== 2 || fileArgs[0] !== "--file" || !fileArgs[1] || args.filter((arg) => arg === "--apply").length > 1) {
    throw new BackupError("Uso: pnpm db:restore --file archivo [--apply]");
  }
  const password = requireBackupPassword(process.env.BACKUP_PASSWORD);
  const contents = await readFile(resolve(fileArgs[1]), "utf8");
  const payload = decryptBackup(contents, password);
  if (!apply) {
    console.log(`Respaldo descifrado y formato validado: ${backupRowCount(payload)} registros, versión ${payload.version}.\nNo se conectó ni modificó ninguna base. --apply requiere las tablas de dominio vacías y migradas.`);
    return;
  }
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) throw new BackupError("Configurá DIRECT_DATABASE_URL de la base vacía de destino.");
  if (new URL(connectionString).hostname.includes("-pooler")) throw new BackupError("Usá la conexión directa de Neon, sin -pooler.");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const restored = await drizzle(pool).transaction((tx) => insertDomainBackup(tx, payload));
    console.log(`Restauración completada: ${restored} registros. Las cuentas y sesiones de autenticación no se restauran.`);
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof BackupError ? error.message : "No se pudo restaurar. Revisá el archivo y la conexión a una base vacía con las migraciones aplicadas. La operación es transaccional.");
  process.exitCode = 1;
});
