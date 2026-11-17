import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { root, pkg } from "./local-runtime.mjs";
import { buildDelivery } from "./build-delivery.mjs";
import { allowedFile, collectFiles, secretValues, assertNoSecrets, hash, verifyDelivery } from "./release-policy.mjs";

buildDelivery();
const selected = collectFiles(root);
const files = Object.fromEntries(selected.map((name) => [name, new Uint8Array(readFileSync(path.join(root, name)))]));
const links = verifyDelivery(root, new Set(selected));
assertNoSecrets(files, secretValues(root));
let liveEvidence = null;
const acceptancePath = "docs/verification/live-deepseek/acceptance.json";
if (existsSync(path.join(root, acceptancePath))) {
  const acceptance = JSON.parse(readFileSync(path.join(root, acceptancePath), "utf8"));
  if (/^run-[A-Za-z0-9-]+\.json$/.test(acceptance.accepted_run || "")) {
    const recordPath = `docs/verification/live-deepseek/${acceptance.accepted_run}`;
    const recordBytes = files[recordPath];
    if (recordBytes && hash(recordBytes) === acceptance.accepted_run_sha256) {
      const record = JSON.parse(Buffer.from(recordBytes).toString("utf8"));
      const sourceMatches = Object.entries(record.source_sha256 || {}).every(([name, digest]) => files[name] && hash(files[name]) === digest);
      const checksPassed = record.results?.length === 10 && record.results.every((item) => item.status === "PASS");
      if (sourceMatches && checksPassed && record.status === "passed_technical_checks" && record.provider_origin === "https://api.deepseek.com")
        liveEvidence = { record: recordPath, review: acceptancePath, completed_at: record.completed_at, model: record.requested_model, scope: "five synthetic text cases, two API entry points; rule-limited candidates in three branches" };
    }
  }
}
const manifest = {
  product: "路探 AI", version: pkg.version, created_at: new Date().toISOString(),
  distribution: "source; Node.js >=22.12 and dependency installation required",
  boundaries: { real_model_scenarios_executed: Boolean(liveEvidence), real_photo_weather_validation_executed: false, browser_history_included: false },
  live_model_evidence: liveEvidence,
  verification_document: "docs/DELIVERY_VERIFICATION.md",
  link_check: links,
  files: selected.map((name) => ({ path: name, bytes: files[name].length, sha256: hash(files[name]) })),
};
files["RELEASE_MANIFEST.json"] = strToU8(JSON.stringify(manifest, null, 2) + "\n");
const zipped = zipSync(files, { level: 6 });
const roundtrip = unzipSync(zipped);
if (Object.keys(roundtrip).length !== selected.length + 1) throw new Error("ZIP 文件数量不一致。");
for (const entry of manifest.files) {
  if (!allowedFile(entry.path) || hash(roundtrip[entry.path]) !== entry.sha256) throw new Error(`ZIP 校验失败：${entry.path}`);
}
assertNoSecrets(roundtrip, secretValues(root));
const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date()).replace(/[^0-9]/g, "");
const name = `LutanAI_V${pkg.version}_Source_${stamp}_${process.pid}.zip`;
mkdirSync(path.join(root, "releases"), { recursive: true });
writeFileSync(path.join(root, "releases", name), zipped, { flag: "wx" });
console.log(JSON.stringify({ archive: `releases/${name}`, files: selected.length + 1, bytes: zipped.length, sha256: hash(zipped), links }, null, 2));
