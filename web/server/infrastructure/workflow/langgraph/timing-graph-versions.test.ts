import { describe, expect, it } from "vitest";
import { TimingReviewLoopLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-review-loop-graph";
import { TimingSignalPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-signal-graph";
import { WatchlistTimingCardsPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-cards-graph";
import { WatchlistTimingPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-graph";

describe("timing workflow graph versions", () => {
  it("registers all timing workflow graphs with template version 1", () => {
    const graphs = [
      new TimingSignalPipelineLangGraph({} as never),
      new WatchlistTimingCardsPipelineLangGraph({} as never),
      new WatchlistTimingPipelineLangGraph({} as never),
      new TimingReviewLoopLangGraph({} as never),
    ];

    expect(graphs.map((graph) => graph.templateVersion)).toEqual([1, 1, 1, 1]);
  });
});
