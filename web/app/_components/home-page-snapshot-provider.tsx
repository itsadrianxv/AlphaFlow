"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { HomePageSnapshotEnvelope } from "~/contracts/homepage";
import { api } from "~/trpc/react";

const HomePageSnapshotContext = createContext<
  | { data?: HomePageSnapshotEnvelope; isLoading: boolean; isError: boolean }
  | undefined
>(undefined);

function isRefreshInProgress(data: HomePageSnapshotEnvelope | undefined) {
  return data && "refreshInProgress" in data
    ? data.refreshInProgress
    : data?.isRefreshing;
}

function currentDataLabel(data: HomePageSnapshotEnvelope | undefined) {
  if (!data) return "-";
  if ("dataCoverage" in data) {
    return data.dataCoverage.items[0]?.actualDataCutoffKey ?? "unknown";
  }
  return data.dataAsOf;
}

export function HomePageSnapshotProvider({
  children,
}: {
  children: ReactNode;
}) {
  const query = api.homepage.getSnapshot.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return (
    <HomePageSnapshotContext.Provider
      value={{
        data: query.data,
        isLoading: query.isLoading,
        isError: query.isError,
      }}
    >
      {isRefreshInProgress(query.data) ? (
        <div className="border-b border-[var(--app-border-soft)] px-4 py-2 text-xs text-[var(--app-text-muted)]">
          个性化数据更新中 · 当前数据日期 {currentDataLabel(query.data)}
        </div>
      ) : null}
      {children}
    </HomePageSnapshotContext.Provider>
  );
}

export function useHomePageSnapshot() {
  const value = useContext(HomePageSnapshotContext);
  if (!value)
    throw new Error("首页快照组件必须位于 HomePageSnapshotProvider 内");
  return value;
}
