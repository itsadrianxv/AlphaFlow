export type DeliverySpec = { type?: string; targetRef?: string };

export async function deliverScheduledTask(
  spec: DeliverySpec,
  result: { title?: string; summary?: string; body?: string },
) {
  if (!spec || spec.type !== "FEISHU") return { sent: false, skipped: true };
  const webhook =
    process.env[
      `FEISHU_WEBHOOK_URL_${String(spec.targetRef ?? "DEFAULT").toUpperCase()}`
    ] ?? process.env.FEISHU_WEBHOOK_URL;
  if (!webhook) throw new Error("FEISHU_WEBHOOK_NOT_CONFIGURED");
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msg_type: "post",
      content: {
        post: {
          zh_cn: {
            title: result.title ?? "定时任务",
            content: [
              [{ tag: "text", text: result.body ?? result.summary ?? "" }],
            ],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`feishu webhook ${response.status}`);
  return { sent: true };
}
