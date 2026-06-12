import { NextResponse } from "next/server";
import { loadBank } from "@/lib/bank";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await loadBank();
  return NextResponse.json(entries);
}
