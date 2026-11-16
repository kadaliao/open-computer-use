# Plans

Design notes for the work on the [roadmap](../roadmap.md), one file per piece of work.
Each plan is written so that a new session, human or agent, can pick it up with no
other context. These are working documents, so they are in English only.

## Working on a plan

1. Take the next plan in roadmap order whose status is `planned` and whose dependencies
   are done. Read it, [AGENTS.md](../../AGENTS.md) and the code it points to.
2. If the code no longer matches the plan, fix the plan first, in its own commit.
3. Set its status to `in progress`. Work on a branch; one plan per pull request.
4. Measure before and after with the benchmarks the plan names (see
   [benchmarks](../benchmarks.md)), and put the numbers in the pull request.
5. Before merging:
   - update the user docs in both languages and add the changes to both changelogs under
     *Unreleased* / *未发布*;
   - set the plan's status to `done (<version or commit>)` and add a short "Outcome"
     section: what shipped, the numbers, what was left out;
   - update the status column in [roadmap.md](../roadmap.md) and
     [roadmap.zh-CN.md](../roadmap.zh-CN.md) (`planned` 计划中, `in progress` 进行中,
     `done` 已完成, `dropped` 已放弃).

A plan that turns out to be a bad idea is marked `dropped`, with the reason, rather than
deleted.

## Writing a plan

Use the sections the existing plans use: status, priority, dependencies and size; Why
(with evidence); what agent-desktop or others do, if relevant; current state in ocu, with
file and function names; Plan; Out of scope; Done when (checkable); Notes.
