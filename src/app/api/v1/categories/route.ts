import { categoriesController } from "@/backend/controllers/categories.controller";

export const GET = categoriesController.list;
export const POST = categoriesController.create;
