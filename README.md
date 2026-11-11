# 素笺 Sujian

素笺是一款离线桌面 Markdown 编辑器。默认使用单栏即时编辑，也可以切换到源码、分栏预览和阅读模式。文件以 Markdown 存在本机。

## 安装

从 [GitHub Releases](https://github.com/peterwangze/sujian-markdown/releases) 下载与系统和处理器匹配的安装包。

| 系统 | 文件 | 安装 |
| --- | --- | --- |
| Windows | `Sujian-*-win-x64.exe` 或 `Sujian-*-win-arm64.exe` | 双击安装程序 |
| macOS | `Sujian-*-mac-x64.dmg` 或 `Sujian-*-mac-arm64.dmg` | 挂载 DMG，将 Sujian 拖进“应用程序” |
| Linux | `Sujian-*-linux-*.AppImage` 或 `Sujian-*-linux-*.deb` | 赋予 AppImage 执行权限，或使用系统软件包管理器安装 DEB |

安装包内置 Electron、Markdown 渲染资源和 Pandoc。处理本地文档和离线转换无需下载插件。

- Windows 安装程序使用未签名构建。ARM64 安装包内的 Pandoc 使用 Windows 11 的 x64 仿真。
- macOS 需要 13 或更新版本，构建采用 ad-hoc 签名。首次打开时可能需要在“隐私与安全性”中允许打开应用。[Electron 平台要求](https://www.electronjs.org/blog/electron-44-0) · [Apple 打开应用说明](https://support.apple.com/en-us/102445)
- Linux 需发行版提供 Chromium 所用的系统库。发布流程在 Ubuntu 24.04 的 x64 和 ARM64 运行器中检查 AppImage 以及 DEB 解包启动。

## 开始使用

- 在侧栏打开本地文件夹，在文件树中切换文档，也可以从“大纲”跳到某个章节。
- 即时模式只显示当前编辑位置需要的 Markdown 标记。源码模式适合审查空白、换行与长文档。
- 有未保存改动时，素笺保存本地恢复草稿。重启后可以从侧栏恢复。磁盘文件另有改动时，冲突面板可显示磁盘版本并另存副本。
- 从“文档与视图”打开导出、阅读和全屏。原生导出包括 PDF、HTML 与 PNG，其他文档格式使用随包的 Pandoc。

## 开发与发布

需要 Node.js 24。运行 `npm ci`、`npm run build`、`npm start`。用 `npm test` 执行自动化回归。构建本机安装包时运行 `npm run package -- <win32|darwin|linux> <x64|arm64>`。安装包和 SHA-256 通过 GitHub Actions 在发行标签上生成。

[Typora 调研、功能对照与验收计划](docs/compatibility.md)
