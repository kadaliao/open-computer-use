# 08. Homebrew and Intel builds

- **Status:** planned
- **Priority:** P1. Installing is the first thing every new user hits.
- **Depends on:** 02 (version command, release guard)
- **Size:** one session

## Why

Installing ocu today means `gh release download`, `tar` and `sh install.sh`, on Apple
silicon only. Releases are built by hand on the maintainer's Mac with
`scripts/release.sh`.

## What agent-desktop does

- **npm.** One package carries per-platform binaries in `bin/`
  (`agent-desktop-darwin-arm64`, `-darwin-x64` and their helpers), each with a `.sha256`
  file. `postinstall` checks the digest and hard-links the matching binary. If that
  fails, it downloads the release archive and checks it against `checksums.txt`.
- **Builds.** Separate arm64 and x86_64 builds, x86_64 cross-built on a hosted macOS
  runner. No universal binaries, no notarization. Releases carry build-provenance
  attestations (`.github/workflows/release.yml`).
- **Homebrew.** `brew install agent-desktop` comes from homebrew-core, built from source
  and bumped automatically.

## Current state

- `scripts/release.sh` builds `dist/ocu-<version>-macos-<arch>.tar.gz` for the build
  machine's architecture.
- `install.sh` copies to `~/.local/share/ocu`, removes quarantine and signs ad hoc.
- The maintainer's tap `kadaliao/homebrew-tap` already serves other tools (formulae
  `sessift`, `smd`, `tizi`). It has a `bump.yml` workflow that updates formulae to new
  releases, run by hand or every 6 hours.

## Plan

1. **Both architectures.**
   - Helper: `swift build -c release --arch arm64 --arch x86_64` (or two builds).
   - Core: `bun build --compile --target=bun-darwin-arm64` and `--target=bun-darwin-x64`.
   - Ship one archive per architecture, plus a `checksums.txt`. Don't `lipo` the Bun
     executables: their embedded payload may not survive it.
2. **A release workflow** (`.github/workflows/release.yml`, on tag push): runs the CI
   checks, builds both archives on `macos-latest`, writes checksums, and creates the
   GitHub release as a draft for the maintainer to edit and publish. Build-provenance
   attestation (`actions/attest-build-provenance`) is cheap to add.
3. **Homebrew formula** `Formula/ocu.rb` in `kadaliao/homebrew-tap`:
   - binary download per architecture, installing `ocu` and `ocu-mac` side by side in
     `libexec`, with `ocu` linked into `bin`;
   - a `test do` block running `ocu --version`;
   - check whether the binaries need the ad hoc signature `install.sh` applies, and add
     it in `install` if so.

   Make sure `bump.yml` picks it up. Then `brew install kadaliao/tap/ocu` works.
4. **Docs.** README install section (Homebrew first, archive second), releasing (the new
   workflow, plus running `gh workflow run bump.yml -R kadaliao/homebrew-tap` after
   publishing), troubleshooting. Both languages.

## Out of scope

npm (Bun users can already run from a checkout), and homebrew-core (needs a build from
source and more users first). Notarization: revisit if Gatekeeper complaints show up.

## Done when

- A tag push produces a draft release with arm64 and x86_64 archives and checksums.
- `brew install kadaliao/tap/ocu && ocu --version && ocu doctor` works on Apple silicon.
  If an Intel Mac is available, test it there too; otherwise say it wasn't tested.
- Install docs are updated in both languages.
