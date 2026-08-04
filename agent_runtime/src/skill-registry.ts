import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkills, type Skill } from "@earendil-works/pi-agent-core";
import { RestrictedExecutionEnv } from "./restricted-env";
import type { SkillSummary, UserSkillDefinition } from "./types";

const runtimeDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultSkillsRoot = path.resolve(runtimeDir, "skills");
const RESERVED_SKILL_IDS = new Set([
  "scheduled-task-setup",
  "scheduled-task-edit",
  "scheduled-task-execution",
]);

const SKILL_CATEGORY_BY_ID = new Map<string, string>([
  ["a-share-primary-theme-identification", "市场与题材"],
  ["market-environment-analysis", "市场与题材"],
  ["market_regime_switch_skill", "市场与题材"],
  ["market_sentiment_temperature_skill", "市场与题材"],
  ["market_breadth_health_skill", "市场与题材"],
  ["sector_rotation_radar_skill", "市场与题材"],
  ["theme-detector", "市场与题材"],
  ["theme_heat_tracker_skill", "市场与题材"],
  ["theme_leader_identification_skill", "市场与题材"],
  ["northbound_capital_flow_skill", "市场与题材"],
  ["macro_event_market_impact_skill", "市场与题材"],
  ["policy_headline_interpreter_skill", "市场与题材"],
  ["industry_chain_signal_skill", "市场与题材"],
  ["institutional_position_shift_skill", "市场与题材"],

  ["alphaflow-research-assistant", "个股研究"],
  ["stock_first_look_skill", "个股研究"],
  ["business_model_decoder_skill", "个股研究"],
  ["moat_strength_review_skill", "个股研究"],
  ["management_quality_check_skill", "个股研究"],
  ["growth_quality_check_skill", "个股研究"],
  ["equity-investment-thesis", "个股研究"],
  ["stock_research_memo_writer_skill", "个股研究"],
  ["bull_bear_case_builder_skill", "个股研究"],
  ["avatar-warren-buffett-investing", "个股研究"],
  ["avatar-charlie-munger-thinking", "个股研究"],
  ["avatar-nassim-taleb-risk", "个股研究"],
  ["avatar-naval-ravikant-thinking", "个股研究"],

  ["earnings-analysis", "财报、公告与事件解读"],
  ["earnings_calendar_planner_skill", "财报、公告与事件解读"],
  ["earnings_preview_skill", "财报、公告与事件解读"],
  ["earnings_reaction_interpreter_skill", "财报、公告与事件解读"],
  ["guidance_change_impact_skill", "财报、公告与事件解读"],
  ["conference_call_takeaway_skill", "财报、公告与事件解读"],
  ["major_announcement_impact_skill", "财报、公告与事件解读"],
  ["buyback_program_reviewer_skill", "财报、公告与事件解读"],
  ["dividend_change_explainer_skill", "财报、公告与事件解读"],
  ["sec_filing_question_answer_skill", "财报、公告与事件解读"],
  ["shareholder_letter_digest_skill", "财报、公告与事件解读"],
  ["watchlist_news_impact_digest_skill", "财报、公告与事件解读"],

  ["breakout_candidate_finder_skill", "选股与机会发现"],
  ["canslim_growth_scan_skill", "选股与机会发现"],
  ["high_quality_compounder_finder_skill", "选股与机会发现"],
  ["pullback_opportunity_finder_skill", "选股与机会发现"],
  ["vcp_breakout_scan_skill", "选股与机会发现"],
  ["pead_opportunity_skill", "选股与机会发现"],
  ["earnings_momentum_setup_skill", "选股与机会发现"],
  ["value_dividend_candidate_skill", "选股与机会发现"],
  ["dividend_growth_entry_skill", "选股与机会发现"],
  ["turnaround_story_validation_skill", "选股与机会发现"],

  ["valuation-pricing-framework", "估值与定价"],
  ["valuation_snapshot_skill", "估值与定价"],
  ["dcf-model", "估值与定价"],
  ["price_target_reach_alert_skill", "估值与定价"],
  ["peer_comparison_decision_skill", "估值与定价"],

  ["trade_plan_builder_skill", "交易计划与仓位风控"],
  ["premarket_trade_checklist_skill", "交易计划与仓位风控"],
  ["breakout_trade_execution_skill", "交易计划与仓位风控"],
  ["dip_buy_decision_skill", "交易计划与仓位风控"],
  ["position-sizer", "交易计划与仓位风控"],
  ["position_sizing_decision_skill", "交易计划与仓位风控"],
  ["stop_loss_discipline_skill", "交易计划与仓位风控"],
  ["take_profit_ladder_skill", "交易计划与仓位风控"],
  ["trim_or_hold_decision_skill", "交易计划与仓位风控"],
  ["add_to_winner_decision_skill", "交易计划与仓位风控"],
  ["failed_breakout_exit_skill", "交易计划与仓位风控"],
  ["backtest-expert", "交易计划与仓位风控"],

  ["daily_watchlist_morning_brief_skill", "盘中监控与复盘"],
  ["after_close_watchlist_recap_skill", "盘中监控与复盘"],
  ["post-market-debrief", "盘中监控与复盘"],
  ["hot_stock_quick_read_skill", "盘中监控与复盘"],
  ["intraday_abnormal_move_alert_skill", "盘中监控与复盘"],
  ["gap_open_interpreter_skill", "盘中监控与复盘"],
  ["volume_spike_reasoning_skill", "盘中监控与复盘"],
  ["support_break_warning_skill", "盘中监控与复盘"],
  ["trading_halt_resume_tracker_skill", "盘中监控与复盘"],
  ["tushare-finance", "盘中监控与复盘"],
]);

function resolveSkillCategory(skillId: string) {
  return SKILL_CATEGORY_BY_ID.get(skillId) ?? "个股研究";
}

export class SkillRegistry {
  private readonly skillsById = new Map<string, Skill>();
  private diagnostics: string[] = [];

  constructor(private readonly skillsRoot = defaultSkillsRoot) {}

  async load() {
    const env = new RestrictedExecutionEnv({
      cwd: this.skillsRoot,
      readRoots: [this.skillsRoot],
    });
    const result = await loadSkills(env, [this.skillsRoot]);

    this.skillsById.clear();
    this.diagnostics = result.diagnostics.map(
      (diagnostic) => `${diagnostic.code}: ${diagnostic.message}`,
    );

    for (const skill of result.skills) {
      this.skillsById.set(skill.name, skill);
    }

    return this;
  }

  get(skillId: string) {
    return this.skillsById.get(skillId) ?? null;
  }

  getWithUserDefinitions(
    skillId: string,
    userSkillDefinitions: UserSkillDefinition[] = [],
  ) {
    const userSkill = userSkillDefinitions.find(
      (definition) => definition.id === skillId,
    );
    if (userSkill) {
      return {
        name: userSkill.id,
        description: userSkill.description,
        content: userSkill.content,
        filePath: path.join(
          "virtual-user-skills",
          userSkill.versionId,
          "SKILL.md",
        ),
      } satisfies Skill;
    }

    return this.get(skillId);
  }

  list(): SkillSummary[] {
    return [...this.skillsById.values()].filter((skill) => !RESERVED_SKILL_IDS.has(skill.name)).map((skill) => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      category: resolveSkillCategory(skill.name),
      type: skill.name.includes("mcp") ? "tool" : "prompt",
      permissions: skill.name.includes("mcp")
        ? ["network", "filesystem_read", "child_process"]
        : ["prompt"],
    }));
  }

  getDiagnostics() {
    return [...this.diagnostics];
  }
}
