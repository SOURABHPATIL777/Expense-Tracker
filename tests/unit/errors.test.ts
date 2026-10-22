import { describe, expect, it } from "vitest";
import { AppError, fromDbError, unwrap, unwrapMaybe } from "@/backend/errors/AppError";

describe("fromDbError", () => {
  it.each([
    ["23505", "CONFLICT", 409],
    ["PGRST116", "NOT_FOUND", 404],
    ["42501", "FORBIDDEN", 403],
    ["23514", "VALIDATION", 422],
    ["XX000", "INTERNAL", 500],
  ])("maps postgres %s to %s", (code, expected, status) => {
    const err = fromDbError({ code, message: "boom" });
    expect(err.code).toBe(expected);
    expect(err.status).toBe(status);
  });

  it("maps APP:<CODE> exceptions raised from SQL functions", () => {
    const err = fromDbError({ code: "P0001", message: "APP:INVITE_TAKEN" });
    expect(err.code).toBe("INVITE_TAKEN");
    expect(err.status).toBe(409);
  });

  it("never exposes internal messages to the client", () => {
    const err = fromDbError({ code: "XX000", message: "relation secret_table does not exist" });
    expect(err.message).not.toContain("secret_table");
  });
});

describe("unwrap", () => {
  it("returns data or throws NOT_FOUND for null", () => {
    expect(unwrap({ data: 1, error: null }, "t")).toBe(1);
    expect(() => unwrap({ data: null, error: null }, "t")).toThrow(AppError);
    expect(unwrapMaybe({ data: null, error: null }, "t")).toBeNull();
  });
});
