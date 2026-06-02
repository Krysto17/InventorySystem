import { describe, it, expect } from "vitest";
import {
  isLegalForwardTransition,
  isVisitOpen,
  TERMINAL_STATES,
  STATE_LABELS,
  VISIT_STATES,
} from "@/lib/visits/state-machine";

describe("state-machine TS mirror", () => {
  it("legal forward transitions match the DB allowed set", () => {
    expect(isLegalForwardTransition("at_gate_in", "in_processing")).toBe(true);
    expect(isLegalForwardTransition("at_gate_in", "in_receiving")).toBe(true);
    expect(isLegalForwardTransition("in_processing", "in_receiving")).toBe(true);
    expect(isLegalForwardTransition("in_receiving", "pricing")).toBe(true);
    expect(isLegalForwardTransition("pricing", "in_accounting")).toBe(true);
    expect(isLegalForwardTransition("pricing", "awaiting_gate_exit")).toBe(true);
    expect(isLegalForwardTransition("awaiting_gate_exit", "exited")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(isLegalForwardTransition("at_gate_in", "pricing")).toBe(false);
    expect(isLegalForwardTransition("in_processing", "pricing")).toBe(false);
  });

  it("identifies terminal states", () => {
    expect(TERMINAL_STATES.has("exited")).toBe(true);
    expect(TERMINAL_STATES.has("stocked")).toBe(true);
    expect(TERMINAL_STATES.has("pricing")).toBe(false);
  });

  it("isVisitOpen is the inverse of terminal", () => {
    expect(isVisitOpen("pricing")).toBe(true);
    expect(isVisitOpen("exited")).toBe(false);
    expect(isVisitOpen("stocked")).toBe(false);
  });

  it("STATE_LABELS covers every state", () => {
    for (const s of VISIT_STATES) {
      expect(STATE_LABELS[s]).toBeTruthy();
    }
  });
});
