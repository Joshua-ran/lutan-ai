import { createApp } from "./app.ts";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    console.warn(
      "本地 .env 未能读取，请检查文件格式；服务继续使用当前环境配置或规则模式。",
    );
}

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const server = createApp({ serveClient: true }).listen(port, host, () => {
  console.log(`路探 AI 服务已就绪：http://${host}:${port}`);
});
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `端口 ${port} 已被占用，请设置 PORT 使用其他端口。`
      : "服务启动失败。",
  );
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
