import "server-only";
import type { JobType } from "@/backend/constants/enums.constants";
import type { JobDefinition } from "./defineJob";
import { parseImportJob } from "./handlers/parseImport";
import { classifyTransactionsJob } from "./handlers/classifyTransactions";
import { matchRefundsJob } from "./handlers/matchRefunds";

/** Every job type the worker can run. Handlers live in ./handlers and are registered here. */
export const JOB_REGISTRY: Partial<Record<JobType, JobDefinition>> = {
  parse_import: parseImportJob,
  classify_transactions: classifyTransactionsJob,
  match_refunds: matchRefundsJob,
};
