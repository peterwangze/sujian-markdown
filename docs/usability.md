# 操作与外观调研

这轮打磨覆盖跨文档定位、正文内的连续编辑、可自定义的快捷键，以及按场景调整阅读与编辑外观。

| 调研对象 | 可迁移的经验 | 素笺的实现 |
| --- | --- | --- |
| [Typora 快捷键](https://support.typora.io/Shortcut-Keys/) | 编辑模式切换、关闭后重开文档、专注与打字机模式有稳定的键盘入口。 | 延续 `Ctrl/⌘+/`、`Ctrl/⌘+Shift+T`、`F8` 和 `F9`，保留原来的写作路径。 |
| [Obsidian 快速切换](https://obsidian.md/help/plugins/quick-switcher) · [VS Code 键位](https://code.visualstudio.com/docs/configure/keybindings) | 快速打开与命令面板解决两类检索任务。按键录制和冲突提示便于迁移自定义习惯。 | 保留 `Ctrl/⌘+P` 快速打开，增加 `Ctrl/⌘+Shift+P` 命令面板，支持关键字筛选、按键录制、冲突提示和逐项恢复。 |
| [WAI-ARIA 键盘交互指引](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) | 键盘焦点应可见，选择结果与执行动作可分别控制，关闭菜单后可继续操作。 | 快速打开与命令面板支持方向键预选、回车执行。标签、侧栏和工具菜单提供键盘操作路径。输入法组字期间跳过应用快捷键。 |
| [iA Writer 设置](https://ia.net/writer/support/basics/settings) · [VS Code 主题](https://code.visualstudio.com/docs/configure/themes) | 正文字体、代码字体和界面外观服务于不同任务。高对比主题和选择时预览有各自用途。 | 正文、代码和界面独立选字，主题可即时预览。预设覆盖中性纸色、明亮白底、暖褐、低饱和冷色、两套深色与高对比。 |

## 正文编辑按键

即时模式参照 Typora 的段落、表格和围栏代码操作，并用本机 Typora 1.12.4 的设置和键位配置核对默认行为。源码与分栏中的列表调整按 Markdown 的实际层级处理。保留方向键、选择、复制和撤销等操作的系统约定。[Typora 换行](https://support.typora.io/Line-Break/) · [Typora 表格](https://support.typora.io/Table-Editing/) · [Typora 1.5 反缩进说明](https://support.typora.io/What%27s-New-1.5/) · [Obsidian 编辑快捷键](https://obsidian.md/help/editing-shortcuts) · [CodeMirror Tab 约定](https://codemirror.net/examples/tab/)

| 场景 | 即时编辑 | 源码及分栏编辑区 |
| --- | --- | --- |
| 段落和标题 | `Enter` 建新段。在正文段落、引用和清单项内，`Shift+Enter` 插入可保存的硬换行，源码写作 `<br>`。段落中的 `Tab` 插入可保存的空白，`Shift+Tab` 去掉行首缩进。段首用不换行空格保存缩进，避免 Markdown 将其解析为代码。 | `Enter` 插入源码新行，方向键按光标和可视行移动。 |
| 列表、任务和引用 | `Enter` 续项，空列表项可回车退出。`Tab`、`Shift+Tab` 在项内移动该项及其子项，也能操作选中的同级列表项。 | `Enter` 延续列表和引用标记，任务项生成未勾选标记。`Tab`、`Shift+Tab` 按实际 Markdown 层级移项，处理编号宽度、引用和续行。 |
| 表格 | `Tab` 前进，`Shift+Tab` 回退，末格 `Tab` 新建一行。`Ctrl/⌘+Enter` 在当前行下插行并移到同列。方向键可纵向移动，首尾边界可回到相邻段落。 | 直接编辑管道符和文本。 |
| 围栏代码 | `Enter` 在块内换行。单个光标按 `Tab` 插入制表符，选中文本时对涉及的代码行缩进；`Shift+Tab` 反缩进当前行或选中的行。整行缩进为四列。 | `Enter` 延续前一行的缩进。`Tab`、`Shift+Tab` 将围栏中的代码按四列调整，保留外层引用或列表所需的缩进。 |
| 键盘离开编辑区 | 先按 `Esc`，再按 `Tab` 或 `Shift+Tab` 转移焦点。 | 同样支持 `Esc` 后用 `Tab` 或 `Shift+Tab` 转移焦点。 |

## 右键与代码语言

文件列表与标签页以右击的文档为操作目标。审阅已打开的后台文档时使用其编辑稿，审阅磁盘文件时将它后台打开。菜单可用方向键、回车和 `Esc` 操作。[Obsidian 文件列表](https://obsidian.md/help/plugins/file-explorer)

普通正文右击先显示插入链接、表格和代码块，再显示粘贴、保存和审阅。右击选中文字先显示剪切、复制和格式，粘贴项注明会替换选区。右击选区外会收起旧选区，按点击位置提供操作。表格、代码块和链接在无选区时优先显示对应操作，有文字选区时剪切和复制优先。[VS Code 菜单指南](https://code.visualstudio.com/api/ux-guidelines/context-menus) · [Obsidian 表格插入](https://obsidian.md/help/advanced-syntax) · [Typora 复制与粘贴](https://support.typora.io/Copy-and-Paste/)

即时编辑的代码块语言入口位于块右下角。输入语言名或别名后，方向键预选、回车应用，`Esc` 返回编辑。语言标记保存在围栏开头，代码文本原样保留。[Typora 语言选择](https://support.typora.io/Code-Fences-Language-Support/)

## 验收场景

- 在即时、源码和分栏之间切换，保存同一份文档。重开后核对内容、标签和偏好。
- 从表格末格键入 `Tab`，在新行录入数据，然后反向移格并在当前行下插行。按 `Esc` 再按 `Tab`，核对焦点移出编辑区。保存并检查 Markdown 表格。
- 核对有序和无序任务项继续时复选框未勾选，空任务项退出时保留外层列表或引用。核对即时代码块缩进和反缩进，并在非空代码块首字符前退格后保存验证围栏。
- 从非当前标签、工作区及最近打开列表进入审阅。核对菜单标题、审阅目标和已存在的未保存内容，再对同一文档撤销审阅。
- 在正文选区、代码块、表格和链接上分别打开菜单，核对目标与动作。选择新的代码语言并保存，检查围栏标记和代码正文。
- 在即时编辑和源码中分别右击选区内、选区外及选中行右侧的空白。核对菜单顺序，检查选区内的复制和格式化、选区外的粘贴和插入位置。打开链接或表格对话框后确认插入，保存并检查 Markdown。
- 用中文输入法搜索，在候选确认时保持面板打开。确认文字后再用方向键选择、回车执行。
- 录入与现有命令重合的组合键并确认提示，保存一组可用键位，实际触发后恢复默认。
- 断网打开同时含中文、英文和代码的文档。核对内置字体，在字体库导入并应用本地文件，再移除并确认回退。
- 核对亮色、深色和高对比下的正文、源码、表格、代码块和修订差异。导出 HTML 时保留主题，打印和 PDF 使用纸面配色。
