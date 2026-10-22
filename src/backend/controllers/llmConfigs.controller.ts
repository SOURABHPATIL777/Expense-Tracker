import "server-only";
import { withHandler } from "@/backend/http/withHandler";
import { AUTH_MODES } from "@/backend/constants/enums.constants";
import { RATE_LIMITS } from "@/backend/constants/security.constants";
import { llmConfigService } from "@/backend/services/llmConfig.service";
import { llmConfigInputSchema, llmTestSchema } from "@/shared/schemas/llm";

const USER = AUTH_MODES.USER;
const llmLimit = { bucket: "llm-test", policy: RATE_LIMITS.LLM };

export const llmConfigsController = {
  list: withHandler({ auth: USER }, async ({ db, auth }) => llmConfigService(db).list(auth.userId)),
  options: withHandler({ auth: USER }, async ({ db }) => llmConfigService(db).options()),
  save: withHandler({ auth: USER, body: llmConfigInputSchema, rateLimit: llmLimit }, async ({ db, auth, body }) => llmConfigService(db).save(auth.userId, body)),
  test: withHandler({ auth: USER, body: llmTestSchema, rateLimit: llmLimit }, async ({ db, auth, body }) => llmConfigService(db).test(auth.userId, body)),
};
