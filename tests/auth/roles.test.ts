import { describe, expect, it } from "vitest";
import { ROLE_HOME, ROLES } from "@/lib/auth/roles";

describe("roles", () => {
  it("defines all eight roles (gate removed in P7; qc added in P9; auditor in P10)", () => {
    expect(ROLES).toEqual([
      "processing", "receiving", "qc", "manager", "accounting", "inventory", "auditor", "owner",
    ]);
  });

  it("maps every role to a home path", () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toMatch(/^\/[a-z]+$/);
    }
  });
});
