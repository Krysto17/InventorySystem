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

  // src/middleware.ts inlines a copy of this map (Vercel's Edge bundler won't
  // import a local module into middleware). Pin the values so the two can't
  // silently drift — if this changes, update ROLE_HOME in src/middleware.ts too.
  it("role home paths are pinned (middleware keeps an inlined copy)", () => {
    expect(ROLE_HOME).toEqual({
      processing: "/processing",
      receiving: "/receiving",
      qc: "/qc",
      manager: "/manager",
      accounting: "/accounting",
      inventory: "/inventory",
      gate: "/gate",
      owner: "/owner",
    });
  });
});
