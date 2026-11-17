import { copyFileSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { root, pkg, npmCli, supportedNode, localEnv, endpoint, inspectPort, inspectConfig, runNode, openBrowser } from "./local-runtime.mjs";

async function main() {
  if (process.argv.includes("--check")) return runNode(["scripts/doctor.mjs"]);
  if (!supportedNode()) throw new Error("需要 Node.js 22.12+；安装后重新打开启动器。");
  const npm = npmCli();
  if (!npm) throw new Error("没有找到 npm。请安装包含 npm 的 Node.js 22.12+。");
  console.log(`路探 AI ${pkg.version} · 本机启动`);
  if (!existsSync(join(root, ".env"))) {
    try { copyFileSync(join(root, ".env.example"), join(root, ".env"), constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== "EEXIST") throw new Error("不能创建 .env，请检查目录写入权限。"); }
    console.log("已创建默认关闭模型的 .env；已有服务端环境变量仍优先生效。");
  }
  if (localEnv() === "unreadable") throw new Error(".env 无法读取，请检查文件格式与权限。");
  const target = endpoint();
  const state = await inspectPort(target);
  if (state.state === "same_version_running") {
    console.log(`此端口已有同版本路探 AI：${target.url}`);
    console.log("本次复用旧服务。若要使用此目录的代码或新配置，请先停止旧服务再启动。");
    if (!process.argv.includes("--no-open")) openBrowser(target.url);
    return 0;
  }
  if (state.state !== "free") throw new Error(`端口 ${target.port} 已有服务；请自行停止旧服务，或在 .env 设置其他 PORT。`);
  const installed = ["tsx", "typescript", "express", "react", "vite", "zod"].every((name) => existsSync(join(root, "node_modules", name, "package.json")));
  if (!installed) {
    console.log("正在按锁文件安装依赖，首次需要网络……");
    if (await runNode([npm, "ci", "--cache", ".cache/npm", "--no-audit", "--no-fund"])) return 1;
  }
  const model = inspectConfig();
  console.log(`模型配置：${model.configuration}；配置检查不会发送推理请求。`);
  console.log("正在构建本目录源码……");
  if (await runNode([npm, "run", "build"])) return 1;
  console.log(`正在启动 ${target.url}；保留此窗口，Ctrl+C 停止服务。`);
  const running = runNode(["dist/server.mjs"]);
  // 只轮询本机健康接口；网页打开不会自动发起推理。
  let settled = false;
  void running.then(() => { settled = true; });
  for (let attempt = 0; attempt < 30 && !settled; attempt++) {
    await new Promise((done) => setTimeout(done, 250));
    if ((await inspectPort(target)).state === "same_version_running") {
      if (!process.argv.includes("--no-open")) openBrowser(target.url);
      break;
    }
  }
  return running;
}

try { process.exitCode = await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : "启动失败，请运行 npm run doctor 检查。");
  process.exitCode = 1;
}
