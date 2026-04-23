import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: (props: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) =>
    React.createElement(
      "a",
      {
        href: props.href,
        className: props.className,
      },
      props.children,
    ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("~/platform/trpc/react", () => ({
  api: {},
}));

import {
  CreateSpaceDialog,
  type CreateSpaceFormValues,
  ResearchSpacesListSection,
  type SpaceCardSummary,
  SpacesHeaderActions,
} from "~/modules/research/ui/spaces/spaces-client";

const sampleSpace: SpaceCardSummary = {
  id: "space-1",
  name: "半导体设备国产替代",
  description: "跟踪订单兑现与验证节奏。",
  brief: {
    coreThesis: "先进制程扩产会继续推升核心设备订单。",
  },
  runCount: 3,
  watchListCount: 1,
  stockCount: 4,
};

const emptyValues: CreateSpaceFormValues = {
  name: "",
  description: "",
  researchGoal: "",
  coreThesis: "",
  keyQuestions: "",
  focusDimensions: "",
  notes: "",
  archiveNote: "",
};

describe("SpacesHeaderActions", () => {
  it("renders the page-level create CTA next to the watchlists link", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SpacesHeaderActions, {
        onOpenCreate: () => undefined,
      }),
    );

    expect(markup).toContain("创建 Research Space");
    expect(markup).toContain('href="/watchlists"');
  });
});

describe("ResearchSpacesListSection", () => {
  it("renders a plain list section with an empty-state create action", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ResearchSpacesListSection, {
        isLoading: false,
        spaces: [],
        pendingContext: false,
        onAttachPendingContext: () => undefined,
        createAction: React.createElement(
          "button",
          { type: "button" },
          "创建 Research Space",
        ),
      }),
    );

    expect(markup).toContain('data-space-list-layout="plain"');
    expect(markup).toContain("已有研究空间");
    expect(markup).toContain("创建 Research Space");
  });

  it("keeps the research space cards and attach action in the plain list layout", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ResearchSpacesListSection, {
        isLoading: false,
        spaces: [sampleSpace],
        pendingContext: true,
        onAttachPendingContext: () => undefined,
        createAction: React.createElement(
          "button",
          { type: "button" },
          "创建 Research Space",
        ),
      }),
    );

    expect(markup).toContain('data-space-list-layout="plain"');
    expect(markup).toContain("半导体设备国产替代");
    expect(markup).toContain("打开空间");
    expect(markup).toContain("加入当前上下文");
    expect(markup).toContain("3 runs");
  });
});

describe("CreateSpaceDialog", () => {
  it("renders the create form as a modal with all fields and archive note support", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CreateSpaceDialog, {
        open: true,
        pending: false,
        showArchiveNote: true,
        values: emptyValues,
        onValueChange: () => undefined,
        onClose: () => undefined,
        onSubmit: () => undefined,
      }),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("创建 Research Space");
    expect(markup).toContain('placeholder="空间名称"');
    expect(markup).toContain('placeholder="一句话说明"');
    expect(markup).toContain('placeholder="研究目标"');
    expect(markup).toContain('placeholder="Core thesis"');
    expect(markup).toContain('placeholder="关键问题，每行一条"');
    expect(markup).toContain('placeholder="关注维度，每行一条"');
    expect(markup).toContain('placeholder="补充说明"');
    expect(markup).toContain("为什么应该进入这个 Space");
  });

  it("marks the modal busy and disables close/submit actions while pending", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CreateSpaceDialog, {
        open: true,
        pending: true,
        showArchiveNote: false,
        values: {
          ...emptyValues,
          name: "高端制造研究",
        },
        onValueChange: () => undefined,
        onClose: () => undefined,
        onSubmit: () => undefined,
      }),
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("创建中...");
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
