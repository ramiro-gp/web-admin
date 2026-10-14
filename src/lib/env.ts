import "server-only";
import { z } from "zod";

const runtimeSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_URL: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  }, "La URL debe usar HTTPS salvo en localhost."),
  BETTER_AUTH_SECRET: z.string().min(32),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  ADMIN_GITHUB_ID: z.string().regex(/^[1-9]\d*$/),
});

export function configurationStatus() {
  const parsed = runtimeSchema.safeParse(process.env);
  return {
    configured: parsed.success,
    missing: parsed.success ? [] : [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))],
  };
}

export function getRuntimeEnv() {
  const parsed = runtimeSchema.safeParse(process.env);
  if (!parsed.success) throw new Error("Configuración del servidor incompleta. Revisá las variables de entorno.");
  return parsed.data;
}
