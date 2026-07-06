"use client";

import { useState } from "react";

import { Panel } from "~/app/_components/ui";
import { api } from "~/trpc/react";

export function LatestPost() {
  const [latestPost] = api.post.getLatest.useSuspenseQuery();

  const utils = api.useUtils();
  const [name, setName] = useState("");
  const createPost = api.post.create.useMutation({
    onSuccess: async () => {
      await utils.post.invalidate();
      setName("");
    },
  });

  return (
    <Panel
      title="最新帖子"
      description="保留一个简洁的调试入口，视觉上与新的暗色工作台保持一致。"
      className="w-full max-w-sm"
    >
      {latestPost ? (
        <p className="truncate text-sm text-[var(--app-text)]">
          最近一条帖子：{latestPost.name}
        </p>
      ) : (
        <p className="text-sm text-[var(--app-text-muted)]">还没有帖子。</p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createPost.mutate({ name });
        }}
        className="mt-4 flex flex-col gap-3"
      >
        <input
          type="text"
          placeholder="标题"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="app-input"
        />
        <button
          type="submit"
          className="app-button app-button-primary"
          disabled={createPost.isPending}
        >
          {createPost.isPending ? "提交中..." : "提交"}
        </button>
      </form>
    </Panel>
  );
}
