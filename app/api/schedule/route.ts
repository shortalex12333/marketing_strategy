import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const revalidate = 300;

export async function GET() {
  try {
    const fp = path.join(process.cwd(), "data", "schedule.json");
    const text = fs.readFileSync(fp, "utf8");
    return NextResponse.json(JSON.parse(text));
  } catch (e) {
    return NextResponse.json(
      { error: "schedule.json missing or invalid", detail: String(e) },
      { status: 500 }
    );
  }
}
