import { refundsController } from "@/backend/controllers/refunds.controller";

export const GET = refundsController.list;
export const POST = refundsController.create;
