import { llmConfigsController } from "@/backend/controllers/llmConfigs.controller";

export const GET = llmConfigsController.list;
export const PUT = llmConfigsController.save;

export const maxDuration = 60;
