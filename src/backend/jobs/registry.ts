import "server-only";
import type { JobType } from "@/backend/constants/enums.constants";
import type { JobDefinition } from "./defineJob";

/** Every job type the worker can run. Handlers live in ./handlers and are registered here. */
export const JOB_REGISTRY: Partial<Record<JobType, JobDefinition>> = {};
