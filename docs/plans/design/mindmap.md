# 思维导图接入设计

## 基于开源思维导图 

- 位于 temp\mind-map

## 定位

思维导图是一种独立的记录方式，不依赖研究空间。它可以被投研收藏收纳，也可以独立存在；投研收藏与思维导图之间保持可选关联。

## 首期方案

- 使用 `simple-mind-map` 核心库提供画布和节点编辑能力。
- 在当前 Next.js/React 项目中提供页面外壳和必要的编辑操作。
- 使用现有 Prisma + PostgreSQL 保存导图数据。
- 先以整张导图数据为主要持久化单位，接口和数据结构保持可演进。

## 范围边界

首期只打通导图的创建、编辑、加载和保存，以及基本的导图列表能力。暂不实现自动保存、版本管理、大小限制、级联删除和笔记/业务对象引用。

`temp/mind-map` 中的完整 Vue 应用暂不整体迁移；其外围工具和插件不作为首期接入范围。后续根据实际使用反馈，再决定是否补充业务引用和更深的 React 原生整合。

## 交互设想

- 一张导图可以关联多个公司、行业、自选股或投研收藏；投研对象也可以反向查看相关导图。
- 后续支持节点级引用，将节点关联到笔记、报告、股票、公司或行业。
- 支持从投研对象新建或打开导图，也支持从导图关联投研对象。
- 支持在导图节点与投研对象之间双向跳转，并尽量定位到具体节点。
- 导图与投研对象保持弱绑定：对象删除不级联删除导图，导图也可以独立存在。

整图关联主要用于归档，节点引用主要用于精确表达；具体实现可分阶段推进。

## 数据库 schema 设计

MindMap
- id
- userId
- title
- description?
- data        Json      // simple-mind-map 整张数据
- config      Json?     // 可选配置
- createdAt
- updatedAt

CollectionMindMap
- collectionId
- mindMapId
- createdAt

MindMapReference
- id
- mindMapId
- nodeId?              // 为空表示整张导图关联
- targetType           // note / report / stock / company / industry / collection
- targetId
- relationType?        // reference / evidence / related 等
- createdAt