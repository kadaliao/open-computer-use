# Security policy · 安全政策

[English](#english) · [简体中文](#简体中文)

## English

ocu operates your Mac with your permissions: it reads what is on screen, sends input,
and can pass screen content to the model providers you configured. For this project a
security problem is anything that makes it act, read or send more than it should.

### What to report privately

- ocu acting while the screen is locked, or on an app or window other than the one it
  was asked to use.
- Screen content, screenshots, model keys or the environment the MCP server borrows from
  your login shell going anywhere other than the model endpoints you configured, or being
  written to disk or logs where it shouldn't be.
- Key values printed by `ocu doctor`, logs or error messages.
- A way for another program to drive the `ocu-mac` helper through ocu without starting
  it itself.
- A way for screen content to make the agent bypass its own checks (the local finish
  check, the repeat guards) in a way that leads to real harm.
- Problems with the release archives or `install.sh`: what they install, where, and how
  they handle quarantine and signing.

Ordinary bugs (an app that doesn't work, a wrong answer, a crash) can go in a public
issue.

**Known risk, not a vulnerability by itself:** text on screen can mislead a model, as
with any computer-use agent. Give ocu tasks you would be willing to watch, in apps you
trust.

### How to report

Use GitHub's private reporting, **Security → Report a vulnerability** on the repository,
or open <https://github.com/kadaliao/open-computer-use/security/advisories/new>. If that
doesn't work for you, email kadaliao@gmail.com.

Include the ocu version, your macOS version, how you ran it (CLI, or MCP and which host),
and steps to reproduce. Remove private content from screen text and screenshots.

The maintainer aims to reply within a week, and will credit you in the release notes
unless you'd rather not be named.

### Supported versions

Fixes go into the latest release. Please update before reporting.

## 简体中文

ocu 以你的权限操作你的 Mac：读取屏幕内容、发送输入，还可能把屏幕内容发给你配置的模型服务商。在这个项目里，凡是让它做了、读了或发出了超出本分的东西，都算安全问题。

### 哪些问题请私下报告

- 屏幕锁定时 ocu 还在操作，或者操作了别人没让它用的应用或窗口。
- 屏幕内容、截图、模型 key，或者 MCP 服务从登录 shell 借来的环境变量，被发到了你配置的模型接口以外的地方，或者被写进了不该写的磁盘文件或日志。
- `ocu doctor`、日志或报错里打印出了 key 的值。
- 别的程序不用自己启动 `ocu-mac`，就能借 ocu 操控它。
- 屏幕上的内容能让 agent 绕过它自己的检查（本地完成检查、防重复保护），并造成实际危害。
- 发布包或 `install.sh` 的问题：装了什么、装到哪里、怎么处理隔离属性和签名。

一般的 bug（某个应用不好用、答案不对、崩溃）直接提公开 issue 就行。

**已知风险，本身不算漏洞：** 和所有 computer-use agent 一样，屏幕上的文字可能误导模型。交给 ocu 的任务，最好是你愿意在旁边看着的、在你信任的应用里做的。

### 怎么报告

用 GitHub 的私密报告：在仓库的 **Security → Report a vulnerability**，或者直接打开 <https://github.com/kadaliao/open-computer-use/security/advisories/new>。用不了的话，发邮件到 kadaliao@gmail.com。

请写明 ocu 版本、macOS 版本、怎么运行的（命令行，还是 MCP，宿主是哪个），以及复现步骤。屏幕文字和截图里的隐私内容先抹掉。

维护者会尽量在一周内回复。发布说明里会致谢报告人，不想署名可以说一声。

### 支持的版本

修复只进最新版本。报告前请先升级。
