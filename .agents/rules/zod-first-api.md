---
trigger: model_decision
description: description: Prevent runtime crashes by enforcing strict data validation
---

1. Every API route MUST have a Zod schema for request body and query params.
2. Validation must happen at the TOP of the function.
3. Return consistent error shapes: `{ error: string, code: string, details?: any }`.
4. Use `unknown` instead of `any` for untrusted input; use type guards.
5. Database queries must use the Prisma/Drizzle client from `@/lib/db`.