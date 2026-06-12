import { NextResponse } from "next/server";
import data from "@/data/engagement_comments.json";

export const dynamic = "force-dynamic";

/** On-brand comment lines to paste on other people's posts (awareness via
 *  genuine engagement). Sourced from data/engagement_comments.json — edit there. */
export async function GET() {
  return NextResponse.json(data);
}
