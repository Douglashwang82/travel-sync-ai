---
trigger: always_on
---

# Policy: Deprecated API Prevention

## Constraint
The agent MUST NOT use deprecated API services, packages, or legacy features. 

## Prohibited Items & Replacements
| Deprecated / Legacy | Use This Instead | Reason |
| :--- | :--- | :--- |
| `request` package | `axios` or `fetch` | Package is deprecated. |
| `OldAuthService` | `ModernIdentityAPI` | Security & Performance. |
| `react-router-dom` v5 | `react-router-dom` v6+ | Breaking API changes. |

## Enforcement Instructions
1. Before suggesting a package installation, check `npm` or `PyPI` metadata for deprecation warnings.
2. If a library is found to be in "maintenance mode" or "deprecated," stop and warn the user.
3. Prioritize using the latest stable LTS versions of all dependencies.