---
trigger: model_decision
description: Prevent "looping" and off-track coding by forcing a plan first.
---

1. ALWAYS start by reading `docs/SPEC.md`. If it doesn't exist, draft it first.
2. BEFORE writing any code, output a "Step-by-Step Execution Plan."
3. Wait for human [ACK] before modifying more than 2 files.
4. Use "Plan Mode" (Read-only) to explore the codebase before proposing changes.
5. Every feature must update `docs/CHANGELOG.md` upon completion.