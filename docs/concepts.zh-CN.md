# 概念

[English](concepts.md) · **简体中文**

ocu 里用到的术语，以及屏幕、ref、操作和回复是怎么工作的。MCP 调用方和内置 agent 看到的是同一种屏幕格式，
所以这一页对两者都适用。

- [屏幕](#屏幕)
- [Ref](#ref)
- [操作](#操作)
- [等待屏幕稳定](#等待屏幕稳定)
- [变化回复](#变化回复)
- [批量操作](#批量操作)

## 屏幕

一次观察（observation）就是某个应用当前聚焦窗口的文字形式。第一行写明应用和窗口，
后面跟几行可选信息，然后每个元素一行：

    app: 文本编辑 | window: 未命名
    dialog open: "要存储更改吗？" (its controls are listed first)
    other windows of this app (2): "笔记.txt", "草稿.rtf"
    e140 Button "存储"
    e141 Button "不存储"
    e112 CheckBox "粗体" [checked]
    e107 PopUpButton "字样" = "Helvetica"
    e131 TextArea "hello"

**元素行**的格式是 `ref Role "label"`，有值和状态时跟在后面：

- `= "..."` 是带标题的输入框、弹出按钮或滑块的当前值，只在它和标签不同时显示。
- `[checked]` 和 `[mixed]` 标记复选框和打了勾的菜单项，`[selected]` 标记选中的单选按钮、标签页、行或单元格，
  `[disabled]` 标记不能用的控件。没有标记就是未勾选、未选中、可用。
- 角色（Role）就是 macOS 辅助功能角色去掉 `AX` 前缀：`Button`、`TextField`、`TextArea`、`CheckBox`、
  `RadioButton`、`PopUpButton`、`MenuItem`、`MenuButton`、`Link`、`ComboBox`、`Slider`、`Tab`、`Cell`、
  `Row`、`SearchField`，以及 `Text`（只读文字）。

第一行下面的**可选行**：

- `dialog open: "…"`：有表单（sheet）、对话框或警告框弹出来了。它的控件排在列表最前面，
  通常要先处理它。
- `other windows of this app (n): …`：这个应用还有别的窗口。一个操作可能一次打开好几个窗口。
- `(accessibility info is sparse here: …)`：带标签的元素不到五个，画布类应用、游戏和部分 Electron 应用常见。
  这时用[截图兜底](agent.zh-CN.md#截图兜底)。

**长内容会被截断。** 长列表会多一行，比如 `showing 40 of 312 rows: scroll{ref:"e150"} for more, or find_text`，
整个元素列表也有数量上限。`find_text` 会搜索窗口里的全部文字，包括被截掉的和滚出可视区域的。

**读哪个应用。** 写明你要读的应用（`observe Calculator`）。应用名、本地化名称（`计算器`）和
bundle id（`com.apple.calculator`）都可以。ocu 会把这个应用的窗口带到最前面，并记住它供之后的调用使用。
不写名字时读最前面的应用，在 MCP 下这通常是调用方自己的终端。

## Ref

一个 ref（`e112`）对应一个元素。

- **ref 是稳定的。** 只要 helper 还在运行，元素就一直保持同一个 ref，ref 也不会被分给别的元素。
- **只能操作最新屏幕上的 ref。** 已经消失的 ref 会返回 `unknown ref`。重新读一次，用新屏幕上的 ref。
- **ref 从 `e101` 开始。** 有些规划模型会去数行号而不是照抄 ref，结果按到下一行的元素
  （在计算器上 10 次里错了 10 次）。从 `e101` 开始的 ref 不会被当成行号。
- 有些应用每次读取都会创建新的元素对象，它们的 ref 每次都会变。功能照常，只是回复会是整屏而不是变化列表。

## 操作

| 操作 | 字段 | 作用 |
| --- | --- | --- |
| `press` | `ref`, `extend?` | 按下按钮、链接、菜单项、标签页、单元格或行。对表格行和文件相当于单击：选中它；`extend: true` 表示加入已有选择 |
| `open` | `ref` | 相当于双击文件、文件夹或行：打开文件，或者进入文件夹 |
| `set_value` | `ref`, `text` | 直接设置输入框的值 |
| `type` | `text`, `ref?` | 输入文字。带 `ref` 时输入到那个输入框；不带时输入到当前聚焦的输入框 |
| `key` | `key`, `repeat?` | 一个按键或组合键：`return`、`tab`、`escape`、`space`、`delete`、方向键、`cmd+n`、`cmd+shift+g`……`repeat`（最多 50）表示重复按 |
| `scroll` | `ref?`, `direction`, `amount?` | 把元素所在的列表或整个窗口向 `up` 或 `down` 滚动 `amount` 行（默认 10） |
| `menu` | `path` | 按标题点击菜单栏里的菜单项，比如 `["文件", "新建文件夹"]`（英文系统用 `["File", "New Folder"]`） |
| `open_app` | `name` | 打开或切换到一个应用，等它到了最前面才返回 |
| `open_url` | `url` | 用能处理这个 URL 的应用打开它：网页在默认浏览器里打开，`x-apple.systempreferences:` 链接在系统设置里打开 |
| `find_text` | `text` | 搜索窗口里的全部文字，包括屏幕外的和列表里被截掉的。内置 agent 的规划模型里这个字段叫 `query` |
| `click_at` | `x`, `y` | 点击一个全局屏幕坐标点。用在截图之后、元素没被列出来的时候 |

对所有操作都适用的行为：

- 键盘操作会先把被观察的应用带到最前面。
- 不带 `ref` 的 `type` 会通过辅助功能把文字插入到当前聚焦的原生输入框，并稍等输入框获得焦点。
  网页里的输入框收到的是真实按键事件。
- 网页内容（浏览器、Electron 应用）里的元素会收到真实的鼠标点击，因为这些应用会忽略辅助功能的按下操作。
- 访达以及“打开”“存储”面板里的文件，在列表视图里列为 `Row`，在分栏、图标和画廊视图里列为 `Cell`。
  `press` 选中它（分栏视图里选中文件夹就会显示它的内容），`open` 打开它。图标和画廊视图只列出看得见的文件。
- 屏幕锁定时，所有操作都会被拒绝。
- 菜单往往比按钮快：在访达里用 `menu{path:["前往","下载"]}`（英文系统是 `["Go","Downloads"]`），
  或者用快捷键，比如 `key{key:"cmd+n"}`。

## 等待屏幕稳定

在可能改变屏幕的操作之后，ocu 每 50 ms 重新读一次窗口，直到它不再变化，最多 3 秒。
如果屏幕完全没变，ocu 会再观察一会儿才判定操作没起作用：一般是 600 ms，浏览器里是 1.2 秒，
因为网页加载开始得晚。这些重复读取是静默的：不会把窗口提到前面，也不会画覆盖层。

会这样等待的操作有：`press`、`open`、`menu`、`open_app`、`open_url`、`click_at`、`click_visual`、`return`，
以及任何带修饰键的组合键。

## 变化回复

在 MCP 下，每次 `act` 先返回操作结果，再用下面三种形式之一返回屏幕：

1. **`did not change`。** 操作没有产生可见的效果。调用方手里的屏幕和所有 ref 都仍然有效。
   不要重复这个操作，换一个元素、菜单或快捷键试试。
2. **变化列表。** 只列出变化的行，按屏幕上的顺序排列。调用方上一屏里的其他 ref 都没变，仍然有效：

       changed: 1 changed. Only these lines changed (+ new, ~ changed, - gone: don't use it); every other ref from your last screen is unchanged and still valid.
       app: 计算器 | window: 计算器
       ~ e103 Text "7"   (was: Text "0")

   `+` 是新元素，`~` 是标签、值或状态变了的元素，`-` 是已经消失的元素。
3. **整屏。** 在这些情况下发送：第一次；出现了别的窗口或应用；对话框打开或关闭；
   变化超过 40 行（或屏幕的 40%）；连续四次变化列表之后，免得调用方手里的副本越走越偏。

`observe` 总是返回整屏。

## 批量操作

一次 `act` 调用可以在 `then` 里带上更多步骤，按顺序执行：

```json
{"action":"press","ref":"e107","then":[{"action":"press","ref":"e108"},{"action":"press","ref":"e113"}]}
```

- 在会改变屏幕的步骤之后，批量会先等屏幕稳定再执行下一步，这样按键能送到刚打开的窗口。
- 连续的 `press`（比如在计算器的数字键上按出一个数）直接往下走，不等待。
- 后面某一步的元素已经消失的话，这一步会返回 `unknown ref`，而不会点到别的东西上。批量在第一个错误处停止。
- 回复会列出每一步的结果，然后给一次屏幕。

内置 agent 也会批量操作，对屏幕变化之后能接什么步骤有更严格的规则，见[内置 agent](agent.zh-CN.md#批量与本地完成检查)。
