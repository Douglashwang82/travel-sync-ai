---
trigger: model_decision
description: Ensure UI consistency and zero-friction styling
---

1. Use `shadcn/ui` components located in `@/components/ui`.
2. Check if a component exists before creating a new one: `ls src/components/ui`.
3. If a component is missing, install it: `npx shadcn@latest add [name]`.
4. Use Tailwind CSS utility classes exclusively. NO custom CSS files.
5. Use the `cn()` utility for conditional classes to avoid string concatenation bugs.