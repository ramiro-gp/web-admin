import { test } from "vitest";
import { prepareQaSession, qaFailureStage } from "../scripts/qa-session";

test("prepara sesión real únicamente en el destino QA confirmado", async () => {
  try { await prepareQaSession(); } catch {
    throw new Error(`No se pudo preparar QA (${qaFailureStage()}). Revisá el archivo QA y los identificadores confirmados; no se muestran credenciales.`);
  }
});
