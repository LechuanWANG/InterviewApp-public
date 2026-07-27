import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { createDemoReportSession, type DemoReportVariant } from "@/lib/demoReportSession";
import { generateReport } from "@/lib/prompts/finalReport";
import { annotateAnswers } from "@/lib/prompts/annotateAnswers";
import type { Report, Round } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedVariant = searchParams.get("variant");
    if (requestedVariant === "council-file") {
      const outputPath = process.env.COUNCIL_DEMO_OUTPUT || "/private/tmp/council-new-report.json";
      const demo = JSON.parse(await readFile(outputPath, "utf-8")) as {
        report: Report;
        interviewRounds?: Round[];
        rounds?: Round[];
        company?: string;
        jobTitle?: string;
        sessionId?: string;
      };

      return NextResponse.json({
        variant: requestedVariant,
        report: demo.report,
        rounds: demo.interviewRounds ?? demo.rounds ?? [],
        company: demo.company ?? "Demo 公司",
        jobTitle: demo.jobTitle ?? "Demo 岗位",
        sessionId: demo.sessionId,
      });
    }

    const variant = requestedVariant === "good" ? "good" : "bad";
    const session = createDemoReportSession(variant as DemoReportVariant);
    const report = await generateReport(session);
    const annotations = await annotateAnswers(session, report);
    report.roundReviews = annotations.roundReviews;
    report.answerAnnotations = annotations.answerAnnotations;
    report.annotationSummaries = annotations.annotationSummaries;
    report.annotationStatus = "ready";

    return NextResponse.json({
      variant,
      report,
      rounds: session.rounds,
      company: session.company,
      jobTitle: session.jobTitle,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "failed to generate demo report" },
      { status: 500 }
    );
  }
}
