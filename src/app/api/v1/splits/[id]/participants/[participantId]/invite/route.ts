import { splitsController } from "@/backend/controllers/splits.controller";

export const POST = splitsController.issueInvite;
export const DELETE = splitsController.revokeInvite;
