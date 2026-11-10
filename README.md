# every-read

可**自定义快捷键一键显隐**的 Markdown 悬浮阅读器（Electron）。
参考 `inter-assistant` 桌面端的隐身/快捷键实现思路，聚焦"读文档"这一件事。

![image-20261110185400645](C:\Users\Administrator\AppData\Roaming\Typora\typora-user-images\image-20261110185400645.png)

## 功能

- **悬浮窗**：无边框窗口、默认置顶、不进任务栏、只留托盘图标；顶部标题栏可拖动，四边可拖拽缩放；不透明度可调（30%–100%）。
- **一键显隐**：全局快捷键（默认 `Ctrl+Shift+Y`，macOS `Cmd+Shift+Y`），应用失焦也生效；快捷键可在设置面板中**自定义录入**（需含 Ctrl / Alt / Win 修饰键，或使用 F1–F24 单键），配置持久化到 `userData/every-read-config.json`。
- **屏幕共享隐身**（可选，默认开启）：`setContentProtection(true)`，屏幕共享 / 录屏 / 截图中看不到本窗口；托盘与设置面板均可开关。
- **打开 Markdown**：文件对话框（支持多选）或直接把 `.md / .markdown / .txt` 拖进窗口；最近文件列表（最多 10 条）记忆并可通过设置面板回读；阅读位置按文件记忆。
- **虚拟滚动模式**：长文只渲染视口附近条目（±3 条缓冲），估算高度占位 + 实测高度校正，`Space / PageUp / PageDown` 翻屏，顶部有阅读进度条。
- **分页浏览模式**：离屏测量块高 → 按页高贪心装箱；`← / → / PageUp / PageDown / 滚轮` 翻页，`Home / End` 跳首尾页；两种模式切换时保留阅读位置锚点。
- **字号调节**：`A− / A+` 或设置面板（12–22px），切换后自动重算虚拟高度 / 重排分页。
- **示例长文**：空状态页一键加载约 120 节的示例文档，用来体验虚拟滚动与分页。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl+Shift+Y`（默认，可自定义） | 全局：显示 / 隐藏悬浮窗 |
| `← / → / PageUp / PageDown` | 分页模式翻页 |
| `Space` / `Shift+Space` | 分页翻页 / 滚动模式翻屏 |
| `Home / End` | 跳到第一页 / 最后一页（分页模式） |

## 运行

```bash
cd every_read
npm install      # 或 pnpm install（Electron 二进制下载失败时见下）
npm start
```

> pnpm ≥ v10 默认拦截依赖的 postinstall 脚本，若 `electron` 二进制未下载，手动执行一次：
> `node node_modules/electron/install.js`

## 测试

```bash
npm test        # node --test test/（快捷键解析 + Markdown 拆块）
```

## 架构

```
every_read/
├── main.js               # Electron 主进程：窗口/托盘/全局快捷键/IPC/配置持久化
├── preload.js            # contextBridge 白名单暴露 electronAPI（everyRead.*）
├── lib/
│   ├── shortcuts.js      # 快捷键解析/校验/显示（纯逻辑，UMD，Node 与浏览器通用）
│   ├── mdblocks.js       # Markdown 顶层块拆分 + 虚拟条目合并（UMD，可测试）
│   └── icon.js           # 纯 Node PNG 编码器（托盘/窗口图标，零依赖）
├── renderer/
│   ├── index.html        # 界面骨架（CSP: script-src 'self'）
│   ├── styles.css        # 深色主题样式
│   └── app.js            # 虚拟滚动器 / 分页器 / 设置面板 / 拖拽加载
├── scripts/gen-icon.js   # 重新生成 assets/icon.png
└── test/                 # node:test 单元测试
```

### 关键实现

- **一键显隐**：`globalShortcut.register` 系统级注册；设置面板实时捕获 `keydown` 组合成 Electron accelerator，经 `lib/shortcuts.js` 校验后重注册；注册失败（被占用）会提示并保留旧键。
- **屏幕共享隐身**：窗口创建后立即 `setContentProtection(true)`，并在生命周期事件中保持；参考项目结论——不要关硬件加速，否则 Windows 上会退化为"共享时黑块"而非"从捕获中排除"。
- **虚拟滚动**：`markdown-it` token 流按顶层块分组（`lib/mdblocks.js`），标题必断、代码块独立、小块合并；滚动时二分查找可视区间，仅挂载视口 ±3 条，`requestAnimationFrame` 内实测高度校正前缀和与 `top` 定位。
- **分页**：隐藏测量层复用同一排版宽度，逐块 `offsetHeight` 贪心装箱成页；`resize / 字号变化 / 换文件` 时按锚点条目重排。

## 已知限制

- 文件按 UTF-8 读取（自动去 BOM），GBK 等编码文档请先转码。
- "屏幕共享隐身"是 Electron/OS 级尽力而为：Windows 10 2004+ 效果最佳；部分老系统或特殊捕获路径可能只表现为黑块。
- 快捷键为系统全局注册，与其他应用冲突时注册失败，换一个组合即可。
