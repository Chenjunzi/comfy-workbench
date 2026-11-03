# Comfy Workbench

Comfy Workbench 把常用的提示词和 LoRA 存成可复用的块。选一个人物、换一套服装、加一个场景，就能用新的组合生成图片；想沿用上一张图的设置时，也可以从输出 PNG 读回工作台预设。它适合反复比较组合、参数和模型效果，不需要每次在 ComfyUI 节点图里重新接线。

## 工作台能做什么

| 功能 | 使用方式 |
| --- | --- |
| 分类块库 | 按人物、服装、姿势、背景等分类挑选，也可新增类目。一个块可包含多条正负提示词、多个 LoRA 及各自权重、备注和预览图。支持搜索、折叠、复制、右键编辑、已选块拖动排序。 |
| 模型与采样 | 从网关读取可用模型和 LoRA，按 IL、Anima、K2、MOSS 标签筛选 LoRA。基础宽高支持等比升降档；放大区按模型能力显示适用阶段及预计尺寸。 |
| 生图与调试 | 在块后追加临时自定义提示词，查看组合结果和请求参数。先用 Dry Run 检查工作流，再提交生成；当前任务与等待队列分开显示。 |
| 模型专用选项 | K2 支持潜空间高清重绘及可选 USD 放大；MOSS 支持 DMD、OmniSR 或 SeedVR2。支持修脸的模型可单独调整重绘参数。可用项取决于网关报告的节点与模型依赖。 |
| 图片与预设复用 | 保存或覆盖整套生成预设。工作台生成的 PNG 可携带块选择和参数：拖到左栏读取整套预设，拖到中栏只读取已选块和自定义提示词。小相册支持原图预览、翻页，以及带或不带种子的预设读取。 |
| 数据与协作 | 服务端用 SQLite 保存块库、预设和历史，预览图片作为资源文件保存。块编辑使用版本检查提示冲突；访问密匙区分用户身份与权限。 |
| Agent 操作 | Agent 可通过 MCP 读取当前工作台、调整已选块，然后按页面显示的参数提交生图，也能维护块库和复用 PNG 预设。 |

## 第一次使用

1. 按下方说明启动网关和工作台，登录后点右上角刷新，选择本机已安装的模型。
2. 在分类末尾点 **新增预制块**，填写名称和提示词，保存后点卡片选中。需要临时改词时，在中栏自定义提示词框填写即可。
3. 在左栏设定尺寸和采样参数，在右栏点 **Dry Run**。核对请求后点 **提交生图**，结果会出现在小相册中。
4. 想从某张结果继续调整时，右键相册图片，选 **使用此图片预设** 或 **使用此图片预设＋种子**。这需要图片里有工作台预设元数据；普通图片不一定有。

## 项目结构

| 目录 | 用途 |
| --- | --- |
| `agent_comfy_gateway/` | 本机 HTTP 网关、工作流构建器、测试及可选的图片描述工具 |
| `workbench/` | React 界面、SQLite 后端、图片资源缓存、MCP 和测试 |
| `scripts/` | Windows 启动入口与发布源码同步工具 |

## 本机启动（Windows）

先安装并启动 ComfyUI。默认地址为 `http://127.0.0.1:8188`。模型、LoRA、第三方节点和权重不随本仓库分发。`GET /models` 的安装状态与节点依赖用于确认本机能跑哪些工作流。需要修脸测量节点时，将 `agent_comfy_gateway/measured_detailer.py` 复制为 ComfyUI 的 `custom_nodes/measured_detailer.py` 并重启 ComfyUI；还需安装模型能力中列出的 Impact Pack、检测模型等依赖。

以下命令从仓库根目录运行。使用 Python 3.11+ 和 Node.js 22.23.1+（或 Node 24）；首次安装工作台依赖：

```powershell
npm.cmd ci --prefix workbench
```

打开两个 PowerShell 窗口，分别设置 **自己的 ComfyUI 程序目录**（包含 `models/` 和 `output/`，不是整合包外层目录），再启动：

```powershell
# 窗口一
$env:COMFY_ROOT = 'D:\Apps\ComfyUI'
python -m agent_comfy_gateway.server

# 窗口二
$env:COMFY_ROOT = 'D:\Apps\ComfyUI'
.\scripts\start-workbench.cmd
```

打开 [本机工作台](http://127.0.0.1:5173/)。首次启动会创建 `workbench/data/access-keys.txt`，在本机用其中的 owner 密匙登录。网关默认只监听 `127.0.0.1:8765`；本地工作台默认也只监听回环地址。如果 ComfyUI 使用自定义输出目录，将工作台的 `COMFY_PRESET_OUTPUT_DIR` 指向对应目录。可选的图片描述依赖应安装在运行网关的 Python 环境内，视频工具需要独立安装；无需为基本生图安装这些组件。

MCP 为 **stdio**：在客户端注册 `node workbench/mcp/comfy-preset-mcp.mjs`（使用绝对路径），配置 `COMFY_PRESET_WORKBENCH_URL` 和 `COMFY_PRESET_ACCESS_KEY`。客户端另机部署时需同时复制 `workbench/shared/`，使用已授权工作台地址和专用 member 密匙；无需开放网关端口。示例见 [AstrBot 配置](workbench/docs/examples/astrbot-linux-mcp_server.json)。

## 验证

```powershell
python -m unittest discover -s agent_comfy_gateway/tests
npm.cmd run build --prefix workbench
npm.cmd run lint --prefix workbench
npm.cmd test --prefix workbench
```

服务启动后可查 `http://127.0.0.1:8765/health`，并使用工作台 **Dry Run** 核对请求，不提交出图。K2/Anima 和 MOSS 修脸契约见 [FACE_OPTIONS.md](agent_comfy_gateway/FACE_OPTIONS.md) 和 [MOSS_OPTIONS.md](agent_comfy_gateway/MOSS_OPTIONS.md)。

## 从开发目录同步

日常继续在原开发目录改代码。从发布仓库运行（参数是同时包含 `agent_comfy_gateway/` 和 `comfy-preset-workflow-ui/` 的目录）：

```powershell
python scripts/sync_release.py 'D:\Development\ComfyUI' --diff
python scripts/sync_release.py 'D:\Development\ComfyUI' --apply
git diff
```

不加 `--apply` 时不写文件。脚本按清单导入源码、锁文件和测试，对本机示例路径执行相同的发布转换，保留本仓库的 README、启动说明和 Git 历史。清单之外的新目录或依赖需先审查再加入。对发布侧单独做的代码修复，优先合回开发目录或写入发布转换，避免下次导入丢失。同步后运行上述验证，再自行提交或推送。运行数据库、密匙、模型、图片与试跑结果不进入 Git。

此版本暂未指定开源许可证；公开发布前由维护者决定授权方式。
