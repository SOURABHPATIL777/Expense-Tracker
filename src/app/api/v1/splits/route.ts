import { splitsController } from "@/backend/controllers/splits.controller";

export const GET = splitsController.list;
export const POST = splitsController.create;
