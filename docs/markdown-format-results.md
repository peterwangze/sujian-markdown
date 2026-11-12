# Markdown 格式兼容实测

[打开验收样例](markdown-format-qa.md)

用例来自外部规范和工具文档，按读写仓库 README、维护运维手册、迁移知识库和交付研究报告四个场景编写。样例把输入、预期和依据放在同一处，便于用同一份文件比较不同工具。Markdown 方言持续扩展，本次基线是 CommonMark 0.31.2、正式 GFM 扩展样例和主流文档工具的代表性用法。[CommonMark](https://spec.commonmark.org/0.31.2/) · [GFM](https://github.github.com/gfm/) · [GitHub 写作](https://docs.github.com/en/get-started/writing-on-github) · [Typora](https://support.typora.io/Markdown-Reference/) · [Obsidian](https://help.obsidian.md/syntax) · [Pandoc](https://pandoc.org/MANUAL.html#pandocs-markdown) · [Quarto](https://quarto.org/docs/authoring/markdown-basics.html)

## 规范样例

使用实际安装包所用的 Lute 解析器，在 Electron 中切换对应方言开关，比对官方期望的 HTML。忽略换行编码和空元素的闭合斜杠。桌面应用额外应用 HTML 清理、软换行和排版设置。

| 官方样例 | 匹配 | 仍有差异 |
| --- | --- | --- |
| CommonMark 0.31.2 全部样例 | 651 / 652 | #540 的引用标签 `ẞ` 与 `SS` 在引擎中未匹配。 |
| GFM 0.29 五类扩展全部样例 | 23 / 28 | #493 三连波浪线的删除线边界，#633–635 裸 `mailto:` 和 `xmpp:` 链接，#657 原始 HTML 标签过滤。该项比较引擎输出，素笺预览另有 HTML 清理。 |

## 桌面端修复与复测

在 Windows x64 启动 Electron，打开同一份样例，实际切换即时、分栏和阅读视图并导出。断网条件下检验本地图片和图表。样例打开后直接保存，文件字节一致。分栏和阅读核对了标题层级、列表嵌套、硬换行、表格与任务、警示块、脚注、目录和 HTML 折叠。

v1.4.0 验收的 PDF 共 14 页，提取文本核对了正文、表格、行内公式附近的文字、清单中的图表和文末标记。额外的 Word 回读样例覆盖了 YAML 标题内的公式、带属性的公式围栏，以及约 2 MB 文档的首尾内容和公式。

| 从真实文档发现的问题 | 修复与观察结果 |
| --- | --- |
| GitHub 风格章节链接、中文标题、重复标题和手写 HTML 锚点跳转失效 | 按 GitHub 标题规则生成目标，识别手写 HTML 锚点和 Pandoc 显式标题 ID。即时编辑用 Ctrl 或 ⌘ 点击，分栏和阅读可直接点击。保留无冲突的旧锚点。 |
| Pandoc 带属性的代码围栏、Quarto 代码单元打开语言选择器时显示不正确 | 识别语言并高亮。确认现有语言保留原文，显式更换语言保留代码块的其他属性及代码单元选项。实际混合普通输入、修改语言、撤销和重做，核对了保存结果。 |
| GitHub 行内数学分隔符中的反引号变成公式字符，`math` 围栏在 Word 中成为代码 | 即时编辑、分栏、阅读和 HTML 正确排版，Word 与 EPUB 回读确认行内公式和显示公式。 |
| 引用或清单中的 Mermaid 导出漏图，后面的图可能错配 | 根据结构和源内容匹配图表。Word、EPUB 回读确认九张图均保留，嵌套图仍位于引用或清单中。 |
| `dot` 图表显示为源码，同一文档含多个 Graphviz 时抛出渲染异常 | `dot` 和 `graphviz` 可在同一份文档中离线渲染。 |
| 即时编辑的 `Shift+Enter` 换行会在继续输入时丢失，代码块复制按钮受内容安全策略拦截 | 在段落、引用和清单项中输入并保存，预览保持断行。复制按钮经过桌面桥接传出代码文本。 |

## v1.4.1 HTML 复测

在 Windows x64 用同一份样例核对了即时编辑、分栏、阅读及独立 HTML 文件。行内上下标、高亮、下划线、粗斜体、删除线、代码、键帽及 Ruby 注音均有运行结果。安全内联 CSS 保留了实际颜色、字号、纯色背景与对齐。HTML 输出继续拦截脚本、事件属性、iframe 和可加载外部资源的 CSS。审阅预览继续清理文档提供的样式。

纯 HTML 和 HTML 与 Markdown 混排的折叠块都可展开与收起。样例包含分离的摘要行、嵌套折叠、默认展开的内层、折叠区里的标题和清单，以及紧贴关闭标签的内外 HTML 段落。即时编辑验证了鼠标、Enter、空格及章节链接，保存后源码字节一致。补充验证覆盖了在行内标签中输入中文、撤销和重做。[Typora HTML 支持](https://support.typora.io/HTML/) · [GitHub 折叠区](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections)

## 当前兼容边界

- Obsidian 的 `[[双链]]`、块引用及跨笔记嵌入需要笔记库解析。Pandoc 定义列表、围栏 Div、文献引文，以及 Quarto 交叉引用和可执行单元需要对应发布工具。样例可在素笺打开、查看源码与保存。
- 中文标点紧贴裸 URL 时，Lute 与 Pandoc 的 GFM 解析均可能把标点和后续文本当成网址一部分。使用带尖括号的自动链接或普通 Markdown 链接可明确边界。
- KaTeX 支持范围与 MathJax 有差异。Windows x64 实测覆盖本文格式，macOS 与 Linux 的安装包启动另由发布流程验证。

## 复现

```sh
npm ci
npm run build
node scripts/check-markdown-spec.mjs
node scripts/check-markdown-desktop.mjs
node scripts/check-html-desktop.mjs
```

规范脚本默认读取两个上游公开样例，也可传入本地副本。桌面脚本用已下载到 `build/pandoc` 的当前平台 Pandoc，或 `SUJIAN_PANDOC` 指定的二进制文件回读导出产物。测试文件和导出保存在脚本输出的临时目录。
