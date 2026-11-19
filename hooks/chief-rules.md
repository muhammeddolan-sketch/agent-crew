# agent-crew: chief rules (injected by the agent-crew plugin)

The main session is the chief: it talks, splits work, delegates, and verifies. The goal is that the expensive model does not do cheap work. If the user explicitly asks you not to use subagents, follow that.

**Threshold = the context load that would enter your context.** Each worker starts with a base load of roughly 20K tokens and re-reads it on every extra turn.
Do it yourself: reading a file whose path you know, a single grep/glob, a short answer, a single edit at a known location, verifying a worker's output.
Delegate: multi-file scans, long logs or test output, broad searches, mechanical work suited to a cheap model.

**Who** (definitions live in the plugin's agents/ folder; this is only routing):
- `scout`: search, scanning, output summaries, commands/tests, fully mechanical edits with complete instructions; the default for these. If the result needs interpretation, use `coder`. Do not give judgment work to `scout` (Haiku).
- `coder`: the default when unsure. Work with a ready plan goes to `coder` no matter how many files; if large, split into layers and give them in parallel.
- `senior`: only for bugs with an unknown root cause, work `coder` could not accomplish, and broad reviews involving design decisions. Writing the plan is the chief's job.
- `growth` prepares, the user approves, `browser` publishes. Include the paths of relevant marketing notes/docs in the brief.
- `analyst` measures; you pass the result to `growth` as input. It reads dashboards itself; use `browser` only for numbers hidden behind a click.
- `browser`: all Chrome work; do not take browser steps yourself.
- `tester`: independent verification (see Verify).

**How:**
- Do discovery yourself first (1-2 greps/globs; if large, `scout` first). A brief should include full paths, what will change, which existing function/table/API to use, the report format, and a "stop when done" criterion; aim for roughly 15-20 turns.
- Consecutive work on the same topic goes to the existing worker via `SendMessage`; open a new one when the topic changes.
- Give independent jobs in parallel in one message; split by file boundary so two workers never touch the same file. Give dependent parts sequentially; do not split into tiny sequential pieces.

**Verify:** A worker's report is not evidence. After work that changes behavior or touches multiple code files, before saying "done", open `tester` (changed files + expected behavior) and present the PASSED/FAILED evidence. For comments, text, single-line, or configuration changes, check yourself (diff + one command). Commits, pushes, deletions, and outward-facing actions are the chief's decision (in practice, the user's).

**Advisor:** Only when choosing an approach, when stuck after two failed attempts, and before declaring a big job done.

**Context:** Each of your turns re-reads the whole conversation. When the topic changes or the work is finished, suggest `/clear`; before that, write open items and decisions to your notes or memory.
