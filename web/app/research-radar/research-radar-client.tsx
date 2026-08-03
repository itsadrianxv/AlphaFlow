"use client";

import { Radar, RefreshCw } from "lucide-react";
import Link from "next/link";
import { WorkspaceShell } from "~/app/_components/workspace-shell";
import styles from "~/app/research-radar/research-radar.module.css";
import { api, type RouterOutputs } from "~/trpc/react";

type RadarResult = RouterOutputs["researchRadar"]["query"];

function scoreLabel(score: number | null) {
  if (score === null) return "—";
  return ["低", "低", "中", "高", "极高"][score] ?? "—";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function RadarRow({ item }: { item: RadarResult["items"][number] }) {
  return (
    <article className={styles.row}>
      <div className={styles.rowMain}>
        <div className={styles.rowMeta}>
          <span>{item.subjectKey}</span>
          <span>{item.revisionKind}</span>
          <time dateTime={item.occurredAt}>{formatDate(item.occurredAt)}</time>
        </div>
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
        <div className={styles.matches}>
          {item.matchedPreferences.map((match) => (
            <span key={`${match.targetType}:${match.targetKey}`}>
              {match.targetKey} · {match.level}
            </span>
          ))}
          <span>{item.relevanceReason}</span>
        </div>
      </div>
      <dl className={styles.scores}>
        <div>
          <dt>相关性</dt>
          <dd data-focus={item.directFocusMatch || undefined}>
            {scoreLabel(item.relevance)}
          </dd>
        </div>
        <div>
          <dt>重要性</dt>
          <dd>{scoreLabel(item.globalScores.importance)}</dd>
        </div>
        <div>
          <dt>证据</dt>
          <dd>{item.evidenceCount}</dd>
        </div>
        <div>
          <dt>基线序位</dt>
          <dd>{item.baselineRank}</dd>
        </div>
      </dl>
    </article>
  );
}

export function ResearchRadarClient() {
  const query = api.researchRadar.query.useQuery({ capacity: 20 });
  const data = query.data;

  return (
    <WorkspaceShell
      section="researchRadar"
      title="研究雷达"
      description="按当前冻结偏好筛选有效事件，直接关注优先于全局基线容量。"
      showHistory={false}
      contentWidth="wide"
      actions={
        <button
          type="button"
          aria-label="刷新研究雷达"
          title="刷新研究雷达"
          className={styles.refresh}
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw
            size={16}
            className={query.isFetching ? styles.spinning : undefined}
          />
          <span>刷新</span>
        </button>
      }
    >
      <section className={styles.surface} aria-label="个性化研究雷达结果">
        <header className={styles.toolbar}>
          <div>
            <strong>{data?.items.length ?? 0}</strong>
            <span> 条个性化事件</span>
          </div>
          <div className={styles.snapshot}>
            {data?.preferenceSnapshotId
              ? `偏好快照 ${data.preferenceSnapshotId.slice(0, 8)}`
              : "暂无偏好快照"}
          </div>
        </header>

        {query.isLoading ? (
          <div className={styles.message}>正在读取研究雷达…</div>
        ) : query.isError ? (
          <div className={styles.message}>研究雷达读取失败，请稍后重试。</div>
        ) : data?.items.length ? (
          <div className={styles.rows}>
            {data.items.map((item) => (
              <RadarRow key={item.eventRevisionId} item={item} />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <Radar size={20} />
            <p>当前没有命中冻结偏好的有效事件。</p>
            <Link href="/research-targets">管理研究关注</Link>
          </div>
        )}
      </section>
    </WorkspaceShell>
  );
}
