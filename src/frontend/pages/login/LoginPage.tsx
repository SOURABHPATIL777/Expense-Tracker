"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/frontend/components/AuthCard/AuthCard";
import { Form } from "@/frontend/components/Form/Form";
import { FormField } from "@/frontend/components/Form/FormField";
import { Alert } from "@/frontend/components/Alert/Alert";
import { api } from "@/frontend/lib/apiClient";
import { safeNextPath } from "@/frontend/lib/safeRedirect";
import { API_ROUTES, PAGE_ROUTES } from "@/shared/constants/routes";
import { loginSchema, type LoginInput } from "@/shared/schemas/auth";
import styles from "./LoginPage.module.css";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const linkFailed = params.get("error") === "link";

  async function submit(values: LoginInput) {
    await api.post(API_ROUTES.auth.login, values);
    router.replace(safeNextPath(params.get("next")));
    router.refresh();
  }

  return (
    <div className={styles.stack}>
      {linkFailed && <Alert tone="warning">That confirmation link has expired or was already used. Sign in, or sign up again.</Alert>}
      <Form schema={loginSchema} onSubmit={submit} submitLabel="Sign in">
        <FormField name="email" label="Email" type="email" autoComplete="email" required />
        <FormField name="password" label="Password" type="password" autoComplete="current-password" required />
      </Form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back. Your spending is waiting."
      footer={
        <>
          New here? <Link href={PAGE_ROUTES.signup}>Create an account</Link>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
