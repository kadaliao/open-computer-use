// Benchmark tasks. setup puts the app in a known state; verify checks the real outcome:
//   RegExp   = must appear on screen (window title + accessibility text) after the task
//   function = checks the agent's answer (for "tell me ..." tasks)
// TOKEN makes every run's text unique, so leftovers from earlier runs can't fake a pass.
//   { sh }   = shell command must exit 0 (for file-system effects)
export type Task = { id: string; goal: string; setup?: string; hard?: boolean;
  verify: RegExp | ((summary: string) => boolean) | { sh: string }; cleanup?: string };

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

  // Harder: cross-app, multi-stage, or needs reading + reasoning.
  { id: "hard-calc-to-notes", hard: true, goal: `用计算器算 123 乘以 45，然后在备忘录里新建一条备忘录，内容写“${TOKEN} 结果 ”加上这个计算结果`,
    setup: "open -a Calculator", verify: re(`${TOKEN} 结果 ?5,?535`) },
  { id: "hard-web-to-textedit", hard: true, goal: `在 Safari 打开 example.com，读出页面大标题，然后在文本编辑里新建文稿，写入“${TOKEN} ”加上这个标题`,
    setup: "open -a Safari https://www.apple.com/cn/", verify: re(`${TOKEN} ?Example Domain`), cleanup: closeUntitled },
  { id: "hard-textedit-replace", hard: true, goal: `在文本编辑里新建文稿，输入“${TOKEN} apple apple apple”，然后用查找和替换功能把 apple 全部替换成 pear`,
    setup: "open -a TextEdit", verify: re(`${TOKEN} pear pear pear`), cleanup: closeUntitled },
  { id: "hard-wiki-fact", hard: true, goal: "用 Safari 打开维基百科（en.wikipedia.org），搜索 Alan Turing，告诉我他出生在哪一年",
    setup: "open -a Safari https://www.apple.com/cn/", verify: (s) => s.includes("1912") },
  { id: "hard-finder-newfolder", hard: true, goal: `在访达里打开“下载”文件夹，在里面新建一个文件夹，命名为 ${TOKEN}`,
    setup: "open ~/Documents", verify: { sh: `test -d ~/Downloads/${TOKEN}` }, cleanup: `rmdir ~/Downloads/${TOKEN} ~/Downloads/未命名文件夹 2>/dev/null; true` },
  { id: "hard-settings-appearance", hard: true, goal: "打开系统设置的外观页面，告诉我当前外观是浅色、深色还是自动",
    setup: "open 'x-apple.systempreferences:com.apple.wifi-settings-extension'",
    verify: (s) => { const dark = require("node:child_process").spawnSync("defaults", ["read", "-g", "AppleInterfaceStyle"]).stdout.toString().includes("Dark");
      const auto = require("node:child_process").spawnSync("defaults", ["read", "-g", "AppleInterfaceStyleSwitchesAutomatically"]).stdout.toString().trim() === "1";
      return auto ? /自动|auto/i.test(s) : dark ? /深色|dark/i.test(s) : /浅色|light/i.test(s); } },
  { id: "hard-calc-expr", hard: true, goal: "用计算器算 (15 + 27) × 3 − 8，把结果告诉我", setup: "open -a Calculator", verify: (s) => s.includes("118") },
  { id: "hard-notes-list", hard: true, goal: `在备忘录里新建一条备忘录，第一行写 ${TOKEN} 清单，下面分三行写 牛奶、鸡蛋、面包`,
    setup: "open -a Notes", verify: re(`${TOKEN} 清单[\\s\\S]*牛奶[\\s\\S]*鸡蛋[\\s\\S]*面包`) },
];
