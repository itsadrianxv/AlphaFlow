import {
  defaultShouldDehydrateQuery,
  MutationCache,
  QueryCache,
  QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

let authRedirecting = false;

function redirectToLoginOnExpiredSession(error: unknown) {
  if (typeof window === "undefined" || authRedirecting) return;
  if (
    !error ||
    typeof error !== "object" ||
    !("data" in error) ||
    (error as { data?: { code?: string } }).data?.code !== "UNAUTHORIZED"
  ) {
    return;
  }

  authRedirecting = true;
  const currentPath = `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({
    reason: "session-expired",
    redirectTo: currentPath,
  });
  window.location.replace(`/login?${params.toString()}`);
}

export const createQueryClient = () =>
  new QueryClient({
    queryCache: new QueryCache({
      onError: redirectToLoginOnExpiredSession,
    }),
    mutationCache: new MutationCache({
      onError: redirectToLoginOnExpiredSession,
    }),
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
