import { transactionsController } from "@/backend/controllers/transactions.controller";

export const GET = transactionsController.get;
export const PATCH = transactionsController.update;
