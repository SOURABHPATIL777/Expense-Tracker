import { z, type ZodType } from "zod";
import { parseAmountToMinor } from "../utils/money";

// Adapters from raw <form> strings (what FormData gives) to typed API values.
// API schemas stay strictly typed; form schemas compose these adapters with the same field schemas.

/** A schema that accepts a string as input (what every form value starts as). */
type StringInput = ZodType<unknown, string>;

/** "true" / "false" from FormField type="checkbox". */
export const checkboxField = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

/** Empty string → undefined, otherwise validated by `schema`. */
export const optionalField = <S extends StringInput>(schema: S) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(schema.optional());

/** Comma/newline separated list → array validated by `item`. */
export const listField = <S extends StringInput>(item: S, max = 20) =>
  z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(max));

/** Rupee amount typed by a person ("1,250.50") → positive paise. */
export const rupeesField = z
  .string()
  .trim()
  .min(1, "Enter an amount")
  .transform((v, ctx) => {
    const minor = parseAmountToMinor(v);
    if (minor === null || minor <= 0) {
      ctx.addIssue({ code: "custom", message: "Enter a positive amount like 250 or 1,250.50" });
      return z.NEVER;
    }
    return minor;
  });

export const numberField = z.coerce.number();
