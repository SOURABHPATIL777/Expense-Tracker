import { rulesController } from "@/backend/controllers/rules.controller";

export const POST = rulesController.apply;

// The worker continues after the response via after(); give it the full budget.
export const maxDuration = 60;
