import { categoriesController } from "@/backend/controllers/categories.controller";

export const PATCH = categoriesController.update;
export const DELETE = categoriesController.remove;
