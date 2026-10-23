"use server";

import { redirect } from "next/navigation";
import { scoreCases } from "@/lib/review/score";
import { appendScore, loadEvalCases } from "@/lib/review/store";

export async function rescoreAction() {
  const report = await scoreCases(loadEvalCases(), { label: "desk rescore" });
  appendScore(report);
  redirect("/score");
}
