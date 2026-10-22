import "server-only";
import type { Db } from "@/backend/supabase/clients";
import { TABLES } from "@/backend/constants/db.constants";
import { unwrapMaybe } from "@/backend/errors/AppError";
import type { ProfileRow } from "./types";

/** Profiles are keyed by the auth user id itself, so they don't use BaseRepository's user_id scoping. */
export class ProfilesRepository {
  constructor(private readonly db: Db) {}

  async find(userId: string): Promise<ProfileRow | null> {
    return unwrapMaybe(await this.db.from(TABLES.PROFILES).select("*").eq("id", userId).maybeSingle(), "profiles.find") as ProfileRow | null;
  }
}
