"use client";

import { useState } from "react";
import { PageHeader } from "@/frontend/components/PageHeader/PageHeader";
import { Card } from "@/frontend/components/Card/Card";
import { Button } from "@/frontend/components/Button/Button";
import { Select } from "@/frontend/components/Select/Select";
import { StatusBadge } from "@/frontend/components/StatusBadge/StatusBadge";
import { EmptyState } from "@/frontend/components/EmptyState/EmptyState";
import { Skeleton } from "@/frontend/components/Skeleton/Skeleton";
import { Alert } from "@/frontend/components/Alert/Alert";
import { Pagination } from "@/frontend/components/Pagination/Pagination";
import { TransactionCard } from "@/frontend/components/TransactionCard/TransactionCard";
import { usePaginatedList } from "@/frontend/hooks/usePaginatedList";
import { useCategories } from "@/frontend/hooks/useCategories";
import { useMutation } from "@/frontend/hooks/useMutation";
import { api } from "@/frontend/lib/apiClient";
import { API_ROUTES } from "@/shared/constants/routes";
import { REVIEW_ITEM_KIND_LABELS } from "@/shared/constants/labels";
import type { ResolveReviewInput, ReviewItemDto } from "@/shared/schemas/review";
import styles from "./ReviewPage.module.css";

type Resolve = (item: ReviewItemDto, input: ResolveReviewInput) => void;

function DuplicateItem({ item, resolve, pending }: { item: ReviewItemDto; resolve: Resolve; pending: boolean }) {
  return (
    <>
      <p className={styles.question}>Same amount and time, but no shared UTR. Is this the same payment seen twice?</p>
      <div className={styles.pair}>
        {item.related && <TransactionCard tx={item.related} label="Already recorded" />}
        {item.transaction && <TransactionCard tx={item.transaction} label="Newly imported" />}
      </div>
      <div className={styles.actions}>
        <Button onClick={() => resolve(item, { action: "merge" })} loading={pending}>
          Same payment — merge
        </Button>
        <Button variant="secondary" onClick={() => resolve(item, { action: "keep_both" })} disabled={pending}>
          Two different payments
        </Button>
      </div>
    </>
  );
}

type Categories = ReturnType<typeof useCategories>;

function CategoryItem({ item, resolve, pending, cats }: { item: ReviewItemDto; resolve: Resolve; pending: boolean; cats: Categories }) {
  const suggested = typeof item.payload.suggestedCategoryId === "string" ? cats.byId.get(item.payload.suggestedCategoryId) : undefined;
  const [choice, setChoice] = useState("");
  const confidence = typeof item.payload.confidence === "number" ? Math.round(item.payload.confidence * 100) : null;
  return (
    <>
      <p className={styles.question}>
        AI suggested {suggested ? <strong>{suggested.name}</strong> : "no category"}
        {confidence !== null && ` (${confidence}% sure)`}. Your answer is remembered for this merchant.
      </p>
      {item.transaction && <TransactionCard tx={item.transaction} category={suggested ?? null} />}
      <div className={styles.actions}>
        {suggested && (
          <Button onClick={() => resolve(item, { action: "accept" })} loading={pending}>
            Looks right
          </Button>
        )}
        <Select placeholder="Choose category" options={cats.options} value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Category" />
        <Button variant="secondary" disabled={!choice || pending} onClick={() => resolve(item, { action: "recategorize", categoryId: choice })}>
          Set category
        </Button>
      </div>
    </>
  );
}

export default function ReviewPage() {
  const list = usePaginatedList<ReviewItemDto>(API_ROUTES.reviewItems);
  const cats = useCategories();
  const [busyId, setBusyId] = useState<string>();
  const resolveMutation = useMutation(
    async (item: ReviewItemDto, input: ResolveReviewInput) => {
      setBusyId(item.id);
      try {
        await api.post(API_ROUTES.reviewItem(item.id), input);
      } finally {
        setBusyId(undefined);
      }
    },
    { successMessage: "Saved", onSuccess: list.reload },
  );
  const resolve: Resolve = (item, input) => void resolveMutation.run(item, input);

  return (
    <>
      <PageHeader title="Needs review" description="Things we won't decide for you: possible duplicates and categories the AI wasn't sure about." />
      {list.error && <Alert tone="danger">{list.error.message}</Alert>}
      {list.loading && list.rows.length === 0 ? (
        <Skeleton lines={6} />
      ) : list.rows.length === 0 ? (
        <Card>
          <EmptyState title="All caught up" description="Nothing needs your attention right now." />
        </Card>
      ) : (
        <div className={styles.list}>
          {list.rows.map((item) => (
            <Card
              key={item.id}
              title={<StatusBadge value={item.kind} map={REVIEW_ITEM_KIND_LABELS} />}
              actions={
                <Button variant="ghost" size="sm" onClick={() => resolve(item, { action: "dismiss" })} disabled={busyId === item.id}>
                  Dismiss
                </Button>
              }
            >
              <div className={styles.body}>
                {item.kind === "duplicate_candidate" ? (
                  <DuplicateItem item={item} resolve={resolve} pending={busyId === item.id} />
                ) : (
                  <CategoryItem item={item} resolve={resolve} pending={busyId === item.id} cats={cats} />
                )}
              </div>
            </Card>
          ))}
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </div>
      )}
    </>
  );
}
