import { describe, expect, it } from "vitest";
import { allowedTransitions, isValidTransition } from "../src/work-items/transitions.js";

/** Pure unit tests — lock the documented workflow matrix against silent changes. */
describe("status transition matrix", () => {
  it("matches the documented matrix exactly", () => {
    expect(allowedTransitions("OPEN")).toEqual(["IN_PROGRESS", "CLOSED"]);
    expect(allowedTransitions("IN_PROGRESS")).toEqual(["BLOCKED", "IN_REVIEW"]);
    expect(allowedTransitions("BLOCKED")).toEqual(["IN_PROGRESS", "CLOSED"]);
    expect(allowedTransitions("IN_REVIEW")).toEqual(["IN_PROGRESS", "DONE", "BLOCKED"]);
    expect(allowedTransitions("DONE")).toEqual(["CLOSED", "IN_PROGRESS"]);
    expect(allowedTransitions("CLOSED")).toEqual(["IN_PROGRESS"]);
  });

  it("accepts legal transitions and same-state no-ops", () => {
    expect(isValidTransition("OPEN", "IN_PROGRESS")).toBe(true);
    expect(isValidTransition("IN_REVIEW", "DONE")).toBe(true);
    expect(isValidTransition("DONE", "IN_PROGRESS")).toBe(true);
    expect(isValidTransition("OPEN", "OPEN")).toBe(true);
  });

  it("rejects jumps that skip the workflow", () => {
    expect(isValidTransition("OPEN", "DONE")).toBe(false);
    expect(isValidTransition("OPEN", "IN_REVIEW")).toBe(false);
    expect(isValidTransition("IN_PROGRESS", "DONE")).toBe(false);
    expect(isValidTransition("CLOSED", "DONE")).toBe(false);
    expect(isValidTransition("DONE", "BLOCKED")).toBe(false);
  });
});
