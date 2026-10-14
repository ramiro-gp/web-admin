import { describe, expect, it } from "vitest";
import { isAllowedGithubIdentity, isAllowedStoredAccount } from "@/lib/auth-policy";

describe("identidad del único administrador", () => {
  const source = { method: "oauth", oauth: { providerId: "github", profile: { id: 123, login: "admin", email: "admin@example.com" } } };
  it("autoriza por ID inmutable, independientemente de email o nombre", () => {
    expect(isAllowedGithubIdentity("123", source)).toBe(true);
    expect(isAllowedGithubIdentity("123", { ...source, oauth: { ...source.oauth, profile: { id: 123, login: "otro", email: "nuevo@example.com" } } })).toBe(true);
  });
  it("rechaza otras identidades aunque tengan el mismo email", () => {
    expect(isAllowedGithubIdentity("124", source)).toBe(false);
    expect(isAllowedStoredAccount("123", "github", "124")).toBe(false);
  });
  it("falla cerrado ante configuración/perfil ausentes o métodos diferentes", () => {
    for (const invalid of [null, {}, { method: "email" }, { ...source, oauth: { providerId: "google", profile: { id: 123 } } }, { ...source, oauth: { providerId: "github", profile: {} } }]) expect(isAllowedGithubIdentity("123", invalid)).toBe(false);
    expect(isAllowedGithubIdentity(undefined, source)).toBe(false);
    expect(isAllowedGithubIdentity("", source)).toBe(false);
  });
});
