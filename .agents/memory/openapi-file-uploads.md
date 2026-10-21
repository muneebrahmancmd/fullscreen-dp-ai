---
name: OpenAPI file uploads
description: Orval-generated binary upload schemas can introduce browser-only types into Node-oriented shared packages.
---

When an OpenAPI multipart field uses `type: string` and `format: binary`, Orval can generate `File` or `Blob` references in the shared Zod/type packages. Those packages may be typechecked without DOM libraries, causing the generated build to fail.

**Why:** Code generation for a file-upload schema failed the workspace library typecheck because `File` and `Blob` were not available in the Node-oriented TypeScript environment.

**How to apply:** Before adding generated binary upload schemas, confirm the generated packages support the resulting DOM types. If not, choose an explicit Node-compatible contract/codegen strategy rather than silently leaving generated output uncompilable.