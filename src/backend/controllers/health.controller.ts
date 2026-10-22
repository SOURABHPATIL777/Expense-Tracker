import "server-only";
import { withHandler } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { APP } from "@/backend/constants/app.constants";

export const healthController = {
  get: withHandler({ auth: AUTH_MODES.PUBLIC }, async () => ({
    status: "ok",
    service: APP.NAME,
    version: APP.API_VERSION,
    time: new Date().toISOString(),
  })),
};
