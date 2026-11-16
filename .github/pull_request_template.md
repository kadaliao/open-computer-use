<!-- English or Chinese, either is fine. / 用中文或英文都可以。 -->

## What changed / 改了什么



## How it was checked / 怎么检查的

<!-- Tests, the apps you tried, benchmark tasks with before/after numbers. / 测试、试过的应用、基准任务及改动前后的数字。 -->

## Checklist / 检查清单

- [ ] `bun test` and `bun run typecheck` pass in `core/` / `core/` 里 `bun test` 和 `bun run typecheck` 通过
- [ ] Helper changes build with `swift build -c release` and were tried on real apps / 改了 helper 的话，`swift build -c release` 能编译，并在真实应用上试过
- [ ] Behavior or speed changes come with benchmark numbers, before and after / 行为或速度的改动附上了改动前后的基准数字
- [ ] Screen format, tool descriptions or server instructions changed on purpose, with docs updated / 屏幕格式、工具描述或服务说明的改动是有意的，文档已同步
- [ ] Docs updated in both `*.md` and `*.zh-CN.md` (or noted below which one is missing), and `bun scripts/check-docs.ts` passes / 文档中英两份都已更新（或在下面注明缺哪份），`bun scripts/check-docs.ts` 通过
- [ ] `CHANGELOG.md` and `CHANGELOG.zh-CN.md` updated under *Unreleased*, if users would notice / 用户能感知的改动已写进两份 CHANGELOG 的「未发布」
