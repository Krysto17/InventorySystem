import { describe, expect, it } from "vitest";
import { ROLE_HOME, ROLES } from "@/lib/auth/roles";

describe("roles", () => {
  it("defines all seven roles (gate removed in Phase 7; qc added in Phase 9)", () => {
    expect(ROLES).toEqual([
      "processing", "receiving", "qc", "manager", "accounting", "inventory", "owner",
    ]);
  });

  it("maps every role to a home path", () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toMatch(/^\/[a-z]+$/);
    }
  });
});
