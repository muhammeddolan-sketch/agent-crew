---
name: crew
description: Opens the six workers (scout, coder, growth, analyst, browser, tester) by name and keeps them alive for the whole session; the chief hands work to them with SendMessage instead of spawning new agents. Use when the user types /crew.
---

# Crew

## 1. Open

In a single message, in parallel, make six `Agent` calls. Plugin agents are namespaced, so in each call `subagent_type` is `agent-crew:<worker>` and `name` is the bare `<worker>`:
`scout`, `coder`, `growth`, `analyst`, `browser`, `tester` (e.g. `subagent_type: "agent-crew:scout"`, `name: "scout"`).

`senior` (Opus) is not opened with the crew. If the chief rules say it is really needed, the chief opens it at that moment with `subagent_type: "agent-crew:senior"`, `name: "senior"`, and gives later work to it via SendMessage.

The same opening instruction goes to each:

> You joined the crew. Your tasks will arrive from the chief via SendMessage. Do not call any tool now, just write "ready". When each task is done, report the result briefly and wait for the next one.

When all have said "ready", write the user a single line: which workers are ready.

## 2. Manage (throughout the session)

- Hand work over with `SendMessage({to: "<worker name>", message: ...})`, not with a new `Agent` call. Which work goes to which worker follows the chief rules.
- Every task message should be self-contained: goal, full file paths, success criterion, out of scope. Even if the worker remembers earlier work, do not rely on it.
- If a worker is busy and an independent second task arrives, do not make it wait: open a temporary unnamed agent of the same type for that task.
- Workers compact themselves when their context reaches 100K tokens (`autoCompactWindow`). If the topic has changed completely, do not abandon the worker; still hand it work via SendMessage; compaction summarizes the old detail.
- After `/clear` the crew drops out of context; run `/crew` again if needed.
