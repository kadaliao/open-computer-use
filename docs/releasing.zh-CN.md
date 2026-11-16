# 发布流程

[English](releasing.md) · **简体中文**

给维护者看的。一次发布 = 一个 git tag + 一个 GitHub Release，Release 里放一个单文件可执行的压缩包。版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)；1.0 之前，次版本号可能改动屏幕格式或工具行为，改了什么写在 CHANGELOG 里。

## 检查清单

1. **测量。** 跑覆盖这次改动的基准测试，并在同一台机器、同一天跑一遍上一个版本做对比（见[基准测试](benchmarks.zh-CN.md)）。数字有变化就更新 `docs/benchmarks.md` 和 `docs/benchmarks.zh-CN.md`。
2. **改版本号**，两处都要改：
   - `core/package.json`（`"version"`）
   - `core/src/mcp.ts`（`McpServer` 的 version）
3. **更新 CHANGELOG。** 在 `CHANGELOG.md` 和 `CHANGELOG.zh-CN.md` 里，把 *Unreleased* / *未发布* 改成新版本号和日期，再加一个空的 *Unreleased* / *未发布*，并在文末补上对比链接。
4. **检查。**

   ```sh
   (cd core && bun test && bun run typecheck)
   bun scripts/check-docs.ts
   ```

5. **提交并打 tag。**

   ```sh
   git commit -am "release: v0.7.0"
   git tag v0.7.0
   git push origin master v0.7.0
   ```

6. **构建**，在 Apple 芯片的 Mac 上：

   ```sh
   ./scripts/release.sh v0.7.0   # -> dist/ocu-v0.7.0-macos-arm64.tar.gz
   ```

   压缩包里有 `ocu`（用 Bun 编译的 core，运行时不需要装 Bun）、`ocu-mac`、`install.sh`、中英文 README 和许可证。
7. **发布前先在干净路径里试装：**

   ```sh
   cd "$(mktemp -d)" && tar xzf /path/to/dist/ocu-v0.7.0-macos-arm64.tar.gz
   OCU_HOME="$PWD/home" sh ocu-v0.7.0-macos-arm64/install.sh
   "$PWD/home/ocu" doctor
   ```

   注意 `install.sh` 总会把 `~/.local/bin/ocu` 链接到它刚装的那份。试完再按平常的方式装一遍。
8. **发布。**

   ```sh
   gh release create v0.7.0 dist/ocu-v0.7.0-macos-arm64.tar.gz \
     --title v0.7.0 --notes-file notes.md
   ```

   Release 说明（英文）包括：一两句话说明这个版本主要做了什么；如果是提速版本，附上实测数字；最近一次和 agent-desktop 的对比（合计数字，加上[基准测试](benchmarks.zh-CN.md#和-agent-desktop-对比)的链接）；用户能感知的改动；对 MCP 调用方的行为变化；已知限制；以及安装命令：

       Install: `brew install kadaliao/tap/ocu`, or
       `tar xzf ocu-v0.7.0-macos-arm64.tar.gz && sh ocu-v0.7.0-macos-arm64/install.sh`
9. **更新 Homebrew。** `gh workflow run bump.yml -R kadaliao/homebrew-tap` 让 `ocu` 的 formula 马上跟到新版本（不跑也会每 6 小时自动更新一次）。
