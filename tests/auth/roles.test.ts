import { describe, expect, it } from "vitest";
import { ROLE_HOME, ROLES } from "@/lib/auth/roles";

describe("roles", () => {
  it("defines all roles (qc P9; auditor/director = owner P10; gate restored as pipeline entry)", () => {
    expect(ROLES).toEqual([
      "processing", "receiving", "qc", "manager", "accounting", "inventory", "gate", "owner",
    ]);
  });

  it("maps every role to a home path", () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toMatch(/^\/[a-z]+$/);
    }
  });
});
