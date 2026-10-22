"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/frontend/components/AuthCard/AuthCard";
import { Form } from "@/frontend/components/Form/Form";
import { FormField } from "@/frontend/components/Form/FormField";
import { Alert } from "@/frontend/components/Alert/Alert";
import { ResendConfirmation } from "@/frontend/components/ResendConfirmation/ResendConfirmation";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { signupSchema, type SignupInput, type SignupResultDto } from "@/shared/schemas/auth";
import styles from "./SignupPage.module.css";

export default function SignupPage() {
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string>();

  async function submit(values: SignupInput) {
    const { data } = await api.post<SignupResultDto>(API_ROUTES.auth.signup, values);
    if (data.needsEmailConfirmation) setSentTo(values.email);
    else {
      router.replace(PAGE_ROUTES.dashboard);
      router.refresh();
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Track UPI spending from PhonePe, Google Pay, Paytm and your bank."
      footer={
        <>
          Already have an account? <Link href={PAGE_ROUTES.login}>Sign in</Link>
        </>
      }
    >
      {sentTo ? (
        <div className={styles.stack}>
          <Alert tone="success" title="Check your inbox">
            We sent a confirmation link to {sentTo}. Open it to finish signing up. Nothing arrived, or the link expired?
          </Alert>
          <ResendConfirmation email={sentTo} />
        </div>
      ) : (
        <div className={styles.stack}>
          <Form schema={signupSchema} onSubmit={submit} submitLabel="Create account">
            <FormField name="displayName" label="Your name" autoComplete="name" required />
            <FormField name="email" label="Email" type="email" autoComplete="email" required />
            <FormField name="password" label="Password" type="password" autoComplete="new-password" hint="At least 8 characters" required />
          </Form>
          <p className={styles.privacy}>We never ask for your UPI PIN, OTPs or bank passwords.</p>
        </div>
      )}
    </AuthCard>
  );
}
