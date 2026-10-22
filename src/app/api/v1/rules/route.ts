import { rulesController } from "@/backend/controllers/rules.controller";

export const GET = rulesController.list;
export const POST = rulesController.create;
