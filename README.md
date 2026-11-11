<p align="center">
  <img src="build/icon.png" alt="素笺应用图标" width="76">
</p>

<h1 align="center">素笺 Sujian</h1>

<p align="center"><strong>写作时看见排版，改稿时看清变化。</strong></p>
<p align="center">在素笺直接编辑本地 Markdown，逐处采纳 AI 改稿，再保存原文件或离线导出。</p>
<p align="center"><a href="https://github.com/peterwangze/sujian-markdown/releases/tag/v1.1.0"><strong>下载 v1.1.0 离线安装包</strong></a> · Windows / macOS / Linux</p>

![素笺的修订审阅界面。左侧是当前稿，右侧是仅应用已采纳改动后的排版。](docs/images/sujian-review.png)

*审阅发布说明时，可以只采纳版本号变更，保留原有下载信息。截图来自 Windows 客户端。*

## 写技术文档、审改稿、交付定稿

- **审一份 AI 改过的发布说明。** 把候选稿放进素笺，查看源码增删和排版效果。保留原来的下载链接，只采纳核实过的改动。仓库文档还可以和本机 Git 版本做只读对照。
- **让规格、任务和验收证据对得上。** 用「规格与验收」模板建立一组普通 Markdown 文件。打开相关文档后，在 **文档与视图 → 检查规格与验收** 中查找重复编号、未关联的需求、找不到的验收项和缺少证据链接的任务。
- **把会议结论整理成可核对的跟进稿。** 用「纪要与跟进」模板记录决定、负责人和截止日期。给结论附上已保存文档的相对来源链接，在阅读或分栏预览中点击即可跳到原文行。确认后可导出 Word 或 PDF。

## 和现有 AI 工具一起使用

1. 打开原文，选择 **文档与视图 → 审阅修订稿 → 复制底稿**。用你习惯的 AI 工具改稿，再粘贴完整候选稿或选取文件。候选稿基于更早的版本时，使用 **选择旧底稿**。
2. 在源码差异里逐处采纳或跳过。打开 **排版预览 → 只预览已采纳的改动**，确认应用后的效果。有重叠修改时，界面会并列显示底稿、当前稿和候选稿。
3. 应用后继续编辑、保存或导出。改动先进入当前文档，并沿用已有保存设置。文档内容尚未再次变化时，可以选择 **文档与视图 → 撤销本次审阅**。

AI 生成由你选择的外部工具完成。素笺在本机进行审阅、比较与导出。涉及外部媒体和自定义图表配置的改动可在源码差异中核对。

## 从第一行写到交稿

![素笺暖白主题下的单栏即时编辑。左侧是本地文件树，正文展示标题、提纲、引用和表格。](docs/images/sujian-writing.png)

- **输入时就看到正文效果。** 标题、任务列表和表格随输入呈现。可以切换到源码、分栏预览和阅读模式。写长文时可调整字号与正文宽度，并开启专注或打字机模式。
- **把多份文档放在手边。** 用标签页切换文件，从大纲跳到章节，在工作区里跨文件搜索。长文档自动进入源码模式，便于滚动和查找。
- **保住正在写的内容。** 重启后可以从侧栏恢复未保存的草稿。磁盘文件有外部改动时，可以对照磁盘版本，并把正在编辑的内容另存成副本。
- **断网也能导出成品。** 本地公式和 Mermaid 图表可离线渲染。安装包内置 Pandoc，支持 PDF、HTML、PNG 长图、Word、EPUB 和 Reveal.js 幻灯片等格式。

![素笺深墨主题下的分栏预览。左边是大纲和 Markdown 源码，右边渲染了公式与 Mermaid 流程图。](docs/images/sujian-split.png)

## 从 Git 和终端进入素笺

安装本机 Git 后，可在已打开的仓库文档中使用 **Git 比较**，读取 `HEAD`、分支、标签或提交版本作对照。外部工具也可以直接打开文档的指定行，或把候选稿交给审阅界面。以下以 Linux DEB 为例。

```sh
/opt/Sujian/sujian open "docs/验收记录.md" --line 12
/opt/Sujian/sujian review "CHANGELOG.md" --candidate "候选 发布说明.md"
```

Windows 使用安装目录中的 `Sujian.exe`。macOS 使用 `/Applications/Sujian.app/Contents/MacOS/Sujian`。Linux AppImage 可直接传入相同的参数。

## 下载与安装

| 系统 | x64 / Intel | ARM64 / Apple 芯片 |
| --- | --- | --- |
| Windows | [EXE](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/Sujian-1.1.0-win-x64.exe) | [EXE](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/Sujian-1.1.0-win-arm64.exe) |
| macOS 13+ | [DMG](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/Sujian-1.1.0-mac-x64.dmg) | [DMG](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/Sujian-1.1.0-mac-arm64.dmg) |
| Linux | [AppImage](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/Sujian-1.1.0-linux-x86_64.AppImage) · [DEB](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/Sujian-1.1.0-linux-amd64.deb) | [AppImage](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/Sujian-1.1.0-linux-arm64.AppImage) · [DEB](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/Sujian-1.1.0-linux-arm64.deb) |

- **Windows** 双击 EXE 安装。安装包未做 Authenticode 签名。ARM64 版的 Pandoc 使用 Windows 11 的 x64 仿真。
- **macOS** 挂载 DMG 后，将素笺拖到“应用程序”。此版本采用临时签名，首次启动时可能需要在“隐私与安全性”中允许打开。[Apple 打开应用说明](https://support.apple.com/en-us/102445)
- **Linux** 赋予 AppImage 执行权限后打开，或通过软件包管理器安装 DEB。运行依赖发行版提供的 Chromium 系统库。

安装包包含应用运行时、渲染资源与 Pandoc。六种系统与架构组合均通过成品启动检查。[SHA-256 清单](https://github.com/peterwangze/sujian-markdown/releases/download/v1.1.0/SHA256SUMS.txt) · [构建与验证记录](https://github.com/peterwangze/sujian-markdown/actions/workflows/release.yml)

## 开发与兼容范围

使用 Node.js 24。

```sh
npm ci
npm run build
npm start
```

运行 `npm test` 执行自动化回归。使用 `npm run package -- win32 x64` 构建 Windows x64 离线安装包，也可指定 `darwin` 或 `linux` 和对应架构。

用户可见的特性与 README 在同一次变更中更新。[开发规范](AGENTS.md)

素笺以 Typora 1.14.x 的公开功能为调研基线。传统编码、MathJax 扩展、多版本历史和部分系统集成仍有兼容差异。[功能对照与验收记录](docs/compatibility.md)
