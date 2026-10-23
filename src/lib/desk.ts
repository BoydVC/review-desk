import { connection } from "next/server";
import { ensureStore, type DeskStore } from "./review/store";

export async function getDesk(): Promise<DeskStore> {
  await connection();
  return ensureStore();
}
