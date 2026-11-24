---
name: make-paper-readable
description: 从论文生成可在浏览器里中英对照阅读和批注的本地审阅页，保留原始图表，并整理已有审阅意见。用户要求并排读论文、为论文建立双语批注工作区，或处理该工作区的批注时使用。
---

# Make Paper Readable

使用本技能目录里的 `paperbridge.py`、`review_cli.py` 和 `static/`。命令中的 `<skill>` 是本文件所在目录。使用 Python 3.10 或更高版本，例如 WSL 的 `python3` 或 Windows 的 `py -3`。

## 准备审阅稿

- 已有带段落 ID 的双语 Markdown 时直接使用。只有单语稿或 PDF、Word、LaTeX 时，先按 [双语稿格式](docs/guide.md#双语稿格式) 生成独立的双语 Markdown，保留章节、公式、表格和引文。每对中英文使用同一稳定 ID。能获取原图时引用原始图表，图表路径相对于审阅稿，并位于稿件目录内。
- 已有 PaperBridge 审阅工作区时沿用其 `config.json` 和批注数据。新建工作区时放在用户项目或输出目录，避免把审阅数据写进技能目录。用户只想体验示例时，将 `examples/demo` 复制到独立目录再启动。

## 启动审阅页

新工作区执行 `init`，随后用 `serve` 启动。路径可以包含空格。

```bash
python3 "<skill>/paperbridge.py" init "<paper.md>" --workspace "<review>"
python3 "<skill>/paperbridge.py" serve "<review>" --port 8765
```

将服务保留在后台。端口被占用时选一个空闲端口，再用浏览器或 HTTP 请求验证 `/api/paper` 返回了目标论文，最后给出实际的本地 URL 和工作区路径。双语稿可由当前助手直接生成，阅读和批注无需 API key。用户要启用网页内 AI 讨论时，按 [AI 讨论配置](docs/guide.md#可选-ai-讨论) 操作。

## 处理已有批注

读取工作区的 `REVIEW_NOTES.md`，按稳定段落 ID 定位稿件。只有在用户要求修改时才编辑指定稿件。需要回填处理结果时，通过运行中的服务使用 `review_cli.py resolve`，见 [阅读与修改](docs/guide.md#阅读与修改)。审核状态由服务保存。
