<p align="center">
  <img src="build/icon.png" alt="素笺应用图标" width="76">
</p>

<h1 align="center">素笺 Sujian</h1>

<p align="center"><strong>在排好版的 Markdown 里直接写作。</strong></p>
<p align="center">直接打开本地 .md 文件，从写提纲到导出都在同一个窗口完成。</p>
<p align="center"><a href="https://github.com/peterwangze/sujian-markdown/releases/tag/v1.1.0"><strong>下载 v1.1.0 离线安装包</strong></a> · Windows / macOS / Linux</p>

![素笺暖白主题下的单栏即时编辑。左侧是本地文件树，正文展示标题、提纲、引用和表格。](docs/images/sujian-writing.png)

## 从第一行写到交稿

- **输入时就看见排版。** 标题、任务列表和表格随输入在原处呈现。需要精确修改标记时切到源码，需要对照时打开分栏预览，定稿后可以进入阅读模式。
- **把整组文档放在手边。** 在标签页之间切换，从大纲跳到章节，用工作区搜索找到散在不同文件里的内容。长文档自动进入源码模式，便于滚动和查找。
- **关窗后还能接着写。** 重启后可以从侧栏恢复未保存的草稿。文件被其他程序改动时，冲突面板会显示磁盘版本，也可以把正在编辑的内容另存成副本。
- **逐处核对 AI 改稿。** 对照源码和排版，采纳确认过的段落，保留原有链接与其他内容。候选稿可以来自任意能输出 Markdown 的工具。
- **断网也能导出成品。** 本地公式和 Mermaid 图表可离线渲染。安装包内置 Pandoc，可导出 PDF、HTML、PNG 长图、Word、EPUB 和 Reveal.js 幻灯片等格式。

## 给正文留出空间

暖白底色和衬线正文让文章易于通读，文件树与工具栏集中在页面边缘。可以调节字号和文档宽度，切到深墨主题，或隐藏侧栏。专注模式淡化周围段落，打字机模式让当前行保持在视野中。

![素笺深墨主题下的分栏预览。左边是大纲和 Markdown 源码，右边渲染了公式与 Mermaid 流程图。](docs/images/sujian-split.png)

*两张截图均来自 Windows 客户端，使用示例 Markdown 文档。*

## 和现有 AI 工具一起使用

![素笺审阅发布说明的界面。左右对照当前稿和采纳后的排版，只采用版本号变更，保留原有下载信息。](docs/images/sujian-review.png)

1. 打开原文，选择 **文档与视图 → 审阅修订稿 → 复制底稿**。用你习惯的工具改稿，再把完整候选稿粘贴回素笺或选取文件。如果候选稿基于更早的文件，先选择 **旧底稿**。
2. 按块采纳或跳过，切换到 **排版预览 → 只预览已采纳的改动** 检查结果。内容冲突会列出底稿、当前稿和候选稿，供你核对。
3. 应用后继续编辑、保存或导出。采纳的改动进入当前编辑缓冲，并沿用你已有的保存设置。若之后文档内容尚未变化，可在 **文档与视图 → 撤销本次审阅** 撤销。

**Git 比较**在已打开的仓库文档中读取 `HEAD`、分支、标签或提交版本作对照。需要本机 Git，比较过程只读。审阅预览使用本地渲染资源，外部媒体与自定义图表配置可在源码差异中核对。

**从模板创建文档**提供「规格与验收」及「纪要与跟进」。打开相关规格和任务后，**检查规格与验收**会提示重复编号、未关联的需求、找不到的验收项及缺少证据链接的任务。已保存文档之间可以插入相对来源链接，在阅读或分栏预览中点击链接定位来源行。

外部工具可以调用桌面程序打开指定行，或把候选稿直接交到审阅界面。以下以 Linux DEB 为例。

```sh
/opt/Sujian/sujian open "docs/验收记录.md" --line 12
/opt/Sujian/sujian review "CHANGELOG.md" --candidate "候选 发布说明.md"
```

Windows 使用安装目录中的 `Sujian.exe`。macOS 使用 `/Applications/Sujian.app/Contents/MacOS/Sujian`。Linux AppImage 可直接传入相同的参数。审阅、比较和导出都可在本机完成，AI 生成过程由你使用的外部工具处理。

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

素笺以 Typora 1.14.x 的公开功能为调研基线。传统编码、MathJax 扩展、多版本历史和部分系统集成仍有兼容差异。[功能对照与验收记录](docs/compatibility.md)
