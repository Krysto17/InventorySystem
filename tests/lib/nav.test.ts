import { describe, it, expect } from "vitest";
import { navForRole, isActivePath } from "@/lib/nav";
import { ROLES } from "@/lib/auth/roles";

describe("role-aware navigation", () => {
  it("every role has at least one nav item", () => {
    for (const role of ROLES) {
      expect(navForRole(role).length).toBeGreaterThan(0);
    }
  });

  it("owner sees the full cross-site set including Dashboard and Employees", () => {
    const labels = navForRole("owner").map((n) => n.label);
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Employees");
    expect(labels).toContain("Machines");
  });

  it("non-owner roles cannot see owner-only links", () => {
    for (const role of ["processing", "receiving", "manager", "accounting", "inventory"] as const) {
      const hrefs = navForRole(role).map((n) => n.href);
      expect(hrefs.every((h) => !h.startsWith("/owner"))).toBe(true);
    }
  });

  it("processing sees the new-visit intake link; others do not", () => {
    expect(navForRole("processing").some((n) => n.href === "/processing/intake")).toBe(true);
    expect(navForRole("receiving").some((n) => n.href === "/processing/intake")).toBe(false);
  });

  it("inventory sees stock, bulk sales, and consumables", () => {
    const hrefs = navForRole("inventory").map((n) => n.href);
    expect(hrefs).toEqual(
      expect.arrayContaining(["/inventory", "/inventory/bulk-sales", "/inventory/consumables"]),
    );
  });

  it("gate role has its own screen but no visit-intake (that's processing's job)", () => {
    expect((ROLES as readonly string[]).includes("gate")).toBe(true);
    const hrefs = navForRole("gate").map((n) => n.href);
    expect(hrefs).toContain("/gate");
    expect(hrefs).not.toContain("/gate/intake");
    expect(navForRole("processing").map((n) => n.href)).toContain("/processing/intake");
  });

  it("qc role exists with its own XRF queue (Phase 9)", () => {
    expect((ROLES as readonly string[]).includes("qc")).toBe(true);
    const hrefs = navForRole("qc").map((n) => n.href);
    expect(hrefs).toContain("/qc");
    expect(hrefs.every((h) => !h.startsWith("/owner"))).toBe(true);
  });

  it("site managers don't see gate passes / cost-price / reports; the general manager does", () => {
    const site = navForRole("manager", { isGeneralManager: false }).map((n) => n.href);
    expect(site).not.toContain("/manager/gate-passes");
    expect(site).not.toContain("/manager/cost-price");
    expect(site).not.toContain("/manager/reports");
    expect(site).not.toContain("/receiving"); // receiving module is GM-only
    expect(site).toContain("/manager"); // pricing queue stays

    const general = navForRole("manager", { isGeneralManager: true }).map((n) => n.href);
    expect(general).toContain("/manager/gate-passes");
    expect(general).toContain("/manager/cost-price");
    expect(general).toContain("/manager/reports");
    expect(general).toContain("/receiving"); // receiving queue
    expect(general).toContain("/receiving/intake"); // new processed intake
    // The separate cross-site "Search" button was removed — supplier search +
    // edit is the shared "Suppliers" directory (below), available to every role.
    expect(general).not.toContain("/owner/search");
    expect(general).toContain("/suppliers");
  });

  it("every role can reach the supplier directory", () => {
    for (const r of ["manager", "owner", "qc", "receiving", "accounting", "inventory", "processing"] as const) {
      expect(navForRole(r, { isGeneralManager: r === "manager" }).map((n) => n.href)).toContain("/suppliers");
    }
  });

  describe("isActivePath", () => {
    it("matches exact path", () => {
      expect(isActivePath("/owner", "/owner")).toBe(true);
    });
    it("matches sub-routes", () => {
      expect(isActivePath("/inventory", "/inventory/bulk-sales")).toBe(true);
    });
    it("does not match unrelated sibling prefixes", () => {
      // "/inventory" must NOT be active when on "/inventory-x" (no slash boundary)
      expect(isActivePath("/inventory", "/inventory-x")).toBe(false);
    });
    it("bulk-sales link stays active on its own route, parent also active", () => {
      expect(isActivePath("/inventory/bulk-sales", "/inventory/bulk-sales")).toBe(true);
    });
  });
});
