import { accountsController } from "@/backend/controllers/accounts.controller";

export const PATCH = accountsController.update;
export const DELETE = accountsController.remove;
