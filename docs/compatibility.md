# Typora 功能对照与验收计划

调研日期为 2026-11-11。以 Typora 稳定系列 1.14.x 的公开功能作为对照。Typora 的公开仓库用于问题反馈，应用由其团队开发并以商业软件分发。[1.14 更新说明](https://support.typora.io/What's-New-1.14/) · [官方支持索引](https://support.typora.io/) · [Typora 项目说明](https://github.com/typora/typora-issues)

## 功能矩阵

优先级只表示实现顺序。每行需要通过相应验收才可标记为通过，表内功能目前均为验收目标。

| 优先级 | 功能 | 对照范围与验收 |
| --- | --- | --- |
| P0 | 单栏即时编辑 | 用鼠标或键盘进入任意段落，当前内容原位可编辑。输入标题、强调、链接、代码、列表和引用后查看渲染。在同一文档切换实时、源码和阅读视图，检查选区、撤销栈、滚动位置和源文本。用中日韩输入法在普通段落、表格、链接、公式和 YAML 测试组合输入。[快速入门](https://support.typora.io/Quick-Start/) |
| P0 | Markdown 兼容 | CommonMark 和 GFM，包括嵌套列表、任务、围栏代码高亮、表格、删除线和自动链接。Typora 扩展包括 YAML、引用式链接、脚注、`[TOC]`、emoji、标亮、上下标、行内和块级公式及常见 HTML。打开并保存未修改的样本，验证字节一致。编辑一处再检查其它语法与空白。[语法参考](https://support.typora.io/Markdown-Reference/) · [YAML](https://support.typora.io/YAML/) · [HTML](https://support.typora.io/HTML/) |
| P0 | 图形化编辑 | 选区工具栏、菜单、键盘和右键菜单可发现主要命令。表格用可视化入口新建、增删和移动行列、改变列对齐与尺寸，支持键盘导航。点击任务复选框后只更新对应标记。[表格编辑](https://support.typora.io/Table-Editing/) · [快捷键](https://support.typora.io/Shortcut-Keys/) |
| P0 | 文件与搜索 | 文件树、平铺列表、可折叠大纲、排序分组、筛选隐藏文件、拖放移动和建立链接、重命名、复制、回收、撤销文件操作、最近打开和固定目录、默认目录、新窗口及启动恢复。用模糊搜索快速打开文件，用文档查替和目录搜索验证大小写、全词、正则和跳转。[文件管理](https://support.typora.io/File-Management/) · [搜索](https://support.typora.io/Search/) |
| P0 | 保存与恢复 | 单独维护磁盘文档与恢复草稿。分别强制关闭有标题和无标题草稿，重启后验证可恢复。外部修改干净标签时重载，修改有编辑标签时显示冲突并提供两个版本的保全操作。模拟网络目录漏通知、外部原子替换和写入失败。校验 BOM、混合换行与末尾换行。[自动保存](https://support.typora.io/Auto-Save/) · [版本和恢复](https://support.typora.io/Version-Control/) |
| P0 | 专注阅读与排版 | 核对专注、打字机、缩放、全屏、字数、拼写检查、自动配对与补全、智能标点和空白选项。切换文档及应用窗口后仍能定位到当前文字。测试键盘、屏幕阅读器和对比度。[专注与打字机](https://support.typora.io/Focus-and-Typewriter-Mode/) · [拼写检查](https://support.typora.io/Spellcheck/) · [快捷键](https://support.typora.io/Shortcut-Keys/) |
| P1 | 公式和图表 | 验证 TeX/LaTeX 行内和块级公式、宏、编号、引用及多行。验证 Mermaid 和旧的 `sequence`、`flow` 代码块，在编辑、HTML、PDF、DOCX 与 EPUB 中检查图表。多图并行加载时也应得到各自正确的图形。[公式](https://support.typora.io/Math/) · [图表](https://support.typora.io/Draw-Diagrams-With-Markdown/) |
| P1 | 媒体、剪贴板与链接 | 覆盖本地和网络图片、拖放和剪贴板、相对路径和图片根目录、按文档复制资源、调整大小、嵌入音视频和受限 iframe、内部和跨文件锚点、缺失文件创建、批量上传与自定义上传器。验证复制 Markdown、HTML 源码、HTML/RTF 富文本和纯文本以及 HTML 粘贴转换。[图片](https://support.typora.io/Images/) · [上传](https://support.typora.io/Upload-Image/) · [剪贴板](https://support.typora.io/Copy-and-Paste/) · [链接](https://support.typora.io/Links/) |
| P1 | 导出、打印和导入 | 无网络生成 HTML（有样式及无样式）、PDF、长图与打印；验证主题、页面大小、页边距、分页、页眉页脚、目录、图片和链接。Pandoc 导入 DOCX、LaTeX、RST、Org、MediaWiki、DokuWiki、Textile、OPML 和 EPUB。导出 DOCX、ODT、RTF、EPUB、LaTeX、Wiki、RST、Textile、OPML、RevealJS 及 Markdown 方言，验证模板、自定义参数和重用上次导出。[导出](https://support.typora.io/Export/) · [Pandoc](https://support.typora.io/Install-and-Use-Pandoc/) |
| P1 | 外观与系统集成 | 内置浅色和深色主题、跟随系统、自定义 CSS、页面宽度、字体行距、可改快捷键、多语言、RTL、系统文件关联、CLI 参数与多窗口。验证 Typora 主题所依赖的选择器和导出 CSS，测试系统任务栏和近期文件入口。系统文本片段兼容性也属于桌面输入验收范围。[主题](https://support.typora.io/About-Themes/) · [系统文本片段](https://support.typora.io/Text-Snippet/) · [启动设置](https://support.typora.io/Launch-Options/) · [CLI](https://support.typora.io/Use-Typora-From-Shell-or-cmd/) |

## 可复核的改进目标

- **防止覆盖外部修改。** 用户报告 SMB 冲突恢复的含义不清晰，以及 iCloud/OneDrive 下热重载遗漏。打开时记录磁盘内容哈希。使用目录监听和窗口聚焦复查，写入前再校验。冲突时显式提供读取磁盘版本、保留本地副本和确认覆盖。[SMB 报告](https://github.com/typora/typora-issues/issues/6525) · [云同步目录报告](https://github.com/typora/typora-issues/issues/6560)
- **保护草稿并给出恢复入口。** 用户报告编辑缓冲清空与大型文档末尾截断。恢复数据独立落盘，写入临时文件后原子替换，并让草稿可在编辑器中查看。用快速切换标签和进程崩溃覆盖常见故障路径。[缓冲清空报告](https://github.com/typora/typora-issues/issues/6618) · [长文截断报告](https://github.com/typora/typora-issues/issues/6620)
- **限制长文渲染开销。** 有用户报告两篇约 16 万词的文档查找后卡死。源码编辑使用可视区渲染，全文搜索可取消、限制一次返回结果数量。用两篇 16 万词的样本文档反复搜索、切换及滚动，另用长行验证大文件降级。[长文搜索报告](https://github.com/typora/typora-issues/issues/6643) · [长空白报告](https://github.com/typora/typora-issues/issues/6389)
- **统一多文档操作。** Typora 官方快捷键文档将新标签页列为 macOS 功能，社区反馈需要一致的文件打开行为。三平台提供相同的应用标签页，标签保留各自光标、滚动、撤销与保存状态。[快捷键](https://support.typora.io/Shortcut-Keys/) · [标签页和链接打开反馈](https://github.com/typora/typora-issues/issues/1000)
- **验证中文输入和光标稳定性。** YAML 中文输入截断和应用切换后滚动跳动都有公开报告。在三平台真实输入法下验证组合输入完成之前不装饰当前输入范围，验证窗口重新聚焦后光标及滚动位置。[中文输入报告](https://github.com/typora/typora-issues/issues/5945) · [滚动位置报告](https://github.com/typora/typora-issues/issues/6633)

## 实现与发布顺序

1. 将 Markdown 文本作为保存源。编辑器预览、导航、导出由源文本派生。使用 Electron 的隔离渲染进程，桌面桥接承担文件、窗口、媒体、剪贴板和本地导出。
2. 完成并联调单栏编辑、源码切换、目录与标签页、草稿、冲突和跨平台文件操作。使用每行验收样本检查扩展语法、图表、图片及导入导出。按目标平台分别检查中文输入法、屏幕阅读器和系统打开文件。
3. 按实际构建架构记录安装覆盖。每个安装包必须在相应系统的干净环境验证断网安装、首次启动、保存重开和导出，再记录发布提交与 SHA-256。以真实安装验证区分可用安装包与尚待验证的跨平台构建。
