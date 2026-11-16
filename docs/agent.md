# Built-in agent

**English** · [简体中文](agent.zh-CN.md)

`ocu run` carries out a goal on its own, with any OpenAI-compatible chat model as the
planner. Over MCP, the same agent is the `run_task` tool.

- [Running it](#running-it)
- [Models](#models)
- [Batches and the local finish check](#batches-and-the-local-finish-check)
- [Guards](#guards)
- [Screenshot fallback](#screenshot-fallback)
- [Action cache](#action-cache)

## Running it

```sh
export DEEPSEEK_API_KEY=...
ocu run "Create a new note in Notes that says hello"
ocu run "Use Calculator to work out 37 times 12 and tell me the result" --no-cache
```

Each step is logged as it runs. At the end ocu prints the outcome, the number of planner
calls, and where the time went:

    done in 3.9s, 2 planner calls (observe 1150 + model 1800 + wait 600 + actions 400 ms)

The exit code is 0 when the goal was reached and 1 otherwise. A run stops after 25
planner turns. `--no-cache` skips the [action cache](#action-cache) for this run.

## Models

Each turn, the agent reads the screen and asks the planner for the next steps. Optional
models can save time:

| Model | Required | Set with | What it does |
| --- | --- | --- | --- |
| Planner | yes | `DEEPSEEK_API_KEY`, or `OCU_BASE_URL` + `OCU_API_KEY` + `OCU_MODEL` | Plans a batch of steps per turn. Defaults to DeepSeek `deepseek-chat` |
| Jev done judge | no | `TYPESAFE_API_KEY` | Runs alongside the planner from the second turn on and judges whether the goal is already met. When it is at least 90% sure but the planner wants to keep going, the planner is asked once more with that hint |
| Jev press mode | no | `TYPESAFE_API_KEY` + `OCU_JEV_PRESS=1` | Jev picks the next one or two presses. They are used if the planner hasn't answered within 400 ms |
| Fast model | no | `OCU_FAST_MODEL`, or `OCU_FAST_URL` | A quick model that proposes one step. It falls back to the planner when unsure or slow |
| Vision | no | `STEPFUN_API_KEY`, or `OCU_VISION_*` | The [screenshot fallback](#screenshot-fallback) |

Jev is [TypeSafe](https://typesafe.ai)'s classifier model. Once the planner has answered,
the done judge gets only 300 ms more, so a slow judge can't add seconds to every turn.
[Configuration](configuration.md) lists every variable and default.

Each planner round trip costs about a second, so the agent is built to need few of them.
In the 0.6.0 benchmark the model still took more than half of the time.

## Batches and the local finish check

The planner sends a batch of steps per turn.

**What may follow a screen change.** After a step that changes the screen, the batch
waits for the screen to settle and then goes on with two kinds of steps:

- steps that need no ref: keys, typing into the focused field, menus, opening apps or
  URLs, `find_text`;
- steps whose element is still there, unchanged, after a small change (select all, then
  Bold).

Anything else ends the batch, and the planner looks at the new screen.

**Finishing without another model call.** A batch may end with `done` plus `expect`: a
text that only appears once the goal is achieved, such as the new window title, the
calculator's result or the start of the typed text. The agent checks for it locally and
finishes without asking the planner again. The check is strict:

- The text must show up in the window title, or in content that was not on screen before
  the batch. Controls and one-line fields don't count.
- Numbers and words match as whole tokens: `444` is not in `4,440`.
- Text the batch typed counts only when typing was the batch's last step and a text area
  now holds exactly that text. An error message that repeats it is no proof.
- A window or dialog that came up at the end sends the turn back to the planner.
- For questions, the expected text must be the answer in the summary, not words from the
  goal.
- A summary may not state numbers or quoted names that are not in the goal, on the
  screen, or in earlier reads.

When in doubt, the planner looks. Without `expect`, `done` needs a look at the screen
first.

## Guards

- The same action on an unchanged screen is not repeated. The planner is told it did
  nothing and asked to try another way.
- A planner that alternates between the same two actions is stopped and told to record
  what it needs with `note` and move on.
- A `done` whose summary covers only part of the goal, or claims something that is not
  on screen, is not accepted.

The planner also has two actions that are not on the [actions list](concepts.md#actions):
`note {text}` records a fact for later turns (for example before switching apps), and
`done {summary, expect?}` ends the run.

## Screenshot fallback

When an element is missing from the accessibility tree (canvas apps, games, some
Electron apps), the planner can use two more actions:

- `click_visual {target}`: screenshots the window, locates the described element with a
  GUI grounding model, and clicks it. Your cursor is put back afterwards.
- `read_visual {question}`: asks a vision model about the window. The answer goes into
  the history for the next turn.

Both need a vision key and Screen Recording permission. The defaults are StepFun
`step-gui` for locating (0–2 pt error on Calculator's buttons) and
`step-1o-turbo-vision` for reading. See [vision models](configuration.md#vision-models)
for alternatives.

## Action cache

A successful run is saved as "goal pattern → steps" in `~/.cache/ocu/actions.json`,
keyed by the app that was frontmost at the start. The next run of a matching goal
replays the steps first.

- **Parameters.** Quoted strings and numbers in the goal become parameters, so
  `Calculate 37 times 12` replays for `Calculate 906 times 7`. Keypad presses that spell
  a parameter are spelled again with the new value.
- **Elements by role and label.** Steps store the element's role and label, not its ref,
  and are matched to fresh refs on replay.
- **Checked after replay.** After a replay the planner checks the screen once. If it has
  to fix anything, the entry is dropped and the next run records afresh.
- **No-model replays.** When a run finished with `done` + `expect` and the expected text
  was the goal's own text (a parameter such as the note's content or a name), the entry
  keeps that expect. A replay that brings it on screen finishes without any model call.
  Results, counts or titles read off the old screen are never replayed; the planner
  checks them.
- **Not cached.** Runs that read content (`find_text`, `read_visual`, `note`), because
  their results change.

`ocu cache` lists the entries with their hit counts; `ocu cache clear` deletes them.
`OCU_CACHE=0` turns the cache off, and `OCU_CACHE_FILE` moves it. The benchmark turns it
off unless `OCU_CACHE=1`.
