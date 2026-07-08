"use client";

import { useMemo, useState } from "react";
import type { ResearchTargetRef } from "~/contracts/research-target";
import { api } from "~/trpc/react";

type ResearchTargetPickerProps = {
  value?: ResearchTargetRef | null;
  onChange: (value: ResearchTargetRef | null) => void;
  allowedTypes?: ResearchTargetRef["type"][];
  label?: string;
  compact?: boolean;
};

function serializeRef(ref: ResearchTargetRef | null | undefined) {
  return ref ? `${ref.type}:${ref.id}` : "";
}

function parseRef(value: string): ResearchTargetRef | null {
  const [type, id] = value.split(":");
  if (
    !id ||
    !(
      type === "company" ||
      type === "industry" ||
      type === "watchlist" ||
      type === "space" ||
      type === "workflow_run"
    )
  ) {
    return null;
  }

  return { type, id };
}

const typeLabelMap: Record<ResearchTargetRef["type"], string> = {
  company: "公司",
  industry: "行业",
  watchlist: "自选股",
  space: "Space",
  workflow_run: "Run",
};

export function ResearchTargetPicker(props: ResearchTargetPickerProps) {
  const allowedTypes = props.allowedTypes ?? [
    "company",
    "industry",
    "watchlist",
    "space",
    "workflow_run",
  ];
  const targetsQuery = api.researchTarget.listTargets.useQuery({
    types: allowedTypes,
    limit: 100,
  });
  const [createMode, setCreateMode] = useState<"company" | "industry" | null>(
    null,
  );
  const [stockCode, setStockCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [industryName, setIndustryName] = useState("");
  const [industrySource, setIndustrySource] = useState("自定义主题");
  const utils = api.useUtils();

  const createCompanyMutation = api.researchTarget.createCompany.useMutation({
    onSuccess: async (created) => {
      props.onChange({ type: "company", id: created.id });
      setCreateMode(null);
      setStockCode("");
      setCompanyName("");
      await utils.researchTarget.listTargets.invalidate();
    },
  });
  const createIndustryMutation = api.researchTarget.createIndustry.useMutation({
    onSuccess: async (created) => {
      props.onChange({ type: "industry", id: created.id });
      setCreateMode(null);
      setIndustryName("");
      setIndustrySource("自定义主题");
      await utils.researchTarget.listTargets.invalidate();
    },
  });

  const options = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data]);
  const selectedValue = serializeRef(props.value);

  return (
    <div className={props.compact ? "grid gap-2" : "grid gap-3"}>
      {props.label ? (
        <div className="text-sm font-medium text-[var(--app-text-strong)]">
          {props.label}
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <select
          value={selectedValue}
          onChange={(event) => props.onChange(parseRef(event.target.value))}
          className="app-input"
        >
          <option value="">不绑定投研对象</option>
          {options.map((target) => (
            <option
              key={`${target.ref.type}:${target.ref.id}`}
              value={serializeRef(target.ref)}
            >
              [{typeLabelMap[target.ref.type]}] {target.label}
            </option>
          ))}
        </select>
        {allowedTypes.includes("company") ? (
          <button
            type="button"
            className="app-button"
            onClick={() =>
              setCreateMode(createMode === "company" ? null : "company")
            }
          >
            新公司
          </button>
        ) : null}
        {allowedTypes.includes("industry") ? (
          <button
            type="button"
            className="app-button"
            onClick={() =>
              setCreateMode(createMode === "industry" ? null : "industry")
            }
          >
            新行业
          </button>
        ) : null}
      </div>

      {createMode === "company" ? (
        <div className="grid gap-2 rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-3 md:grid-cols-[120px_minmax(0,1fr)_auto]">
          <input
            value={stockCode}
            onChange={(event) =>
              setStockCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="股票代码"
            className="app-input"
          />
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="公司名称"
            className="app-input"
          />
          <button
            type="button"
            className="app-button app-button-primary"
            disabled={
              stockCode.length !== 6 ||
              !companyName.trim() ||
              createCompanyMutation.isPending
            }
            onClick={() =>
              createCompanyMutation.mutate({
                stockCode,
                companyName: companyName.trim(),
              })
            }
          >
            保存
          </button>
        </div>
      ) : null}

      {createMode === "industry" ? (
        <div className="grid gap-2 rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
          <input
            value={industryName}
            onChange={(event) => setIndustryName(event.target.value)}
            placeholder="行业或主题名称"
            className="app-input"
          />
          <input
            value={industrySource}
            onChange={(event) => setIndustrySource(event.target.value)}
            placeholder="分类来源"
            className="app-input"
          />
          <button
            type="button"
            className="app-button app-button-primary"
            disabled={!industryName.trim() || createIndustryMutation.isPending}
            onClick={() =>
              createIndustryMutation.mutate({
                name: industryName.trim(),
                source: industrySource.trim() || "自定义主题",
              })
            }
          >
            保存
          </button>
        </div>
      ) : null}
    </div>
  );
}
