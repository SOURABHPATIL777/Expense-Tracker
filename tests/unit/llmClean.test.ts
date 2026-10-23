import { describe, expect, it } from "vitest";
import { cleanModelJson } from "@/backend/llm/registry";

describe("cleanModelJson", () => {
  it("passes plain JSON through and strips markdown fences", () => {
    expect(cleanModelJson('{"ok":true}')).toBe('{"ok":true}');
    expect(cleanModelJson('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("drops reasoning a thinking model leaked before </think>", () => {
    expect(cleanModelJson('The user wants {"ok": maybe}…</think>{"ok":true}')).toBe('{"ok":true}');
  });

  it("finds the JSON a reply ends with when untagged reasoning comes first", () => {
    const reply = 'I should parse this into items: [{"name":"apples"}], with ok: true.{"ok": true, "items": [{"name": "apples", "n": 3}]}';
    expect(JSON.parse(cleanModelJson(reply))).toEqual({ ok: true, items: [{ name: "apples", n: 3 }] });
  });

  it("leaves non-JSON alone so validation reports it", () => {
    expect(cleanModelJson("no json here")).toBe("no json here");
  });
});
