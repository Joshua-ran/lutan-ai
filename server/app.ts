import express, { type ErrorRequestHandler } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildPretrip } from "../shared/engine.ts";
import { createDiagnosisService } from "./diagnosis-service.ts";
import { createAgentService } from "./agent/service.ts";
import { createModelBudget } from "./llm/budget.ts";
import { readLlmConfig } from "./llm/config.ts";
import { agentTurnInputSchema } from "../shared/agent.ts";
import { validateImage } from "./agent/image.ts";
import {
  RULE_VERSION,
  diagnosisInputSchema,
  tripSchema,
} from "../shared/schema.ts";

export function createApp({
  serveClient = false,
  diagnosisService: injectedDiagnosis,
  agentService: injectedAgent,
}: {
  serveClient?: boolean;
  diagnosisService?: ReturnType<typeof createDiagnosisService>;
  agentService?: ReturnType<typeof createAgentService>;
} = {}) {
  const config = readLlmConfig();
  const budget = createModelBudget(config);
  const diagnosisService =
    injectedDiagnosis ?? createDiagnosisService({ config, budget });
  const agentService = injectedAgent ?? createAgentService({ config, budget });
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api/agent/turn", express.json({ limit: "3mb", strict: true }));
  app.use(express.json({ limit: "16kb", strict: true }));
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      product: "路探 AI",
      version: "1.2.0",
      rule_version: RULE_VERSION,
      capabilities: {
        diagnosis: diagnosisService.capabilities().configured
          ? "rules_with_optional_llm"
          : "rules",
        llm: diagnosisService.capabilities().configured,
        weather:
          agentService.capabilities().enabled &&
          agentService.capabilities().tools,
        waterlevel: false,
        species: false,
        cloud_storage: false,
      },
      llm: diagnosisService.capabilities(),
      agent: agentService.capabilities(),
    }),
  );
  app.post("/api/pretrip", (req, res) => {
    const parsed = tripSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(422).json({
        error: "输入不符合出钓计划格式",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    return res.json(buildPretrip(parsed.data, "server_rules"));
  });
  app.post("/api/diagnoses", async (req, res) => {
    const parsed = diagnosisInputSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(422).json({
        error: "输入不符合现场诊断格式",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    const controller = new AbortController();
    const onDisconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onDisconnect);
    try {
      const result = await diagnosisService.generate(
        parsed.data,
        controller.signal,
      );
      if (!res.destroyed) res.json(result);
    } finally {
      res.off("close", onDisconnect);
    }
  });
  app.post("/api/agent/turn", async (req, res) => {
    const parsed = agentTurnInputSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(422)
        .json({ error: "现场助手输入格式无效，请缩短文字或重新选择图片。" });
    if (parsed.data.image && !validateImage(parsed.data.image))
      return res.status(422).json({
        error: "图片必须为真实 JPG、PNG 或 WebP，压缩后不超过 2 MB。",
      });
    const controller = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", disconnected);
    try {
      const result = await agentService.turn(parsed.data, controller.signal);
      if (!res.destroyed) res.json(result);
    } finally {
      res.off("close", disconnected);
    }
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  const clientPath = path.resolve("dist/client");
  if (serveClient && existsSync(path.join(clientPath, "index.html"))) {
    app.use(express.static(clientPath, { index: false, maxAge: 0 }));
    app.get("/", (_req, res) =>
      res.sendFile("index.html", { root: clientPath }),
    );
  }
  app.use((_req, res) => res.status(404).json({ error: "页面不存在" }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "请求内容过长" });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: "请求必须包含有效 JSON" });
      return;
    }
    res.status(500).json({ error: "服务暂时不可用，请稍后重试" });
  };
  app.use(errorHandler);
  return app;
}
