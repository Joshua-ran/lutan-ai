import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { root, pkg, npmCli, supportedNode, localEnv, endpoint, inspectPort, inspectConfig } from "./local-runtime.mjs";

const env = localEnv();
const npm = npmCli();
const npmResult = npm && spawnSync(process.execPath, [npm, "--version"], { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true });
const npmVersion = npmResult?.status === 0 && /^\d+\.\d+\.\d+\s*$/.test(npmResult.stdout) ? npmResult.stdout.trim() : null;
const source = ["package-lock.json", "src/App.tsx", "server/index.ts", "shared/schema.ts", "index.html"].every((file) => existsSync(join(root, file)));
const dependencies = ["tsx", "typescript", "express", "react", "vite", "zod"].every((name) => existsSync(join(root, "node_modules", name, "package.json")));
let target, port;
try { target = endpoint(); port = await inspectPort(target); } catch { port = { state: "invalid_config" }; }
const report = {
  version: pkg.version,
  node: { version: process.versions.node, supported: supportedNode() },
  npm: { available: Boolean(npmVersion), version: npmVersion },
  source_complete: source,
  dependencies_installed: dependencies,
  build_exists: existsSync(join(root, "dist/server.mjs")) && existsSync(join(root, "dist/client/index.html")),
  env_file: env,
  model: inspectConfig(),
  port: { ...port, ...(target ? { url: target.url } : {}) },
  startup_prerequisites_ok: supportedNode() && Boolean(npmVersion) && source && port.state !== "invalid_config",
};
if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`路探 AI ${pkg.version} · 本机检查（不调用模型或天气服务）`);
  console.log(`Node ${report.node.version}：${report.node.supported ? "满足 22.12+" : "请升级至 22.12+"}`);
  console.log(`npm：${npmVersion || "未找到，请安装包含 npm 的 Node.js"}`);
  console.log(`源码：${source ? "完整" : "缺少必需文件，请重新解压"}`);
  console.log(`依赖：${dependencies ? "已安装" : "未安装；启动器将执行 npm ci，首次需要网络"}`);
  console.log(`构建：${report.build_exists ? "已有产物；启动器仍会重新构建" : "尚未构建；启动器将构建"}`);
  console.log(`.env：${env}（已有环境变量优先；此处不显示值）`);
  console.log(`模型配置：${report.model.configuration}；${report.model.key_available ? "已检测到密钥" : "无可用密钥或尚无法检查"}`);
  console.log("模型配置就绪只代表字段检查通过，未验证真实推理；缺少模型仍可使用规则。");
  console.log(`本机端口：${port.state}${target ? ` · ${target.url}` : ""}`);
  console.log("同端口旧服务需自行停止后重启才能应用此目录代码和配置；检查不会停止任何服务。");
}
process.exitCode = report.startup_prerequisites_ok ? 0 : 1;
