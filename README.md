# Comfy Workbench

一个用预制块组合 ComfyUI 生图请求的工作台。Python 网关负责模型和工作流，Web 工作台负责提示词、LoRA、预设、队列、相册和图片复用。两者可分别启动；Agent 通过工作台提供的 stdio MCP 使用同一套状态。

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
