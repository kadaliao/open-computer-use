# Releasing

**English** · [简体中文](releasing.zh-CN.md)

For maintainers. A release is a git tag plus a GitHub release with a single-binary
archive. Versions follow [semantic versioning](https://semver.org/); before 1.0, a minor
version may change the screen format or tool behavior, and the changelog says how.

## Checklist

1. **Measure.** Run the benchmarks that cover what changed, and the previous release on
   the same machine the same day (see [benchmarks](benchmarks.md)). Put the numbers in
   `docs/benchmarks.md` and `docs/benchmarks.zh-CN.md` if they changed.
2. **Bump the version** in both places:
   - `core/package.json` (`"version"`)
   - `core/src/mcp.ts` (the `McpServer` version)
3. **Update the changelog.** In `CHANGELOG.md` and `CHANGELOG.zh-CN.md`, rename
   *Unreleased* / *未发布* to the new version and date, add a new empty *Unreleased*
   section, and add the compare link at the bottom.
4. **Check.**

   ```sh
   (cd core && bun test && bun run typecheck)
   bun scripts/check-docs.ts
   ```

5. **Commit and tag.**

   ```sh
   git commit -am "release: v0.7.0"
   git tag v0.7.0
   git push origin master v0.7.0
   ```

6. **Build** on an Apple silicon Mac:

   ```sh
   ./scripts/release.sh v0.7.0   # -> dist/ocu-v0.7.0-macos-arm64.tar.gz
   ```

   The archive holds `ocu` (the core compiled with Bun, no Bun needed to run it),
   `ocu-mac`, `install.sh`, both READMEs and the license.
7. **Try the archive** on a clean path before publishing:

   ```sh
   cd "$(mktemp -d)" && tar xzf /path/to/dist/ocu-v0.7.0-macos-arm64.tar.gz
   OCU_HOME="$PWD/home" sh ocu-v0.7.0-macos-arm64/install.sh
   "$PWD/home/ocu" doctor
   ```

   Note that `install.sh` always links `~/.local/bin/ocu` to the copy it installs. Run
   your normal install again afterwards.
8. **Publish.**

   ```sh
   gh release create v0.7.0 dist/ocu-v0.7.0-macos-arm64.tar.gz \
     --title v0.7.0 --notes-file notes.md
   ```

   Release notes: one or two sentences on what the release is about, the measured
   numbers if it is a speed release, the latest comparison with agent-desktop (the
   totals, with a link to [benchmarks](benchmarks.md#compared-with-agent-desktop)), the
   user-visible changes, behavior changes for MCP callers, known limits, and the install
   lines:

       Install: `brew install kadaliao/tap/ocu`, or
       `tar xzf ocu-v0.7.0-macos-arm64.tar.gz && sh ocu-v0.7.0-macos-arm64/install.sh`
9. **Update Homebrew.** `gh workflow run bump.yml -R kadaliao/homebrew-tap` moves the
   `ocu` formula to the new release at once (it also runs every 6 hours).
