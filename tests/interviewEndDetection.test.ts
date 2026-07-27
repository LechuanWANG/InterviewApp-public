import assert from "node:assert/strict";
import test from "node:test";
import {
  closingMessageForLanguage,
  isClosingInterviewPrompt,
} from "../lib/interview/endDetection";

test("detects Chinese interview closing prompts", () => {
  assert.equal(isClosingInterviewPrompt("好的，本轮面试就先到这里，感谢你的回答。"), true);
  assert.equal(isClosingInterviewPrompt("今天的面试到此结束，后续我们会再通知你。"), true);
  assert.equal(isClosingInterviewPrompt("感谢你参加今天的面试，后续请等待通知。"), true);
});

test("does not detect normal follow-up questions as closing prompts", () => {
  assert.equal(isClosingInterviewPrompt("你刚才提到负责用户调研，可以具体说说你怎么做的吗？"), false);
  assert.equal(isClosingInterviewPrompt("请继续补充这个项目最终的结果。"), false);
});

test("detects English interview closing prompts", () => {
  assert.equal(isClosingInterviewPrompt("Thank you for your time. We can stop here for this interview."), true);
  assert.equal(isClosingInterviewPrompt("That will be all for today. We will get back to you."), true);
});

test("provides localized closing message", () => {
  assert.equal(isClosingInterviewPrompt(closingMessageForLanguage("zh")), true);
  assert.equal(isClosingInterviewPrompt(closingMessageForLanguage("en")), true);
});
