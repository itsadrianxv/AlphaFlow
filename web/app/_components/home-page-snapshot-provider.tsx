"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { HomePageSnapshotEnvelope } from "~/contracts/homepage";
import { api } from "~/trpc/react";

const HomePageSnapshotContext = createContext<
  | { data?: HomePageSnapshotEnvelope; isLoading: boolean; isError: boolean }
  | undefined
>(undefined);

export function HomePageSnapshotProvider({
  children,
  showRefreshStatus = true,
}: {
  children: ReactNode;
  showRefreshStatus?: boolean;
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
      {showRefreshStatus && query.data?.refreshInProgress ? (
        <div className="border-b border-[var(--app-border-soft)] px-4 py-2 text-xs text-[var(--app-text-muted)]">
          首页快照更新中
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
