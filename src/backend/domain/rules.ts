import "server-only";
import type { Direction, RuleField, RuleOperator, TransactionKind } from "@/backend/constants/enums.constants";

export type RuleTarget = { merchant: string | null; vpa: string | null; narration: string | null; direction: Direction };

export type Rule = {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  pattern: string;
  categoryId: string | null;
  transactionKind: TransactionKind | null;
  /** Only money in or only money out; null = both. */
  direction: Direction | null;
  priority: number;
};

/** Plain, case-insensitive string matching. No user-supplied regex, so no ReDoS risk. */
function matches(value: string | null, operator: RuleOperator, pattern: string): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  const p = pattern.toLowerCase();
  switch (operator) {
    case "contains":
      return v.includes(p);
    case "equals":
      return v === p;
    case "starts_with":
      return v.startsWith(p);
  }
}

/** First matching rule by priority (lower number wins), or null. */
export function firstMatchingRule(target: RuleTarget, rules: readonly Rule[]): Rule | null {
  return (
    [...rules]
      .sort((a, b) => a.priority - b.priority)
      .find((r) => (!r.direction || r.direction === target.direction) && matches(target[r.field], r.operator, r.pattern)) ?? null
  );
}
