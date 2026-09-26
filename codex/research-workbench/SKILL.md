---
name: research-workbench
description: Read and maintain structured questions, experiments, runs, results and evidence in an existing local Research Workbench, and open its browser views for research review.
---

# Research Workbench

Use the package containing this skill. Its root is two levels above this directory. Read [the package README](../../README.md) for supported commands and record fields. This bundled skill is not globally installed; do not change project instruction files or global Codex settings merely to activate it.

The browser presents curated records, not every file or every conversation in the workspace. Inspect the current import scope before claiming coverage. Use `node src/cli.mjs export` from the package root and read `data/export.json` for IDs and current revisions. Start the browser with `node src/cli.mjs serve --open`; inspect a precise view by its query parameters.

When maintaining an authorized research task:

- Reuse an existing question where appropriate; keep the experimental design separate from each actual run.
- Register observations as results and interpretations as conclusions. Conclusions retain limits and explicit supporting, qualifying or contradicting evidence.
- Write a batch JSON inside the package's `data/` directory and commit with `node src/cli.mjs record data/<file>.json`. A result must link to a run; a conclusion must link to evidence. Use actual source artifacts, not invented measurements.
- Existing source paths are relative to the workspace root. The importer and source server read those files without changing them. Package state and logs remain inside the package.
- Imported objects are adapter-managed. Add a follow-up object instead of overwriting them. Updating a manually recorded object requires its `expectedRevision` and the complete revised object.
- Run `node src/cli.mjs check` after a batch. Report unresolved evidence, missing provenance and failed runs accurately; a completed job does not automatically resolve a scientific question.

Read the local workspace instructions for source-write restrictions. The default checkout contains fictional demo data only. Inspect local/workspace.json, when present, to locate the configured source root; source paths are relative to that root, not necessarily the package parent. Keep real research summaries, local adapters, databases and screenshots out of public commits. This skill supports record maintenance; it does not authorize publication of research data.
