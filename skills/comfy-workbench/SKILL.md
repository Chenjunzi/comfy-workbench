---
name: comfy-workbench
description: 使用已注册的 Comfy Workbench MCP 检查当前网页配置、操作预制块、复用来源 PNG 预设和提交生图任务。适用于操作已部署的工作台，不用于直接编辑 ComfyUI 节点或数据库。
---

先从宿主的 MCP 工具列表确认所需的 `comfy_*` 工具可见。Skill 不会注册服务：MCP 是宿主启动的 stdio 子进程，5173 是工作台 HTTP 地址。若工具缺失，按仓库 README 和宿主的 MCP 配置重新连接；不要改用直接写文件的方式。

- **代用户操作当前工作台：** 调用 `comfy_get_current_workbench`，核对模型、尺寸、已选块、提示词、采样和放大链。用选择或自定义提示词工具修改用户指定的字段，再读回核对。需要生图时调用 `comfy_generate_current_workbench({})`，不自行重建请求。用 `comfy_get_generation_status` 和 `comfy_list_recent_generations` 查结果。
- **维护块库：** 先用 `comfy_list_preset_blocks` 搜索重复项，按唯一 ID 操作。用 `comfy_list_loras` 的 query 查具体 LoRA，用 `comfy_list_models` 核实实际模型 key。遇到保存冲突时重新读取目标，把差异告诉用户；不循环强制覆盖。
- **复用预览：** 缩略图不等于带预设的原图。先用 `comfy_read_block_source_preset` 验证来源，再用 `comfy_generate_from_block_preset` 的 dry_run 核对块和请求。真实生成默认可能回写目标块；只要生成结果时传 `savePreview: false`。
- **发送原图：** 用 `comfy_download_block_source_image` 取得 MCP 主机上的受控缓存文件，再交给宿主的图片附件发送能力。不要把路径作为图片发给用户，也不要把缩略图冒充原图。

远程 Agent 使用专用 member 密匙。要与用户看到同一工作台，应由 owner 将该密匙绑定到对应工作区；不要读取或传播 owner 密匙。
