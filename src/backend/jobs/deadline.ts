import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The wall-clock time by which the current job must be finished, so work started inside a
 * function never outlives it (on Vercel that kills the instance and every request sharing it).
 * Set by the worker around each job; read by long steps such as LLM calls.
 */
const storage = new AsyncLocalStorage<number>();

export const runWithDeadline = <T>(deadline: number, fn: () => Promise<T>): Promise<T> => storage.run(deadline, fn);

/** Milliseconds left for the current job, or Infinity outside a job (e.g. a user request). */
export function timeLeftMs(now = Date.now()): number {
  const deadline = storage.getStore();
  return deadline === undefined ? Number.POSITIVE_INFINITY : deadline - now;
}
