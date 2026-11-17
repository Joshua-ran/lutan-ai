import { writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runEvaluation } from "./evaluation.ts";

const report = runEvaluation();
const flag = process.argv.indexOf("--output");
const output =
  flag >= 0
    ? process.argv[flag + 1]
    : path.join(os.tmpdir(), "lutan-ai-evaluation.json");
if (!output) throw new Error("--output 需要文件路径");
writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
console.table(
  report.results.map(({ case_id, theme, status }) => ({
    case_id,
    theme,
    status,
  })),
);
console.log(
  `自动回归：${report.summary.pass} 通过 / ${report.summary.fail} 失败 / ${report.summary.needs_review} 待复核。`,
);
console.log(`完整原始输出：${path.resolve(output)}`);
console.log(
  "P02 历史物种资料库为 P1，仍待接入；所有自然语言质量与专业判断仍需人工复核。",
);
if (report.summary.fail) process.exitCode = 1;
