# 素笺发布验收清单

用同一份含标题、段落、列表、表格、代码块和链接的 Markdown 文档核对编辑操作。在独立临时工作区准备第二份文档、空子目录、已有同名文档、图片、修订候选与 Git 底稿。桌面运行可用仓库的 Electron 构建或设置 `SUJIAN_QA_EXE` 指向待验收版本。键位和平台差异见 [键盘操作与验收清单](shortcut-acceptance.md)。

每个用例有稳定编号。表中的桌面结果以 Windows Electron 实际运行记录为依据。“部分通过”表示该用例的部分路径有桌面证据，其余路径单独记录。“历史证据”适用于文档注明的既有版本或环境。“待实测”表示已有步骤和预期，仍需执行。系统文件选择框可由测试返回指定文件，后续读写和文档更新走实际桌面路径。macOS 和 Linux 的原生窗口、输入法和按键交互需要分别运行。

验收时记录版本、提交、构建入口、系统与架构、用例号、结果和可复核证据。修改产品功能时对应到现有用例号或补充新号。发布结论依据当前候选版本的实测和安装包验证。Typora 对照范围及尚未实现的兼容目标见 [功能对照](compatibility.md)，Markdown 方言和解析器差异见 [格式兼容实测](markdown-format-results.md)。

## 正文位置与操作交叉验证

每项编辑测试至少用一个光标场景和一个选区场景。编辑后看排版与源码，保存并重开核对磁盘内容。用第二份打开的文档检查操作目标。标题、列表、表格和代码的测试分别进入对应块，尤其要覆盖块首、块尾和相邻块边界。

| 正文位置 | 操作步骤 | 预期 | 桌面结果与证据 |
| --- | --- | --- | --- |
| `ED-01` 标题 | 在已有标题和正文上分别设置一至六级、转回段落。在各模式对标题文字作左键拖选、格式化、撤销。 | 标记对应实际级别，大纲跟随变化。选区和目标文本与光标所在块一致。 | 三种编辑模式的标题键位、源码标题的指针菜单以及即时标题选区的删除线已通过。见 `check-heading-shortcuts-desktop.mjs`、`check-editing-shortcuts-desktop.mjs`、`check-editor-pointer-desktop.mjs`。 |
| `ED-02` 普通段落 | 左键向前和向后拖选部分文字，另选跨行文字。分别右击选区内、边界和选区外。用快捷键和右键加粗、斜体、删除线和行内代码，撤销并检查保存结果。 | 按选区只修改目标文本。选区外右击以新光标位置提供插入和粘贴。正文右键删除线写入 Markdown。 | 即时与源码右键范围、剪贴板和保存已通过。源码及分栏正反拖选可见，源码拖动选中文字后可撤销，即时段落删除线可开关。见 `check-editor-pointer-desktop.mjs`、`context-menus-smoke.mjs`。 |
| `ED-03` 无序、有序与任务列表 | 在项尾回车续写，再对空项回车。分别在顶层、嵌套、引用内和多项选区按 `Shift+Tab`，并测试第一个列表项的文字开头退格。 | 新任务未勾选。嵌套项提升一级，顶层项按 `Shift+Tab` 保留列表。首项文字开头可退格退出列表，空项可用回车退出。 | 即时、源码和分栏的反缩进与退出、即时四种列表的右键删除线已通过。见 `check-shift-tab-desktop.mjs`、`check-editor-pointer-desktop.mjs`。[反缩进和反向移焦点](shortcut-acceptance.md#反缩进和反向移焦点) |
| `ED-04` 即时输入列表标记 | 在空文档、新段首、引用和列表中输入 `*`、`-` 或 `+` 后按空格。分别在正文中间、围栏代码和转义符后输入相同字符。 | 结构位置立刻生成列表，光标进入项内继续输入。保留所选标记和已有正文。字面位置按文本处理。 | `check-typed-lists-desktop.mjs` 已通过即时成形、选定标记写盘、引用与列表嵌套、字面边界和模拟输入法事件。 |
| `ED-05` 表格 | 从首格到末格前后移格，在末格按 `Tab`，从中间单元格按 `Mod+Enter`。右击内容单元格执行增行。检查删除行列和对齐后预览。 | 新建行落在正确位置，光标位于预期行列。操作定位到目标行列，保留表头和其余单元格。 | 移格、跨表头、增行、目标行列删除、左中右对齐、单元格右键删除线和焦点退出已通过。见 `check-editing-shortcuts-desktop.mjs`、`check-shift-tab-desktop.mjs`、`check-editor-pointer-desktop.mjs`。 |
| `ED-15` 表格长内容折行 | 在 520 px 文档中测试表头、长句、中文、连续字符、长链接和行内代码，切换即时、分栏和阅读。打开审阅排版，导出带样式 HTML 和 PDF。 | 长内容在单元格内折行，短列、列对齐及 Tab 移格保留，Markdown 无新增硬换行。 | Windows 实测通过即时、分栏、阅读、审阅、带样式 HTML 和 PDF。见 `check-table-layout-desktop.mjs`。 |
| `ED-16` 正文和宽内容 | 在窄文档中打开含长标题、正文链接、引用、列表、键帽、折叠、代码、HTML 预格式文本、行内和块公式、图片、Graphviz 与 22 列表格的样稿。 | 文字折行，图像按可用宽度显示。超宽内容在各自块内滚动，正文保持宽度。可以滚动到末列，原 Markdown 保留。 | Windows 实测通过即时、分栏和阅读。见 `check-content-width-desktop.mjs`。 |
| `ED-06` 围栏代码 | 在单个光标、正向和反向多行选区用 `Tab`、`Shift+Tab`。在块首按退格，撤销缩进。点击语言标签，用搜索、方向键、回车更换语言。拖选代码、右击，再按 `Esc`。 | 调整缩进并保留围栏。语言变化只写到围栏标记。代码选区菜单提供复制代码和语言，取消菜单后原选区可见并可继续编辑。 | 即时代码缩进、反向选区、撤销、块首退格、键盘选语言、保存、菜单取消恢复选区均通过。见 `check-editor-pointer-desktop.mjs`、`typora-tab.mjs`、`code-language-smoke.mjs`。 |
| `ED-07` 行内格式的跨场景一致性 | 在标题、段落、无序及有序列表、嵌套项、任务项、引用和表格单元格选字，分别用工具栏、快捷键或右键操作。测试反向选区、两侧空白、重复应用、代码与阅读边界。 | 各入口作用于同一个范围，选区两侧空白保留，合法格式可渲染并写入 Markdown。块级结构、未选文字和代码内容按原语义保留。 | 即时编辑通过八种场景各四个右键组合，另测快捷键、工具栏、局部取消格式、嵌套格式、撤销重做、保存与重开。源码和分栏通过 14 个正反选区用例及跨块选择，保留标题、引用、任务标记和围栏代码，保存结果逐字节比对。见 `check-live-inline-desktop.mjs`、`check-source-formatting-desktop.mjs`。 |
| `ED-08` 链接与图像 | 选中文字后打开插入链接，分别确认和取消。右击链接复制地址。用相对图片路径、插入本地图片和剪贴板图片，切到分栏检查。 | 链接文字、目标和位置正确。图像引用可从文档位置打开。 | 即时插入链接、选区外插入目标已通过。图片写盘和导出在后文。 |
| `ED-09` 引用、硬换行与连续输入 | 在段落、引用、列表分别按 `Shift+Enter` 后继续输入。用中文输入法在正文和搜索中组合文字，再按回车。 | 即时编辑写入可保存的硬换行。输入法确认候选时不触发编辑命令。 | 段落、引用和列表的硬换行保存已通过 `check-markdown-desktop.mjs`。真实中文输入法候选交互待在目标平台实测。 |
| `ED-10` 分栏预览与阅读区 | 在只读区域选字并复制，点文内锚点和折叠摘要，再试格式快捷键。 | 选区、阅读跳转和折叠可操作，正文可通过编辑区修改。 | 已通过 HTML 折叠、文内锚点和只读格式保护。见 `check-html-desktop.mjs`、`check-markdown-desktop.mjs`、`check-heading-shortcuts-desktop.mjs`。 |

### 编辑器工具、媒体与状态

| 用例与入口 | 操作步骤与预期 | 桌面结果与证据 |
| --- | --- | --- |
| `ED-11` 更多编辑工具 | 按 `ED-07` 核对加粗、斜体、下划线、删除线、行内代码、高亮、上下标。依次插入分隔线、目录、脚注、公式、Mermaid，再用工具栏和键盘分别撤销、重做。排版与保存的标记对应，撤销仅回退预期动作。 | `check-live-inline-desktop.mjs` 通过工具栏高亮、上标和下标的实际渲染、保存与重开。公式与图表见 `check-editing-shortcuts-desktop.mjs`、`check-markdown-desktop.mjs`。分隔线、目录和脚注的独立工具栏插入待实测。 |
| `ED-12` 表格和任务可视操作 | 从对话框设行列数，用上下限和取消路径检查插入。用表格工具与右键测试上下加行、左右加列、删行列及左中右对齐。点击一个任务复选框后保存，检查目标标记。 | 插入、增行、删行列、左中右对齐和移格通过。本轮实测点击任务只将目标行写为有效的 `[X]`，相邻任务保留。行列上下限与取消待实测。 |
| `ED-13` 剪贴板与链接 | 在光标、选区、阅读区执行复制、剪切、普通及纯文本粘贴、全选。分别复制 Markdown、富文本、HTML 源码、纯文本及代码。检查剪贴板内容和类型。用相对路径、中文及重复标题锚点、浏览器链接、复制地址和失效路径检查导航。 | 源码与即时菜单复制、粘贴目标，Markdown 剪贴板接口载荷与文内锚点已实测。独立 Electron 45 会话的系统剪贴板读回、其余剪贴板格式和系统浏览器跳转待实测。 |
| `ED-17` 右击复制图片 | 在即时编辑、分栏预览和阅读中右击普通、链接、缩小显示或内嵌的图片。选择 **复制图片** 后粘贴，核对图像的像素和尺寸。链接图片保留链接操作；选字菜单和加载失败的图片不显示 **复制图片**；操作后 Markdown 保持原样。 | Windows 已通过三种模式、125% 缩放、内嵌 PNG、系统剪贴板读回和原生粘贴，以及原文逐字节核对。见 `check-image-context-desktop.mjs`。 |
| `ED-18` 另存和定位图片 | 在即时编辑、分栏预览和阅读中对本地图片分别执行 **图片另存为…** 和 **在文件夹中显示**。覆盖中文与空格文件名、链接图片、配置的图片根目录、`file://` 和缩小显示的 SVG。另存内嵌 PNG 和允许加载的网络图；取消对话框、选择原文件、尝试省略后缀存为已有文件，并检查损坏及被禁用的图片。 | 副本保留原字节和格式，默认文件名正确，省略扩展名时补全且不覆盖同名文件。文件管理器定位点中的本地原图；内嵌和网络图片不提供定位。取消不创建文件，原图和 Markdown 保持原样。Windows 三种模式均已实测写盘，并确认资源管理器选中对应原图。见 `check-image-files-desktop.mjs`。 |
| `ED-14` 编辑状态与错误反馈 | 从零标签页新建或打开文档，保存、改字、选字、切标签。核对空白页入口、保存状态、未保存标记、字数、选区字数、编码和错误提示。 | 已验证保存与未保存标记、名称、选区和文件内容。状态栏全部显示组合待实测。 |

## 文件、标签与工作区

| 操作入口 | 步骤和验收点 | 桌面结果与证据 |
| --- | --- | --- |
| `FS-01` 新建、打开、保存、另存 | 用按钮和快捷键新建草稿、打开本地 Markdown 和多个文件。写入不同文本，保存后核对文件。分别确认和取消保存对话框，再另存一份。 | 打开、关闭、恢复、保存、取消和另存已通过 `check-editing-shortcuts-desktop.mjs`、`check-workspace-interactions-desktop.mjs`。 |
| `FS-02` 目录与文件上下文 | 在根目录、子文件夹和固定目录用右键或 `Shift+F10` 新建文件。输入含空格的名称、已有文件名和非法路径，核对文件系统和标签。另测新建子目录、重命名、移动、复制、移至回收站与撤销。 | 已通过 `check-file-creation-desktop.mjs`、`check-workspace-interactions-desktop.mjs`，包括同名保护、移至回收站取消和确认、复制后撤销。 |
| `FS-03` 标签栏与工作区导航 | 打开多份文档，使用左右、`Home`、`End`、`Delete` 及 `Ctrl+Tab`。切换文件树、平铺列表、近期记录和大纲。验证隐藏文件、排序、固定和取消固定。 | 标签切换、键盘关闭、文件树焦点、平铺列表、排序、固定和取消固定已通过。见 `usability-smoke.mjs`、`check-workspace-interactions-desktop.mjs`。 |
| `FS-04` 恢复与外部文件变化 | 在临时工作区写未保存内容后关闭、恢复或删除草稿。修改正在编辑的磁盘文件，分别对照、重载、另存或取消。 | 已通过崩溃恢复、取消关闭、放弃更改、草稿删除确认与取消、磁盘冲突预览、重载、确认覆盖和保留两份内容的另存副本。见 `check-workspace-interactions-desktop.mjs`。 |
| `FS-05` 文档图片与拖入 | 在已保存文档插入或粘贴图片，再从文件系统拖入 Markdown。检查默认资源目录、自定义图片目录和回退。 | 默认资源目录、剪贴板图片和自定义路径已通过。见 `check-file-creation-desktop.mjs`、`check-settings-desktop.mjs`。文件系统拖入待实测。 |
| `FS-06` 多文件和本机入口 | 从文件对话框选择多份支持文档。用文件菜单、侧栏最近打开、标签右键、打开文件位置及窗口切换分别定位同一份文档。当前标签与重复打开策略符合预期。 | 单文件打开、标签恢复和双窗口已通过。文件管理器显示位置及本机多选、拖入待实测。 |
| `FS-07` 文件内容与大文档 | 用 UTF-8 BOM、带 BOM UTF-16、CRLF、混合换行、无末尾换行、中文长路径样例保存重开。大文档首次用源码打开，切换即时编辑时有确认，滚动与查找可到文件末尾。 | 文件层覆盖编码、换行、末尾、并发和外部变化。历史浏览器证据包含约 16 万词文档查找。见 `electron/documents.test.cjs` 和 [当前兼容记录](compatibility.md#当前验收记录)。 |
| `FS-08` 图片根路径与外部上传 | 用 `/` 开头的本地图片测试图片根路径。配置本机测试上传器和每行参数，测试缺配置、无待上传、确认及取消、成功替换本地引用和上传失败。用无标题草稿验证资源落在应用目录，首次另存后核对原引用。 | 已实测 `FS-05` 的资源路径。上传器、图片根路径及未命名草稿图片的桌面组合待实测。 |

## 查找、定位、命令与焦点

| 操作入口 | 步骤和验收点 | 桌面结果与证据 |
| --- | --- | --- |
| `NAV-01` 文档查找 | 用选区打开查找，确认查询预填。用回车、反向回车、`F3`、`Shift+F3` 来回浏览，`Esc` 关闭。 | 前后匹配和保存已通过。见本地 `usability-smoke.mjs`。 |
| `NAV-02` 文档替换与工作区搜索 | 用大小写、全词、正则切换匹配条件，测试一处、全部和非法正则。用两份文件确认搜索结果打开正确文档并定位行。 | 已通过 `check-workspace-interactions-desktop.mjs`，覆盖非法正则、两种替换范围、跨文件正则与跳行。 |
| `NAV-03` 快速打开、命令面板、行跳转、大纲 | 分别检索文件和动作，通过方向键选择。用明确行号定位，选择大纲里的中文及重复标题，测试大纲折叠。 | 快速打开、命令面板、行跳转、大纲折叠与跳转已通过。见本地 `usability-smoke.mjs` 和 `check-workspace-interactions-desktop.mjs`。 |
| `NAV-04` 菜单和弹窗 | 用 `Tab` 访问工具栏，用方向键进入菜单，回车执行和 `Esc` 返回。分别在文件、标签、正文选区和光标位置打开上下文菜单，检查焦点恢复。 | 已通过菜单键盘导航、标签焦点和源码编辑菜单退出。见本地 `usability-smoke.mjs`、`editor-context-smoke.mjs`。 |
| `NAV-05` 小窗口与键盘覆盖 | 用窄窗口检查宽窄工具栏入口和横向标签滚动。用键盘从菜单、编辑区到侧栏再返回，分别走 Tab 和反向 Tab。确认空列表、无结果、无活跃文档与禁用动作的提示。 | 方向导航、焦点返回、反向离开编辑区已通过。窄窗口及屏幕阅读器原生运行待实测。 |

## 模式、外观与编辑设置

| 操作入口 | 步骤和验收点 | 桌面结果与证据 |
| --- | --- | --- |
| `UI-01` 即时、源码、分栏、阅读 | 用工具栏、命令面板和快捷键切换。用含多种 Markdown 的同一文档对照表格、代码、公式、图表、图片、锚点和安全 HTML。 | 已通过 `check-markdown-desktop.mjs`、`check-html-desktop.mjs`，含 HTML 折叠、危险元素限制和未编辑源码往返。 |
| `UI-02` 主题与版面 | 选择全部内置配色，核对选中状态、实际页面色和跟随系统。调文档宽度，手输或导入本地 CSS，重启确认持久化。 | 已通过。`check-settings-desktop.mjs` 用系统配色媒体查询模拟浅色与深色变化。 |
| `UI-03` 字体库与排版 | 分别更换正文、代码和界面字体，调字号与行距。导入本地字体，应用到三类文字，重启检查加载，再移除并验证回退。试无效字体及重复导入。 | 已通过。`check-settings-desktop.mjs` 核对五种内置字体、真实 WOFF2 加载、取消、无效和重复导入、重启及删除回退。TTF、OTF 和 WOFF 的界面导入待分别实测。 |
| `UI-04` 编辑与快捷键偏好 | 切换默认模式、侧栏、专注、打字机、源码自动换行和正文拼写。录制、保存、修改、恢复快捷键，验证冲突和重启。 | 已通过 `check-settings-desktop.mjs`、`check-spellcheck-desktop.mjs` 和 `check-editing-shortcuts-desktop.mjs`。拼写覆盖新旧配置默认关闭、开启、技术词排除、改正与重启。 |
| `UI-05` 文件与资源偏好 | 调整自动保存、恢复上次打开、隐藏文件、网络图片及图片目录。重开应用确认选择，在文件树和编辑区核对实际效果。 | `check-settings-desktop.mjs` 已通过实际自动保存、会话恢复及关闭后改开指南、显示隐藏文件、自定义资源路径和图片内容核对。另用本机 HTTPS 图片实测分栏预览，默认无网络请求，开启后图片加载并显示，关闭后撤下图片地址并保持请求数。 |
| `UI-06` 页面缩放、全屏与新窗口 | 调大小后恢复实际尺寸，从菜单、默认或自定义键进入全屏和新窗口。核对窗口间文档和偏好。 | 已通过恢复实际尺寸、工具栏进入全屏并用 `F11` 退出、新建窗口改键后停用旧加速键并打开第二窗口。首个窗口保留其文档。见 `check-heading-shortcuts-desktop.mjs`、`check-window-interactions-desktop.mjs`。 |

## 审阅、工作流与交付

| 操作入口 | 步骤和验收点 | 桌面结果与证据 |
| --- | --- | --- |
| `WF-01` 审阅当前或后台文档 | 分别从正文、标签、文件列表打开审阅。粘贴候选或选文件，选择旧底稿，逐处采纳、跳过和撤销。 | 已通过从编辑区与后台文件打开，以及选择性采纳、仅预览已采纳和撤销。见 `editor-context-smoke.mjs`、`check-review-workflows-desktop.mjs`。旧底稿和三方重叠场景另行实测。 |
| `WF-02` 审阅差异与 Git 比较 | 打开源码与排版差异，切换仅预览采纳结果。用 Git `HEAD` 或提交比较，核对工作树与当前文档。 | `check-review-workflows-desktop.mjs` 已通过 Git `HEAD` 只读比较。指定分支、标签和提交的桌面路径待实测。 |
| `WF-03` 模板、规格与来源 | 从模板创建文档集，用含重复编号、缺引用的样例检查规格，再插入来源链接并跳转。 | 已通过模板、规格问题定位、仅允许已保存来源以及来源链接跳转。见 `check-review-workflows-desktop.mjs`。 |
| `WF-04` 导入、导出与打印 | 用文件、工具栏与快捷键进入。导出 HTML/PDF/Word/EPUB 并实际打开结果，检查 PNG、幻灯片、自定义格式、打印与取消路径。 | 已通过 22 种格式产物检查、横向 Letter PDF、取消保存及源文件保护。DOCX、ODT、EPUB、HTML、RTF 五种导入往返通过。见 `check-delivery-desktop.mjs`、`check-markdown-desktop.mjs`。物理打印待实测。 |
| `WF-05` 审阅选择与冲突 | 用复制底稿、粘贴、文件选择、更换修订稿、选择旧底稿和恢复默认底稿。制造仅当前稿变化及重叠变化，逐项、全采纳、全跳过并翻页。仅有可应用选择时允许应用，检查预览和原文。 | 实际桌面覆盖选择性应用与撤销。审阅模型单元覆盖三方重叠，批量、换底稿和分页的桌面路径待实测。见 `src/review/model.test.js`、`check-review-workflows-desktop.mjs`。 |

## Markdown 格式与渲染范围

用 [Markdown 格式样例](markdown-format-qa.md) 通过即时、源码、分栏、阅读、审阅和导出入口分别抽查适用格式。未修改时保存再核对字节，编辑一个目标后核对其余格式仍可读。记录输入方言及样例中的位置。

| 用例与输入 | 操作步骤与预期 | 证据 |
| --- | --- | --- |
| `MD-01` 常见文档结构 | 打开含 ATX/Setext 标题、段落、软硬换行、引用、无序有序嵌套、任务、围栏及缩进代码、表格、分隔线的样本。核对结构、源码往返、文本和编辑区按键。 | `check-markdown-spec.mjs`、`check-markdown-desktop.mjs`，解析器精确匹配数及差异见 [规范样例](markdown-format-results.md#规范样例)。 |
| `MD-02` 行内与元数据 | 核对强调、删除线、代码跨度、转义、实体、自动链接、引用链接、脚注、YAML、`[TOC]`、emoji、标亮和上下标。检查已有标记的渲染，另测从编辑工具生成新标记。 | 格式样例和 Markdown 桌面回归有代表性结果。编辑入口见 `ED-07` 与 `ED-11`。 |
| `MD-03` 扩展方言和锚点 | 验证 GitHub 警示块、重复中文标题和手写 ID。检查带属性的 Pandoc 围栏与 Quarto 代码单元，高亮或更换语言后保留其他属性和代码。 | `check-markdown-desktop.mjs`，另见 [格式兼容实测](markdown-format-results.md)。 |
| `MD-04` 公式和图表 | 断网测试 KaTeX 行内和块级公式、GitHub 行内公式、Mermaid、旧 `sequence`、Flowchart.js `flowchart`/`flow` 和 Graphviz `graphviz`/`dot`。同页、引用内和列表内包含多个图，编辑、预览和导出对应一致。 | `check-markdown-desktop.mjs` 已核对本地渲染和 HTML、PDF、DOCX、EPUB 产物。KaTeX 与其他引擎的兼容边界见格式文档。 |
| `MD-05` HTML 与安全 | 检查行内标签、允许的内联 CSS、图片、混排与嵌套折叠、摘要键盘操作和锚点。确认脚本、事件属性、iframe、危险 CSS 受限，审阅稿不加载外部资源。 | `check-html-desktop.mjs` 的编辑、分栏、阅读和独立 HTML 已通过。审阅外部资源限制另有历史验收记录。 |

## 导入和导出格式验收

通过桌面 **导出文档** 对话框选择下列 22 个格式。统一夹具包含标题、中文、表格、图表和文末标记。核对保存路径、扩展名、内容或文件签名以及原文。对于需要外部程序的格式，把结构检查和实际打开后的版式检查分别记录。

| 用例与产品格式 | 预期 | 证据与边界 |
| --- | --- | --- |
| `EXP-01` PDF、带样式 HTML、仅内容 HTML、PNG 长图 | PDF 可读且纸张与横向生效。带样式保留主题，仅内容保留内容结构。PNG 有正确尺寸。用图片与分页样例检查实际效果。 | `check-delivery-desktop.mjs` 校验 PDF 签名、横向 Letter、HTML 样式和 PNG 尺寸。`check-html-desktop.mjs` 实际打开导出的 HTML。 |
| `EXP-02` DOCX、ODT、RTF、EPUB | 文件有对应结构，重新导入可还原主要文本。含图和公式时检查嵌套位置。 | 四种格式的导出产物及导入往返通过。DOCX、EPUB 九张图及公式回读见 `check-markdown-desktop.mjs`。 |
| `EXP-03` LaTeX、reStructuredText、Emacs Org、MediaWiki、DokuWiki、Textile、OPML | 结构化文本使用对应语法。OPML 输出大纲，标题存在。 | `check-delivery-desktop.mjs` 已核对产物。使用对应外部工具逐项重开和版式检查待实测。 |
| `EXP-04` GitHub Markdown、CommonMark、Pandoc Markdown、PHP Markdown Extra、纯文本 | 产生所选语法或纯文本，正文可读且原稿保留。 | `check-delivery-desktop.mjs` 已核对产物。转换差异参照 `MD-01` 和 `MD-02`。 |
| `EXP-05` Reveal.js、自定义 Pandoc | Reveal.js 支持本地导航。自定义格式接收格式名及合法扩展名，错误输入有反馈。 | `check-delivery-desktop.mjs` 核对两个输出。断网打开 Reveal.js 有历史记录。无效 writer 的桌面失败路径待实测。 |
| `IMP-01` 导入与取消 | 可选 DOCX、ODT、RTF、LaTeX（`.latex`、`.tex`、`.ltx`）、RST（`.rst`、`.rest`）、Org、MediaWiki（`.wiki`）、DokuWiki、Textile、OPML、EPUB、HTML（`.html`、`.htm`）。取消保留当前文档，成功生成 Markdown 草稿。 | `check-delivery-desktop.mjs` 已通过 DOCX、ODT、EPUB、HTML 和 RTF 往返。其余导入格式、扩展名别名及坏文件需分组补验。 |
| `EXP-06` 打印与失败路径 | 用物理打印机或系统 PDF 驱动执行打印和取消。检查分页与纸面配色。测试无写权限、取消选择和拒绝覆盖原 Markdown。 | 源文件保护和取消导出已通过。物理打印、原生打印面板与权限失败待实测。 |
| `EXP-07` 本地图片离线交付 | 同一文档混用相对路径、中文空格和特殊字符编码、引用式写法、HTML 图片、设置的图片根路径、绝对路径和 `file://`。导出后移动产物，移走原文档、图片和应用草稿资源。另测未保存草稿粘贴图、另存后导出和真正缺失的图片。 | Windows 实测通过预览解码、打印交接、离线 HTML/幻灯片像素、PDF 图像、PNG 像素及 Word/EPUB/ODT/RTF 内嵌数据。Word 和 RTF 的 SVG、WebP 转换及 HTML、Word 的缺图提示通过。见 `check-media-export-desktop.mjs`。 |

## 桌面系统、终端和安装包

| 用例与入口 | 操作步骤与预期 | 证据与边界 |
| --- | --- | --- |
| `SYS-01` 启动和窗口 | 从应用图标、系统菜单、工具栏与命令键启动、开新窗口、关闭和退出。核对已打开文档、缩放、全屏和窗口焦点。 | `check-window-interactions-desktop.mjs`、`check-heading-shortcuts-desktop.mjs` 有 Windows 实测。各系统菜单退出、窗口切换和标题栏控制需用安装包执行。 |
| `SYS-02` 文件关联与单实例 | 从文件管理器打开已注册的 `.md`、`.markdown`、`.mdown`、`.mkd`、`.mkdn`，再将第二份文档交给已运行实例。验证文档与对应窗口，检查最近文档与显示文件位置。 | 扩展名由 [打包配置](../electron-builder.yml) 声明。安装包启动已有工作流步骤，系统文件管理器和文件关联需原生实测。 |
| `CLI-01` 打开、跳转和审阅 | 使用中文及空格路径测试普通文件参数、`open <文件> --line <行号>`、`review <目标> --candidate <候选>`。分别冷启动与已有窗口，检查行号、标签、候选内容及非法参数反馈。 | `electron/review.test.cjs` 覆盖解析、相对路径与错误参数，Windows CLI 冷、热路径有 [历史证据](compatibility.md#v11-审阅回归)。当前版本各安装包需验证代表性命令。 |
| `SYS-03` 原生键盘、输入法和辅助功能 | Windows、macOS、Linux 分别按键位清单试物理组合键、中文候选、组合文字、系统剪贴板、拖入文件、真实窗口对话框及平台屏幕阅读器。 | Windows Electron 回归覆盖模拟键盘与输入法事件。平台级输入法、辅助功能、系统剪贴板与原生拖入单独记录。 |

| 安装用例 | 交付物与原生步骤 | 预期与证据 |
| --- | --- | --- |
| `PKG-01` Windows x64、arm64 | 分别在相应干净环境运行离线 EXE，启动已安装应用，保存重开并导出。核对 Pandoc，ARM64 记录 Windows 11 x64 仿真。另测升级、取消与卸载。 | GitHub Actions 在两个架构上运行静默安装、Pandoc 和成品 `--smoke-test`。人工原生安装与升级结果按实际运行记录。 |
| `PKG-02` macOS Intel、Apple 芯片 | 挂载各自 DMG，把应用拖入“应用程序”，按系统实际提示首次打开。核对应用签名、文件关联、保存、导出及卸载。 | GitHub Actions 在两个架构验证 DMG、`codesign`、Pandoc 与成品启动。首次启动与 Gatekeeper 的人工交互单独记录。 |
| `PKG-03` Linux x64、arm64 | 对各架构运行 AppImage 与 DEB。分别测试可执行文件、应用菜单、保存和导出，核对发行版系统依赖。 | GitHub Actions 分别运行 AppImage 与 DEB 解包产物，检查内置 Pandoc。桌面包管理器安装、升级和卸载单独记录。 |
| `PKG-04` 发布资产与完整性 | 比对源码提交、版本、标签、安装包名称、八个安装文件、Pandoc 对应源码归档和 `SHA256SUMS.txt`。逐个下载验证，核对 README 安装入口与 GitHub Release 资产。 | 在实际版本的工作流和 Release 记录资产与校验结果。见 [发布工作流](../.github/workflows/release.yml)。 |

## 发布结论

1. 对本次改动逐项引用受影响的用例号。关键编辑与数据保全路径出现可复现失败时，修复后复测原场景及相邻上下文。
2. 运行单元测试、生产构建和桌面交互回归。记录当前候选提交、测试平台、命令及结果。桌面检查中的部分覆盖或目标平台尚未实测在交付说明中标注。
3. 对候选版本运行目标平台与架构构建及成品启动检查。八个安装文件与对应校验、Pandoc 源码完整后，核对公开 Release、README 和实际包版本。

发布记录使用 `版本 / 提交 / 平台与架构 / 用例号 / 结果 / 运行记录或证据路径`。Windows、macOS 和 Linux 的安装包工作流记录与手动原生交互各用一行，便于追踪重测范围。

## 复测入口

运行 `npm run build` 后，用 `npm run test:desktop-interactions` 执行桌面交互回归，也可按下面的领域单独运行。本地历史脚本存于被 Git 忽略的 `test-results/`，作为本轮额外执行证据。

| 领域 | 复测命令 |
| --- | --- |
| 单元检查与基础桌面流程 | `npm test`、`npm run test:desktop` |
| 编辑与指针 | `node scripts/check-heading-shortcuts-desktop.mjs`、`node scripts/check-editing-shortcuts-desktop.mjs`、`node scripts/check-editor-pointer-desktop.mjs`、`node scripts/check-shift-tab-desktop.mjs`、`node scripts/check-typed-lists-desktop.mjs`、`node scripts/check-source-formatting-desktop.mjs`、`node scripts/check-live-inline-desktop.mjs` |
| 文件与工作区 | `node scripts/check-file-creation-desktop.mjs`、`node scripts/check-workspace-interactions-desktop.mjs` |
| 设置、窗口与拼写检查 | `node scripts/check-settings-desktop.mjs`、`node scripts/check-window-interactions-desktop.mjs`、`node scripts/check-spellcheck-desktop.mjs` |
| Markdown、HTML、审阅与交付 | `node scripts/check-markdown-desktop.mjs`、`node scripts/check-html-desktop.mjs`、`node scripts/check-review-workflows-desktop.mjs`、`node scripts/check-delivery-desktop.mjs` |
