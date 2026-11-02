// Benchmark tasks. setup puts the app in a known state; verify checks the real outcome:
//   RegExp   = must appear on screen (window title + accessibility text) after the task
//   function = checks the agent's answer (for "tell me ..." tasks)
// TOKEN makes every run's text unique, so leftovers from earlier runs can't fake a pass.
export type Task = { id: string; goal: string; setup?: string; verify: RegExp | ((summary: string) => boolean); cleanup?: string };

const TOKEN = `ocu${Date.now().toString(36).slice(-5)}`;
const osa = (s: string) => `osascript -e '${s.replace(/'/g, "'\\''")}'`;
const re = (s: string) => new RegExp(s, "i");
const closeUntitled = osa('tell application "TextEdit" to close (every document whose name starts with "未命名") saving no');

export const tasks: Task[] = [
  { id: "notes-new", goal: `在备忘录里新建一条备忘录，内容写 ${TOKEN} notes`, setup: "open -a Notes", verify: re(`${TOKEN} notes`) },
  { id: "textedit-type", goal: `在文本编辑里新建一个文稿，输入 ${TOKEN} textedit`, setup: "open -a TextEdit", verify: re(`${TOKEN} textedit`), cleanup: closeUntitled },
  { id: "textedit-bold", goal: `在文本编辑里新建一个文稿，输入 ${TOKEN} bold，然后全选并设为粗体`, setup: "open -a TextEdit", verify: re(`${TOKEN} bold`), cleanup: closeUntitled },
  { id: "calc-mul", goal: "用计算器算 37 乘以 12，把结果告诉我", setup: "open -a Calculator", verify: (s) => s.includes("444") },
  { id: "calc-add", goal: "用计算器算 1234 加 5678，把结果告诉我", setup: "open -a Calculator", verify: (s) => /6,?912/.test(s) },
  { id: "finder-downloads", goal: "在访达里打开“下载”文件夹", setup: "open ~/Documents", verify: /window: (下载|Downloads)/ },
  { id: "safari-url", goal: "用 Safari 打开 example.com", setup: "open -a Safari https://www.apple.com/cn/", verify: /Example Domain/ },
  { id: "safari-read", goal: "在 Safari 打开 example.com，告诉我页面的大标题是什么", setup: "open -a Safari https://www.apple.com/cn/", verify: (s) => /example domain/i.test(s) },
  { id: "settings-bluetooth", goal: "打开系统设置里的蓝牙页面", setup: "open 'x-apple.systempreferences:com.apple.wifi-settings-extension'", verify: /window: (蓝牙|Bluetooth)/ },
  { id: "settings-wallpaper", goal: "打开系统设置里的墙纸页面", setup: "open 'x-apple.systempreferences:com.apple.wifi-settings-extension'", verify: /window: (墙纸|Wallpaper)/ },

  // Multi-page navigation: each needs several look-then-click steps.
  { id: "settings-about", goal: "打开系统设置，进入“通用”里的“关于本机”页面", setup: "open 'x-apple.systempreferences:com.apple.wifi-settings-extension'", verify: /window: (关于本机|About)/ },
  { id: "settings-display", goal: "打开系统设置里的显示器页面", setup: "open 'x-apple.systempreferences:com.apple.wifi-settings-extension'", verify: /window: (显示器|Displays)/ },
  { id: "finder-utilities", goal: "在访达里打开“应用程序”文件夹，再进入其中的“实用工具”文件夹", setup: "open ~/Documents", verify: /window: (实用工具|Utilities)/ },
  { id: "safari-link", goal: "在 Safari 打开 example.com，然后点击页面上的链接", setup: "open -a Safari https://www.apple.com/cn/", verify: /iana/i },
];
