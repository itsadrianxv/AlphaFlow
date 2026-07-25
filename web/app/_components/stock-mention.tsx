"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { StockKlineHoverCard } from "~/app/_components/stock-kline-hover-card";
import { useTheme } from "~/app/_components/theme-provider";
import { companyOverviewHref } from "~/app/company-research/company-overview-link";
import { api } from "~/trpc/react";

export type StockMentionItem = {
  stockCode: string;
  stockName: string;
};

type MarkdownNode = {
  type?: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

export function remarkStockMentions(mentions: StockMentionItem[]) {
  const items = [...mentions]
    .filter((item) => item.stockName.trim())
    .sort((left, right) => right.stockName.length - left.stockName.length);

  return (tree: MarkdownNode) => {
    if (items.length === 0) return;
    const pattern = new RegExp(
      items.map((item) => escapeRegExp(item.stockName)).join("|"),
      "g",
    );
    const mentionByName = new Map(
      items.map((item) => [item.stockName, item] as const),
    );

    function visit(parent: MarkdownNode) {
      if (
        parent.type === "code" ||
        parent.type === "inlineCode" ||
        parent.type === "link"
      ) {
        return;
      }
      const children = parent.children;
      if (!children) return;

      const nextChildren: MarkdownNode[] = [];
      for (const child of children) {
        if (child.type === "text" && child.value) {
          let lastIndex = 0;
          child.value.replace(pattern, (name, offset: number) => {
            if (offset > lastIndex) {
              nextChildren.push({
                type: "text",
                value: child.value?.slice(lastIndex, offset),
              });
            }
            const mention = mentionByName.get(name);
            if (mention) {
              nextChildren.push({
                type: "link",
                url: `stock-mention:${mention.stockCode}`,
                children: [{ type: "text", value: name }],
              });
            } else {
              nextChildren.push({ type: "text", value: name });
            }
            lastIndex = offset + name.length;
            return name;
          });
          if (lastIndex < child.value.length) {
            nextChildren.push({
              type: "text",
              value: child.value.slice(lastIndex),
            });
          }
        } else {
          nextChildren.push(child);
          visit(child);
        }
      }
      parent.children = nextChildren;
    }

    visit(tree);
  };
}

export function replaceStockMentionsInMarkdown(
  content: string,
  mentions: StockMentionItem[],
) {
  if (mentions.length === 0) return content;

  const names = [...mentions]
    .filter((item) => item.stockName.trim())
    .sort((left, right) => right.stockName.length - left.stockName.length);
  if (names.length === 0) return content;

  const pattern = new RegExp(
    names.map((item) => escapeRegExp(item.stockName)).join("|"),
    "g",
  );
  const mentionByName = new Map(
    names.map((item) => [item.stockName, item] as const),
  );
  const lines = content.split("\n");
  let fenced = false;

  return lines
    .map((line) => {
      if (line.trim().startsWith("```")) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;

      return line.replace(pattern, (name) => {
        const item = mentionByName.get(name);
        return item ? `[${name}](stock-mention:${item.stockCode})` : name;
      });
    })
    .join("\n");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function StockMention(props: StockMentionItem) {
  const router = useRouter();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const barsQuery = api.companyOverview.bars.useQuery(
    { stockCode: props.stockCode, timeframe: "DAILY", adjust: "" },
    {
      enabled: open,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  );

  return (
    <span
      className="relative inline-block align-baseline"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setOpen(false);
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="cursor-pointer text-[var(--app-accent-strong)] underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
        aria-label={`查看${props.stockName}K线图`}
        aria-expanded={open}
        onClick={() => router.push(companyOverviewHref(props.stockCode))}
      >
        {props.stockName}
      </button>
      {open ? (
        <StockKlineHoverCard
          stockCode={props.stockCode}
          stockName={props.stockName}
          bars={barsQuery.data?.bars ?? []}
          loading={barsQuery.isLoading}
          theme={theme}
          className="absolute left-0 top-full mt-2"
          onOpen={() => router.push(companyOverviewHref(props.stockCode))}
        />
      ) : null}
    </span>
  );
}
