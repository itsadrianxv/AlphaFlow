import { z } from "zod";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";

const resultSchema = z.object({ scheduledTaskSetup: z.boolean() });
const creationSignal =
  /(创建|新建|设置|设定|帮我|给我).{0,12}(定时|提醒|每天|每周|交易日|定期|收盘后|开盘前)|(?:每天|每周|每个交易日|定期|收盘后|开盘前).{0,24}(发送|推送|提醒|整理|查询|获取|生成)/;
const managementOnly =
  /(查看|列出|有哪些|暂停|恢复|取消|删除).{0,10}(定时任务|提醒)/;
const ambiguousSignal =
  /(定时|提醒|周期|每天|每周|交易日|收盘后|开盘前|持续关注)/;

export class ScheduledTaskIntentRouter {
  constructor(private readonly client = new DeepSeekClient()) {}

  async shouldEnterSetup(prompt: string) {
    const normalized = prompt.trim();
    if (managementOnly.test(normalized) && !creationSignal.test(normalized))
      return false;
    if (creationSignal.test(normalized)) return true;
    if (!ambiguousSignal.test(normalized) || !this.client.isConfigured())
      return false;
    try {
      const result = await this.client.completeContract(
        [
          {
            role: "system",
            content:
              "判断用户是否明确要求创建一个未来会重复执行的数据查询、提醒或消息推送任务。只分类创建意图；咨询、查看、暂停、取消现有任务返回 false。",
          },
          { role: "user", content: normalized.slice(0, 2000) },
        ],
        { scheduledTaskSetup: false },
        resultSchema,
        { maxOutputTokens: 40, timeoutMs: 15_000 },
      );
      return result.scheduledTaskSetup;
    } catch {
      return false;
    }
  }
}
