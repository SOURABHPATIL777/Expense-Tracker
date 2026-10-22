import { accountsController } from "@/backend/controllers/accounts.controller";

export const GET = accountsController.list;
export const POST = accountsController.create;
