# 给维护此仓库的 Agent

这是可发布的源码副本。网关构建 ComfyUI 工作流，工作台负责组合请求、保存状态和展示结果。要用工具操作正在运行的工作台，见 [运行时 Skill](skills/comfy-workbench/SKILL.md)。

## 修改位置

- 改模型能力、加载器或节点连接：从 `agent_comfy_gateway/server.py` 和同目录测试入手。通过 Gateway 的 `/models` 验证模型 key、默认值和可用依赖，不根据文件名猜工作流。
- 改界面或请求：一起检查 `workbench/src/`、`workbench/server/`、`workbench/shared/` 和 `workbench/mcp/`。同一个生成选项应能随 UI 草稿、生成预设和 PNG 回读；浏览器与 MCP 应组合出相同参数。
- 改数据：浏览器与 MCP 都走受鉴权的工作台 API。块修改使用操作队列和实体 revision，冲突要呈现给用户。不要手改运行中的 SQLite 或旧 JSON。

## 验证与发布

根目录 README 列出了构建和测试命令。远程工作台测试使用临时数据库、临时图片和模拟网关；验证模型节点时优先 dry-run。需要加载真实大模型或修改真实块库时，先确认任务确实要求该操作。

网关默认只监听回环地址。远程 Agent 通过工作台的受保护 API 使用网关，不需要开放 8765。访问密匙只通过宿主环境提供，不写进示例、日志、提交或聊天。

从私人开发目录导入改动前，先预览 `scripts/sync_release.py --diff`。检查实际待提交文件，并在提交前运行测试。模型、输出、预览缓存、数据库、备份、访问密匙和个人诊断结果不属于发布内容。
