"use client";

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AuthCard } from "@/frontend/components/AuthCard/AuthCard";
import { Button } from "@/frontend/components/Button/Button";
import { Alert } from "@/frontend/components/Alert/Alert";
import { api, ApiError } from "@/frontend/lib/apiClient";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import styles from "./GuestLandingPage.module.css";

/**
 * Generic on purpose: nothing about the expense is shown (or fetched) until the visitor presses
 * Continue, so chat-app link previews and crawlers can't redeem the link or read details.
 */
function Landing() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function proceed() {
    setPending(true);
    setError(undefined);
    try {
      await api.post(API_ROUTES.guest.redeem, { token });
      // Leave the token behind: the session now carries access.
      router.replace(PAGE_ROUTES.guestView);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setPending(false);
    }
  }

  return (
    <div className={styles.body}>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button onClick={proceed} loading={pending}>
        Continue
      </Button>
      <p className={styles.fine}>No sign-up needed. This link works on one device; we&apos;ll remember you in this browser.</p>
    </div>
  );
}

export default function GuestLandingPage() {
  return (
    <AuthCard title="You've received a shared expense" subtitle="Someone split a payment with you and wants you to see your part.">
      <Suspense>
        <Landing />
      </Suspense>
    </AuthCard>
  );
}
