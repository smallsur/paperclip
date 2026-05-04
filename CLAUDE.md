# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Paperclip 是一个面向 AI-agent 公司的开源控制平面。它通过组织架构图、预算管理、治理规则和基于任务的协调机制来编排 AI agent 团队。修改代码前请先阅读 `doc/GOAL.md`、`doc/PRODUCT.md` 和 `doc/SPEC-implementation.md`。

## 常用命令

```sh
pnpm install                  # 安装依赖
pnpm dev                      # 启动开发环境（API + UI，watch 模式）— http://localhost:3100
pnpm dev:once                 # 启动开发环境（不监听文件变化）
pnpm build                    # 构建所有 workspace 包
pnpm typecheck                # 全量类型检查
pnpm test                     # 运行 Vitest 单元测试
pnpm test:watch               # Vitest watch 模式
pnpm test:e2e                 # Playwright E2E 测试
pnpm db:generate              # 从 schema 变更生成数据库迁移
pnpm db:migrate               # 执行迁移
```

重置本地开发数据库：`rm -rf data/pglite && pnpm dev`

运行单个测试：`pnpm vitest run -t "测试名称匹配"` 或通过 `--project server` 指定项目。

## 架构

**pnpm monorepo**，包含以下 workspace：

- `server/` — Express REST API 和编排服务（端口 3100）
- `ui/` — React + Vite 看板 UI
- `cli/` — Paperclip CLI 工具
- `packages/db/` — Drizzle ORM schema、迁移文件、PGlite（开发）/ PostgreSQL（生产）客户端
- `packages/shared/` — 共享类型、常量、验证器、API 路径常量
- `packages/adapters/` — agent 适配器实现（claude-local、codex-local、cursor-local、gemini-local、opencode-local、acpx-local、pi-local、openclaw-gateway）
- `packages/adapter-utils/` — 共享适配器工具
- `packages/plugins/` — 可扩展的适配器插件系统
- `packages/mcp-server/` — MCP server 实现

**核心架构不变量：**
- 单分配任务模型，原子化 issue checkout
- 所有实体按公司（company）隔离，边界在路由/服务层强制执行
- Agent 通过哈希 bearer API key 访问；board 为完全控制权限
- 预算耗尽自动暂停
- 所有变更操作必须记录活动日志

## 契约同步

修改 schema 或 API 行为时，必须同步更新所有相关层级：

1. `packages/db` schema 和导出
2. `packages/shared` 类型/常量/验证器
3. `server` 路由/服务
4. `ui` API 客户端和页面

## 数据库变更流程

1. 编辑 `packages/db/src/schema/*.ts`
2. 确保新表从 `packages/db/src/schema/index.ts` 导出
3. 运行 `pnpm db:generate`（会先编译 `packages/db`，再生成迁移）
4. 用 `pnpm -r typecheck` 验证

## API 规范

- 基础路径：`/api`
- 统一 HTTP 错误码：`400/401/403/404/409/422/500`
- 新增端点必须：执行公司访问检查、强制执行操作者权限（board vs agent）、为变更操作写入活动日志

## 验证

日常开发先运行最小范围的检查。PR 提交前或大范围变更时运行完整检查：

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

E2E/浏览器测试按需运行：`pnpm test:e2e`、`pnpm test:release-smoke`。

## PR 要求

所有 PR 必须使用 `.github/PULL_REQUEST_TEMPLATE.md` 模板，每个章节都必须填写：Thinking Path（思考路径）、What Changed（变更内容）、Verification（验证方式）、Risks（风险）、Model Used（使用的模型）、Checklist（检查清单）。Greptile 评分必须达到 5/5 并解决所有评论。

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
