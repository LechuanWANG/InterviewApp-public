import type { NextAction, Session } from "../types";
import { runInterviewAgent } from "../interview/langgraphAgent";

export async function decideNextQuestion(session: Session): Promise<NextAction> {
  return runInterviewAgent(session);
}
