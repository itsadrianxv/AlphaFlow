import { describe, expect, it, vi } from "vitest";
import { researchTargetNoteSchema } from "~/contracts/research-target";
import { researchTargetRouter } from "~/server/api/routers/research-target";
import { createCallerFactory } from "~/server/api/trpc";

vi.mock("~/server/auth", () => ({ auth: vi.fn() }));
vi.mock("~/server/db", () => ({ db: {} }));

const createCaller = createCallerFactory(researchTargetRouter);

const note = {
  id: "note-1",
  targetRef: { type: "company" as const, id: "company-1" },
  title: "宁德时代研究笔记",
  kind: null,
  contentMarkdown: "关注动力电池需求。",
  rawContent: null,
  source: null,
  tags: [],
  linkedMindMaps: [
    {
      id: "mind-map-1",
      title: "宁德时代研究框架",
      description: "动力电池与储能研究框架",
      nodeId: "company:300750:root",
      relationType: "research_note",
    },
  ],
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
};

describe("投研笔记关联思维导图", () => {
  it("在笔记 DTO 中保留结构化导图摘要与引用语义", () => {
    expect(researchTargetNoteSchema.parse(note).linkedMindMaps).toEqual(
      note.linkedMindMaps,
    );
  });

  it("只返回当前用户导图，并支持一条笔记关联多张导图", async () => {
    const mindMapReferenceFindMany = vi.fn(async (args: unknown) => {
      const query = args as {
        where?: { mindMap?: { userId?: string } };
      };
      const ownReferences = [
        {
          mindMapId: "mind-map-1",
          targetId: "note-1",
          nodeId: "node-1",
          relationType: "research_note",
          mindMap: {
            id: "mind-map-1",
            title: "需求与技术路线",
            description: "跟踪需求、技术和产能",
          },
        },
        {
          mindMapId: "mind-map-2",
          targetId: "note-1",
          nodeId: null,
          relationType: "evidence",
          mindMap: {
            id: "mind-map-2",
            title: "证据核验",
            description: null,
          },
        },
      ];
      const foreignReference = {
        mindMapId: "foreign-map",
        targetId: "note-1",
        nodeId: null,
        relationType: "research_note",
        mindMap: {
          id: "foreign-map",
          title: "其他用户的导图",
          description: null,
        },
      };

      return query.where?.mindMap?.userId === "user-1"
        ? ownReferences
        : [...ownReferences, foreignReference];
    });
    const caller = createCaller({
      db: {
        user: {
          findUnique: vi.fn(async () => ({
            id: "user-1",
            sessionVersion: 1,
            status: "ACTIVE",
          })),
        },
        researchNote: {
          findMany: vi.fn(async () => [
            {
              id: "note-1",
              userId: "user-1",
              targetType: "company",
              targetId: "company-1",
              title: "宁德时代研究笔记",
              kind: null,
              contentMarkdown: "关注动力电池需求。",
              rawContent: null,
              sourceJson: null,
              tags: [],
              createdAt: new Date("2026-08-04T00:00:00.000Z"),
              updatedAt: new Date("2026-08-04T00:00:00.000Z"),
            },
          ]),
        },
        mindMapReference: { findMany: mindMapReferenceFindMany },
      },
      session: {
        user: { id: "user-1", sessionVersion: 1 },
        expires: "2099-01-01T00:00:00.000Z",
      },
      headers: new Headers(),
    } as never);

    const result = await caller.listNotes({ limit: 20, offset: 0 });

    expect(result[0]?.linkedMindMaps.map((mindMap) => mindMap.id)).toEqual([
      "mind-map-1",
      "mind-map-2",
    ]);
    expect(mindMapReferenceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          targetType: "note",
          targetId: { in: ["note-1"] },
          mindMap: { userId: "user-1" },
        },
      }),
    );
  });
});
