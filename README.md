<p align="center">
  <img src="build/icon.png" alt="素笺应用图标" width="76">
</p>

<h1 align="center">素笺 Sujian</h1>

<p align="center"><strong>在排好版的 Markdown 里直接写作。</strong></p>
<p align="center">直接打开本地 .md 文件，从写提纲到导出都在同一个窗口完成。</p>
<p align="center"><a href="https://github.com/peterwangze/sujian-markdown/releases/tag/v1.0.0"><strong>下载 v1.0.0 离线安装包</strong></a> · Windows / macOS / Linux</p>

![素笺暖白主题下的单栏即时编辑。左侧是本地文件树，正文展示标题、提纲、引用和表格。](docs/images/sujian-writing.png)

## 从第一行写到交稿

- **输入时就看见排版。** 标题、任务列表和表格随输入在原处呈现。需要精确修改标记时切到源码，需要对照时打开分栏预览，定稿后可以进入阅读模式。
- **把整组文档放在手边。** 在标签页之间切换，从大纲跳到章节，用工作区搜索找到散在不同文件里的内容。长文档自动进入源码模式，便于滚动和查找。
- **关窗后还能接着写。** 重启后可以从侧栏恢复未保存的草稿。文件被其他程序改动时，冲突面板会显示磁盘版本，也可以把正在编辑的内容另存成副本。
- **断网也能导出成品。** 本地公式和 Mermaid 图表可离线渲染。安装包内置 Pandoc，可导出 PDF、HTML、PNG 长图、Word、EPUB 和 Reveal.js 幻灯片等格式。

## 给正文留出空间

暖白底色和衬线正文让文章易于通读，文件树与工具栏集中在页面边缘。可以调节字号和文档宽度，切到深墨主题，或隐藏侧栏。专注模式淡化周围段落，打字机模式让当前行保持在视野中。

![素笺深墨主题下的分栏预览。左边是大纲和 Markdown 源码，右边渲染了公式与 Mermaid 流程图。](docs/images/sujian-split.png)

*两张截图均来自 Windows 客户端，使用示例 Markdown 文档。*

## 下载与安装

| 系统 | x64 / Intel | ARM64 / Apple 芯片 |
| --- | --- | --- |
| Windows | [EXE](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/Sujian-1.0.0-win-x64.exe) | [EXE](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/Sujian-1.0.0-win-arm64.exe) |
| macOS 13+ | [DMG](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/Sujian-1.0.0-mac-x64.dmg) | [DMG](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/Sujian-1.0.0-mac-arm64.dmg) |
| Linux | [AppImage](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/Sujian-1.0.0-linux-x86_64.AppImage) · [DEB](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/Sujian-1.0.0-linux-amd64.deb) | [AppImage](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/Sujian-1.0.0-linux-arm64.AppImage) · [DEB](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/Sujian-1.0.0-linux-arm64.deb) |

- **Windows** 双击 EXE 安装。安装包未做 Authenticode 签名。ARM64 版的 Pandoc 使用 Windows 11 的 x64 仿真。
- **macOS** 挂载 DMG 后，将素笺拖到“应用程序”。此版本采用临时签名，首次启动时可能需要在“隐私与安全性”中允许打开。[Apple 打开应用说明](https://support.apple.com/en-us/102445)
- **Linux** 赋予 AppImage 执行权限后打开，或通过软件包管理器安装 DEB。运行依赖发行版提供的 Chromium 系统库。

安装包包含应用运行时、渲染资源与 Pandoc。六种系统与架构组合均通过成品启动检查。[SHA-256 清单](https://github.com/peterwangze/sujian-markdown/releases/download/v1.0.0/SHA256SUMS.txt) · [构建与验证记录](https://github.com/peterwangze/sujian-markdown/actions/runs/42973566980)

## 开发与兼容范围

使用 Node.js 24。

```sh
npm ci
npm run build
npm start
```

运行 `npm test` 执行自动化回归。使用 `npm run package -- win32 x64` 构建 Windows x64 离线安装包，也可指定 `darwin` 或 `linux` 和对应架构。

素笺以 Typora 1.14.x 的公开功能为调研基线。传统编码、MathJax 扩展、多版本历史和部分系统集成仍有兼容差异。[功能对照与验收记录](docs/compatibility.md)
