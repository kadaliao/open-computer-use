# 参与贡献 open-computer-use

[English](CONTRIBUTING.md) · **简体中文**

感谢参与。ocu 会在别人的 Mac 上操作真实的应用，所以这份指南主要讲怎么在真实桌面上检查改动，而不只是跑测试。

- [可以帮什么忙](#可以帮什么忙)
- [开发环境](#开发环境)
- [检查改动](#检查改动)
- [约定](#约定)
- [中英双语文档](#中英双语文档)
- [Pull request](#pull-request)

## 可以帮什么忙

- **报告 bug**，用 bug 反馈模板。写明 ocu 版本、macOS 版本、怎么运行的（命令行，还是 MCP，宿主是哪个）、`ocu doctor` 的输出，以及目标或工具调用。屏幕文字和截图里的隐私内容先抹掉。
- **报告不好用的应用**：你试了什么、屏幕是什么样（`ocu observe <应用>`）、结果怎样。
- **添加基准任务**，覆盖 ocu 应该能做到的事（见 `core/bench/tasks.ts`）。一个现在还会失败的任务，本身就是有用的贡献。
- **修复或改进。** 比小修小补大的改动，请先开 issue，商量好做法再动手。计划中的工作在[路线图](docs/roadmap.zh-CN.md)里，每一项在 `docs/plans/` 下都有一份计划。
- **改进文档，或者中英文的措辞。**

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要发公开 issue。

## 开发环境

需要 macOS 13 或更高版本、Xcode 命令行工具（Swift 5.9 或更高）和 [Bun](https://bun.sh)。

```sh
git clone https://github.com/kadaliao/open-computer-use.git
cd open-computer-use
(cd mac && swift build -c release)   # helper：mac/.build/release/ocu-mac
(cd core && bun install)
bun core/src/cli.ts doctor
```

在源码目录里，`bun core/src/cli.ts` 接受的命令和 `ocu` 一样。给你开发用的终端开辅助功能权限。改 helper、屏幕格式或 agent 循环之前，先读[架构](docs/architecture.zh-CN.md)。

## 检查改动

**每个改动都要：**

```sh
cd core
bun test               # 单元测试，几秒钟，不需要任何权限
bun run typecheck      # tsc --noEmit
```

**改了 helper：** 在 `mac/` 里用 `swift build -c release` 重新构建，再用 `bun src/cli.ts observe <应用>` 在真实应用上试。

**改了行为或速度**，要在真实的 Mac 上跑基准测试（见[基准测试](docs/benchmarks.zh-CN.md)）：

```sh
cd core
bun bench/run.ts smoke <任务 id>     # 受这次改动影响的任务
bun bench/perf.ts after             # 改了 helper 的话，测 helper 耗时
bun bench/mcp-perf.ts after         # 改了回复的话，测 MCP 耗时和回复大小
```

先在 `master` 上跑一遍同样的命令，方便对比。把改动前后的数字写进 PR。

## 约定

- **提交信息**用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 前缀，范围写模块名：`feat(helper):`、`fix(agent):`、`perf(mcp):`、`docs:`。模块包括 `helper`、`screen`、`agent`、`policy`、`mcp`、`cache`、`bench`。
- **注释写原因**，尤其是等待时间、阈值和针对某个应用的变通做法。数字是测出来的就写明：「（DeepSeek 10 次里 10 次按错了键）」。
- **屏幕格式和 MCP 工具描述是接口。** 模型的提示词就是它们。要改就有意识地改，同时更新服务说明、规划模型的提示词和[概念](docs/concepts.zh-CN.md)，并在 CHANGELOG 的「变更」里写明。
- **本地完成检查只能更严，不能更松。** 如果改动让 agent 能凭更弱的证据结束，要在 `agent.test.ts` 里加测试，说明哪些情况仍然会被拒绝。
- **绝不打印 key 的值**，`doctor`、日志、报错里都不行。打印变量名没问题。
- **不要提交** `core/bench/results/`、`dist/`，以及你自己桌面的截图。

## 中英双语文档

英文是主语言。读者会翻看的每篇文档都有两份：英文 `name.md` 和中文 `name.zh-CN.md`，顶部互相链接。两份在同一个 PR 里一起改。如果你只会写一种语言，在 PR 里说一声，维护者会在合并前补上另一份。

GitHub 特殊对待的文件（`SECURITY.md`、`CODE_OF_CONDUCT.md`、issue 和 PR 模板）把两种语言写在同一个文件里。`docs/plans/` 下的计划是工作文档，只写英文。

推送之前跑一下文档检查，它会找出缺少的译文、失效的链接和锚点：

```sh
bun scripts/check-docs.ts
```

## Pull request

- 一个 PR 只做一件事。
- 按模板填写：改了什么、怎么检查的；行为或速度的改动附上数字。
- 用户能感知的改动，在 `CHANGELOG.md` 的 *Unreleased* 和 `CHANGELOG.zh-CN.md` 的 *未发布* 下各加一行。
- 更新描述这次改动的文档。

版本由维护者发布，见[发布流程](docs/releasing.zh-CN.md)。

参与本项目即表示你同意遵守[行为准则](CODE_OF_CONDUCT.md)。
