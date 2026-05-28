import { describe, expect, it } from "vitest";
import { usernameToEmail, normalizeUsername } from "@/lib/provisioning/username";

describe("username helpers", () => {
  it("normalizes to lowercase, trims, no spaces", () => {
    expect(normalizeUsername("  Gate User ")).toBe("gate_user");
  });

  it("maps a username to the synthetic email domain", () => {
    expect(usernameToEmail("gate1", "magneticjoezion.local"))
      .toBe("gate1@magneticjoezion.local");
  });

  it("rejects empty usernames", () => {
    expect(() => normalizeUsername("   ")).toThrow();
  });
});
