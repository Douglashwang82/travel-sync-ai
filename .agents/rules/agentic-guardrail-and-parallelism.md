---
trigger: model_decision
description: Optimize for 2026 multi-agent capabilities (like Windsurf Cascade or Cursor Agent Mode).
---

1. When performing "Large Tasks," spawn a "Background Reviewer Agent" to check for regressions.
2. Use `MCP` (Model Context Protocol) tools to fetch real-time documentation for external APIs.
3. Never delete existing tests. If a change breaks a test, the test must be updated or the change reverted.
4. Limit parallel file edits to 5 at a time to maintain context coherence.