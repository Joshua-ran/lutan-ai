import {
  RULE_VERSION,
  diagnosisInputSchema,
  diagnosisSchema,
  pretripSchema,
  tripSchema,
  rulesGeneration,
  type DiagnosisInput,
  type Diagnosis,
  type Pretrip,
  type ResultSource,
  type Trip,
} from "./schema.ts";

export const LEGAL_NOTICE =
  "请先核对适用日期的当地官方管理公告、河段范围和禁钓要求；未核实前暂停作钓。用户自述允许不代表系统已核验许可。";
export const SAFETY_NOTICE =
  "先停止危险岸边作钓，撤离可能受水位上涨、冲刷影响的区域，在安全位置查看当地官方水情预警。不要涉水或靠近危险结构。";

export function getRisk(
  input: Trip & { flow?: DiagnosisInput["flow"] },
): Diagnosis["risk"] {
  if (input.waterlevel === "急变" || input.flow === "很急") return "danger";
  if (input.legality === "禁止垂钓") return "restricted";
  if (input.legality === "未知") return "verify_first";
  return "normal";
}

export function buildPretrip(
  raw: unknown,
  source: ResultSource = "local_rules",
): Pretrip {
  const input = tripSchema.parse(raw);
  const risk = getRisk(input);
  const known = [
    `计划水域：${input.water}；目标鱼：${input.fish}（目标选择不是物种出现证据）。`,
    `用户观察水位：${input.waterlevel}；上游降雨：${input.rain}。并非监测实测。`,
    `合法性：${input.legality === "用户已核实允许" ? "用户自述已核实允许，系统未独立核验" : input.legality}。`,
  ];
  const unknowns = [
    "没有该水域可核验的目标鱼历史出现资料，证据不足，暂无法判断。没有记录不等于没有鱼。",
    "实时天气、实际水温、水位幅度、上游调度及现场鱼群均未接入，不能互相推断。",
    "历史出现与今天的鱼口不同；即使有过去记录，也不能保证当前能遇到目标鱼。",
  ];
  if (input.rain === "有")
    unknowns.push(
      "用户报告上游有雨，河道实际涨退水仍未知；降雨与鱼口的关系不能据此确定。",
    );
  if (input.fish === "鲈鱼")
    unknowns.push(
      "“鲈鱼”的具体物种尚未指明，需先确认鱼种，不能硬套其他鱼种分布与生态规律。",
    );
  const verification = [
    "核对当地最新官方公告与适用河段；出现危险水情先核对官方预警。",
    "在安全位置观察岸边稳定性、流速、水色与水深变化，不以气温推断水位。",
  ];
  let preparation =
    input.fish === "鳜鱼"
      ? "在安全且依法允许的前提下，可准备能确认下沉与搜索路径的钓组；留意结构区触底与挂底的差别。"
      : input.fish === "翘嘴"
        ? "在安全且依法允许的前提下，先观察可安全覆盖的水层；看到水面活动不等于识别出目标鱼。"
        : "先核实具体目标鱼种与水域资料，再准备合适的搜索方案；水草或结构存在不等于目标鱼存在。";
  if (risk === "danger") preparation = SAFETY_NOTICE;
  if (risk === "restricted")
    preparation =
      "该河段已被你标记为禁止垂钓，请停止作钓计划，遵守相关管理规定。";
  if (risk === "verify_first")
    preparation =
      "先完成水域合法性核实，确认允许垂钓和岸边安全后，再制定搜索方案。";
  return pretripSchema.parse({
    rule_version: RULE_VERSION,
    source,
    input,
    known,
    unknowns,
    verification,
    preparation,
    risk,
    evidence_status: "insufficient",
    notice:
      risk === "danger"
        ? SAFETY_NOTICE
        : risk === "restricted"
          ? "用户报告禁止垂钓：请停止作钓并遵守规定。"
          : LEGAL_NOTICE,
  });
}

type Rule = {
  rule_id: string;
  title: string;
  priority_action: string;
  rationale: string;
  follow_up_question?: string;
};

function chooseRule(input: DiagnosisInput): Rule {
  const risk = getRisk(input);
  if (risk === "danger")
    return {
      rule_id: "safety_first",
      title: "安全优先：先离开危险岸边",
      priority_action: SAFETY_NOTICE,
      rationale:
        "你报告了明显急涨水或急流。安全风险的优先级高于寻找鱼口，未知水位不能当作水情稳定。",
    };
  if (risk === "restricted")
    return {
      rule_id: "no_fishing",
      title: "停止作钓：当前标记为禁钓水域",
      priority_action: "停止在该河段作钓，收好装备并遵守适用的官方管理规定。",
      rationale:
        "你已报告禁止垂钓，不能用目标鱼存在或鱼口好坏来替代合法性要求。",
    };
  if (risk === "verify_first")
    return {
      rule_id: "verify_legality",
      title: "先核实这片水域是否允许垂钓",
      priority_action:
        "先在安全位置查询适用日期的当地官方公告，核对具体河段和禁钓范围；确认前暂停作钓。",
      rationale:
        "当前合法性未知。存在鱼类、水域适合或他人作钓，都不能证明这里依法允许垂钓。",
      follow_up_question:
        "你是否已核对适用日期的官方公告，并确认该河段允许当前方式作钓？",
    };
  if (input.signal === "跟饵")
    return {
      rule_id: "retrieve_rhythm",
      title: "有跟饵，先验证操作节奏",
      priority_action:
        "保持当前拟饵、位置和搜索水层，只小幅调整回收节奏或停顿，比较跟饵与攻击反馈的变化。",
      rationale:
        "你已观察到跟饵。先只改变节奏，便于比较反馈；跟饵不等于已识别目标鱼种，也不保证攻击。",
    };
  if (input.signal === "疑似触碰")
    return {
      rule_id: "check_rig",
      title: "先区分鱼口与结构碰撞",
      priority_action:
        "先在安全位置检查钩尖、钓组与拟饵运行状态，辨别触底、挂草和可能的咬口反馈。",
      rationale: "疑似触碰不等于确定鱼口，更不能凭一次触碰确认目标鱼存在。",
    };
  if (!input.lures.length)
    return {
      rule_id: "clarify_lure",
      title: "先确认当前使用的拟饵",
      priority_action:
        "先确认当前拟饵及其下沉、回收路径，明确实际搜索水层，暂时不要同时更换多个变量。",
      rationale:
        "拟饵输入缺失，目前无法判断实际覆盖范围，不能假定你使用了任何具体拟饵。",
      follow_up_question: "你当前使用什么拟饵？",
    };
  if (input.layers === "不清楚")
    return {
      rule_id: "confirm_layer",
      title: "先确认拟饵实际搜索的水层",
      priority_action:
        "保持当前拟饵，确认下沉和回收路径，记录实际覆盖的水层，暂不同时更换拟饵与位置。",
      rationale:
        "实际搜索水层未知，不能区分覆盖不足与其他原因，也不能断言鱼在底层。",
      follow_up_question: "当前拟饵实际覆盖了哪个水层？",
    };
  const thorough =
    input.layers === "多个水层" &&
    input.adjust === "都试过" &&
    input.lures.length >= 2;
  if (thorough && input.duration === "40 分钟以上")
    return {
      rule_id: "end_spot",
      title: "考虑结束当前标点搜索",
      priority_action:
        "结束当前标点的重复搜索，记录本次已尝试的范围，选择收竿或另找一个合法安全且结构不同的区域。",
      rationale:
        "你已长时间换饵、搜索多个水层并调整手法和位置，重复同一组动作新增信息有限；这不能证明这里没有鱼。",
    };
  if (thorough)
    return {
      rule_id: "controlled_comparison",
      title: "先把一次比较做完整",
      priority_action:
        "先固定当前位置、拟饵与水层，只用一种已试手法做一次可记录的比较，再判断是否继续。",
      rationale:
        "你尝试的变量较多，但时长较短或未知；信息不足，不能机械套用长时间放弃规则。",
    };
  if (input.adjust === "没有" || input.adjust === "手法") {
    if (input.adjust === "手法" && input.layers === "主要一个水层")
      return {
        rule_id: "compare_layer",
        title: "下一步，只比较另一个水层",
        priority_action:
          "保持当前拟饵、手法和安全位置，在拟饵能力范围内小幅改变搜索水层，记录是否有新的反馈。",
        rationale:
          "你已调整过手法，但主要搜索一个水层。比较覆盖范围不等于认定鱼躲在更深处。",
      };
    return {
      rule_id: "compare_structure",
      title: "先比较相邻结构的差异",
      priority_action:
        "选择附近合法安全且结构或流态略有不同的位置，只改变位置，保持当前拟饵、手法和搜索水层。",
      rationale:
        "你尚未换过位置，比较相邻结构可形成单项观察记录，但不能保证有鱼口。",
    };
  }
  if (input.layers === "主要一个水层")
    return {
      rule_id: "compare_layer",
      title: "下一步，只比较另一个水层",
      priority_action:
        "保持当前拟饵、手法和位置，只在安全范围内小幅改变搜索水层，记录反馈。",
      rationale:
        "当前主要搜索一个水层，其他水层的反馈尚未知，不能因此断定鱼在更深处。",
    };
  if (input.adjust === "换位")
    return {
      rule_id: "compare_rhythm",
      title: "换过位置后，只比较操作节奏",
      priority_action:
        "回顾已换位置的结构差异，固定当前安全位置、拟饵和水层，只小幅调整回收节奏并记录反馈。",
      rationale:
        "你已换过位置并覆盖多个水层，操作节奏仍可单独比较；无法把无口归因于某一个因素。",
    };
  return {
    rule_id: "clarify_attempt",
    title: "先补全一次尝试的范围",
    priority_action:
      "先确认已尝试过哪些调整，固定当前拟饵和位置，记录一次搜索过程，避免同时改变多个变量。",
    rationale:
      "现有输入不足以确定尚未覆盖的变量，结论有限，不能将无口等同于没有鱼。",
    follow_up_question: "你是否已调整过手法或换过附近位置？",
  };
}

export function diagnose(
  raw: unknown,
  source: ResultSource = "local_rules",
): Diagnosis {
  const input = diagnosisInputSchema.parse(raw);
  const rule = chooseRule(input);
  const unknowns = [
    "没有该水域目标鱼的可核验出现证据，证据不足；不能根据空军断言没有鱼。",
    "未接入实时天气、水温、水位幅度或鱼群位置，不提供鱼口概率与水位预测。",
  ];
  let rationale = rule.rationale;
  if (input.waterlevel === "涨水" || input.waterlevel === "退水") {
    rationale += ` 你观察到${input.waterlevel}，可记录岸边稳定性、流速、水色和原标点水深变化；本次记录不能确定水位变化与鱼口的因果关系。`;
  }
  if (input.rain === "有" || input.clarity === "浑浊") {
    unknowns.push(
      "用户报告近期降雨或浑浊，可能影响现场条件，但方向不确定；请以现场安全情况为先，不能断言雨后鱼口好坏。",
    );
  }
  if (input.observed === "水面炸水")
    unknowns.push(
      "水面炸水不能直接识别为翘嘴或其他目标鱼，需核查观察依据与当前搜索方法。",
    );
  if (input.fish === "鲈鱼")
    unknowns.push("具体鲈鱼物种未明确，不能直接套用其他鱼种的分布或习性。");
  const risk = getRisk(input);
  return diagnosisSchema.parse({
    id: crypto.randomUUID(),
    generation: rulesGeneration(),
    created_at: new Date().toISOString(),
    rule_version: RULE_VERSION,
    source,
    ...rule,
    rationale,
    follow_up_question: rule.follow_up_question ?? null,
    observed_facts: [
      `用户计划：${input.water} / ${input.fish}，并非物种证据。`,
      `用户观察：水位${input.waterlevel} / 水流${input.flow} / 水色${input.clarity} / 降雨${input.rain}。`,
      `结构：${input.structure}；时长：${input.duration}。`,
      `拟饵：${input.lures.join("、") || "未选择"}；水层：${input.layers}。`,
      `已调整：${input.adjust}；鱼口：${input.signal}；其他观察：${input.observed}。`,
      `合法性：${input.legality}（用户自述，系统未独立核验）。`,
    ],
    evidence_status: "insufficient",
    unknowns,
    risk,
    input,
    safety_or_legality_notice:
      risk === "danger"
        ? SAFETY_NOTICE
        : risk === "restricted"
          ? "请停止作钓并遵守该河段的官方管理规定。"
          : LEGAL_NOTICE,
  });
}
