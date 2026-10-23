"use server";

import { redirect } from "next/navigation";
import { getDesk } from "@/lib/desk";
import { resolveFinding } from "@/lib/review/pipeline";
import { saveSession } from "@/lib/review/store";

export async function resolveAction(formData: FormData) {
  const reviewId = String(formData.get("reviewId") ?? "");
  const findingId = String(formData.get("findingId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (kind !== "fixed" && kind !== "closed") {
    redirect(`/reviews/${reviewId}?finding=${encodeURIComponent(findingId)}&error=${encodeURIComponent("Choose fixed or closed.")}`);
  }
  const store = await getDesk();
  const session = store.sessions.find((item) => item.id === reviewId);
  if (!session) redirect("/");
  try {
    const next = resolveFinding(session, findingId, { kind, reason });
    saveSession(next);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not resolve the finding.";
    redirect(
      `/reviews/${reviewId}?finding=${encodeURIComponent(findingId)}&error=${encodeURIComponent(message)}`,
    );
  }
  redirect(`/reviews/${reviewId}`);
}
