import { useCallback, useEffect, useRef, useState } from "react";
import { Shell, type Page } from "./components/Shell.tsx";
import { PretripPage } from "./pages/PretripPage.tsx";
import { DiagnosisPage } from "./pages/DiagnosisPage.tsx";
import { HistoryPage } from "./pages/HistoryPage.tsx";
import { readAgentSessions, selectAgentSession } from "./lib/agent-storage.ts";
import type { AgentSession } from "../shared/agent.ts";
import { requestDiagnosis, requestPretrip } from "./lib/api.ts";
import {
  defaultInput,
  type Diagnosis,
  type DiagnosisInput,
  type Pretrip,
  type Trip,
  type TripRecord,
} from "../shared/schema.ts";

const tripKeys = new Set([
  "water",
  "fish",
  "alias",
  "waterlevel",
  "rain",
  "legality",
]);
function getTrip(input: DiagnosisInput): Trip {
  return {
    water: input.water,
    fish: input.fish,
    alias: input.alias,
    waterlevel: input.waterlevel,
    rain: input.rain,
    legality: input.legality,
  };
}
function pageFromHash(): Page {
  const hash = window.location.hash.slice(1);
  return hash === "diagnose" || hash === "history" ? hash : "pretrip";
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [input, setInput] = useState<DiagnosisInput>(() => {
    const stored = readAgentSessions();
    const active =
      pageFromHash() === "diagnose"
        ? stored.sessions.find((item) => item.id === stored.current_id)
        : null;
    return active
      ? { ...active.context, lures: [...active.context.lures] }
      : { ...defaultInput, lures: [] };
  });
  const [pretrip, setPretrip] = useState<Pretrip | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState<"pretrip" | "diagnose" | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    request.current?.abort();
    setBusy(null);
  }, []);
  const navigate = useCallback(
    (next: Page) => {
      cancel();
      setError("");
      setPage(next);
      if (window.location.hash !== `#${next}`) window.location.hash = next;
      window.scrollTo({ top: 0, behavior: "instant" });
      window.requestAnimationFrame(() =>
        document.getElementById("main")?.focus({ preventScroll: true }),
      );
    },
    [cancel],
  );
  useEffect(() => {
    const onHashChange = () => {
      cancel();
      setPage(pageFromHash());
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      request.current?.abort();
    };
  }, [cancel]);
  useEffect(() => {
    document.title = `路探 AI · ${{ pretrip: "出钓前参考", diagnose: "现场作钓诊断", history: "我的记录" }[page]}`;
  }, [page]);

  function update<K extends keyof DiagnosisInput>(
    key: K,
    value: DiagnosisInput[K],
  ) {
    cancel();
    setError("");
    setInput((current) => ({ ...current, [key]: value }));
    setDiagnosis(null);
    if (tripKeys.has(key)) setPretrip(null);
  }
  async function generate(kind: "pretrip" | "diagnose") {
    cancel();
    const controller = new AbortController();
    request.current = controller;
    setBusy(kind);
    setError("");
    try {
      if (kind === "pretrip") {
        const result = await requestPretrip(getTrip(input), controller.signal);
        if (!controller.signal.aborted) setPretrip(result);
      } else {
        const result = await requestDiagnosis(input, controller.signal);
        if (!controller.signal.aborted) setDiagnosis(result);
      }
    } catch {
      if (!controller.signal.aborted)
        setError("暂时无法生成结果，请检查输入后重试。");
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }
  function reuse(record: TripRecord) {
    cancel();
    setInput({
      ...record.diagnosis.input,
      lures: [...record.diagnosis.input.lures],
    });
    setDiagnosis(null);
    setPretrip(null);
    navigate("diagnose");
  }
  function adoptAgentContext(next: DiagnosisInput) {
    cancel();
    setInput((current) => ({ ...next, alias: current.alias }));
    setDiagnosis(null);
    setPretrip(null);
  }
  function resumeAgent(session: AgentSession) {
    const result = selectAgentSession(session.id);
    if (result.error) return result.error;
    adoptAgentContext(session.context);
    navigate("diagnose");
    return null;
  }
  return (
    <Shell page={page} onNavigate={navigate}>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {page === "pretrip" && (
        <PretripPage
          input={input}
          onChange={update}
          result={pretrip}
          busy={busy === "pretrip"}
          onGenerate={() => {
            void generate("pretrip");
          }}
          onDiagnose={() => navigate("diagnose")}
          onRevise={() => {
            setPretrip(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
      {page === "diagnose" && (
        <DiagnosisPage
          input={input}
          onChange={update}
          result={diagnosis}
          busy={busy === "diagnose"}
          onGenerate={() => {
            void generate("diagnose");
          }}
          onPretrip={() => navigate("pretrip")}
          onRevise={() => {
            cancel();
            setDiagnosis(null);
          }}
          onHistory={() => navigate("history")}
          onAgentContext={adoptAgentContext}
        />
      )}
      {page === "history" && (
        <HistoryPage
          onStart={() => navigate("diagnose")}
          onReuse={reuse}
          onResumeAgent={resumeAgent}
        />
      )}
    </Shell>
  );
}
