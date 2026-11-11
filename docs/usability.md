# 操作与外观调研

这轮打磨覆盖跨文档定位、正文内的连续编辑、可自定义的快捷键，以及按场景调整阅读与编辑外观。

| 调研对象 | 可迁移的经验 | 素笺的实现 |
| --- | --- | --- |
| [Typora 快捷键](https://support.typora.io/Shortcut-Keys/) | 编辑模式切换、关闭后重开文档、专注与打字机模式有稳定的键盘入口。 | 延续 `Ctrl/⌘+/`、`Ctrl/⌘+Shift+T`、`F8` 和 `F9`，保留原来的写作路径。 |
| [Obsidian 快速切换](https://obsidian.md/help/plugins/quick-switcher) · [VS Code 键位](https://code.visualstudio.com/docs/configure/keybindings) | 快速打开与命令面板解决两类检索任务。按键录制和冲突提示便于迁移自定义习惯。 | 保留 `Ctrl/⌘+P` 快速打开，增加 `Ctrl/⌘+Shift+P` 命令面板，支持关键字筛选、按键录制、冲突提示和逐项恢复。 |
| [WAI-ARIA 键盘交互指引](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) | 键盘焦点应可见，选择结果与执行动作可分别控制，关闭菜单后可继续操作。 | 快速打开与命令面板支持方向键预选、回车执行。标签、侧栏和工具菜单提供键盘操作路径。输入法组字期间跳过应用快捷键。 |
| [iA Writer 设置](https://ia.net/writer/support/basics/settings) · [VS Code 主题](https://code.visualstudio.com/docs/configure/themes) | 正文字体、代码字体和界面外观服务于不同任务。高对比主题和选择时预览有各自用途。 | 正文、代码和界面独立选字，主题可即时预览。预设覆盖中性纸色、明亮白底、暖褐、低饱和冷色、两套深色与高对比。 |

## 正文编辑按键

即时模式参照 Typora 的段落、表格和围栏代码操作，源码与分栏的编辑区参照 Markdown 结构和纯文本编辑的习惯。保留方向键、选择、复制和撤销等操作的系统约定，单独核对列表和表格里的边界。[Typora 换行](https://support.typora.io/Line-Break/) · [Typora 表格](https://support.typora.io/Table-Editing/) · [Typora 代码块](https://support.typora.io/Code-Fences/) · [Obsidian 编辑快捷键](https://obsidian.md/help/editing-shortcuts) · [CodeMirror Tab 约定](https://codemirror.net/examples/tab/)

| 场景 | 即时编辑 | 源码及分栏编辑区 |
| --- | --- | --- |
| 段落和标题 | `Enter` 建新段，`Shift+Enter` 在段内换行。 | `Enter` 插入源码新行，方向键按光标和可视行移动。 |
| 列表、任务和引用 | `Enter` 续项，空列表项可回车退出。列表项开头可用 `Tab`、`Shift+Tab` 调整层级。引用保留块内换行，起始处退格可去掉引用。 | `Enter` 延续列表和引用标记，任务项生成未勾选标记，空任务项回车退出当前层级。`Backspace` 处理光标前的 Markdown 标记或缩进。 |
| 表格 | `Tab` 前进，`Shift+Tab` 回退，末格 `Tab` 新建一行。`Ctrl/⌘+Enter` 在当前行下插行并移到同列。方向键可纵向移动，首尾边界可回到相邻段落。 | 直接编辑管道符和文本。 |
| 围栏代码 | `Enter` 在块内换行。光标所在行可用 `Tab`、`Shift+Tab` 加减缩进。非空代码块开头退格时保留围栏。 | `Enter` 延续前一行的缩进。`Tab`、`Shift+Tab` 调整行缩进。源码里的围栏可直接编辑。 |
| 键盘离开编辑区 | 先按 `Esc`，再按 `Tab` 或 `Shift+Tab` 转移焦点。 | 同样支持 `Esc` 后用 `Tab` 或 `Shift+Tab` 转移焦点。 |

## 验收场景

- 在即时、源码和分栏之间切换，保存同一份文档。重开后核对内容、标签和偏好。
- 从表格末格键入 `Tab`，在新行录入数据，然后反向移格并在当前行下插行。按 `Esc` 再按 `Tab`，核对焦点移出编辑区。保存并检查 Markdown 表格。
- 核对有序和无序任务项继续时复选框未勾选，空任务项退出时保留外层列表或引用。核对即时代码块缩进和反缩进，并在非空代码块首字符前退格后保存验证围栏。
- 用中文输入法搜索，在候选确认时保持面板打开。确认文字后再用方向键选择、回车执行。
- 录入与现有命令重合的组合键并确认提示，保存一组可用键位，实际触发后恢复默认。
- 断网打开同时含中文、英文和代码的文档。核对内置字体，在字体库导入并应用本地文件，再移除并确认回退。
- 核对亮色、深色和高对比下的正文、源码、表格、代码块和修订差异。导出 HTML 时保留主题，打印和 PDF 使用纸面配色。
