import { describe, expect, it } from "vitest";
import { ROLE_HOME, ROLES } from "@/lib/auth/roles";

describe("roles", () => {
  it("defines all roles (qc P9; auditor/director = owner P10; security re-added)", () => {
    expect(ROLES).toEqual([
      "processing", "receiving", "qc", "manager", "accounting", "inventory", "security", "owner",
    ]);
  });

  it("maps every role to a home path", () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toMatch(/^\/[a-z]+$/);
    }
  });
});
