import { importsController } from "@/backend/controllers/imports.controller";

export const GET = importsController.list;
export const POST = importsController.create;
