import { importsController } from "@/backend/controllers/imports.controller";

export const POST = importsController.uploaded;

// The worker continues after the response via after(); give it the full budget.
export const maxDuration = 60;
