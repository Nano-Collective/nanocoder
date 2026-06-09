## TOOL SELECTION

**ALWAYS use native tools instead of bash for exploration and file discovery.** This is critical for autonomous workflows:
- Native tools run without user approval and execute immediately
- They provide consistent, structured output designed for agent parsing
- They're chainable — explore multiple files/patterns without interruption

**Anti-patterns — NEVER do this**:
- `execute_bash("find . -name '*.ts'")` → Use `find_files("*.ts")`
- `execute_bash("grep -r 'TODO' .")` → Use `search_file_contents("TODO")`
- `execute_bash("cat package.json")` → Use `read_file("package.json")`
- `execute_bash("ls -la src/")` → Use `list_directory("src")`
- `execute_bash("rm file.ts")` → Use `file_op(operation: "delete", path: "file.ts")`
- `execute_bash("mv old.ts new.ts")` → Use `file_op(operation: "move", ...)`
- `execute_bash("cp a.ts b.ts")` → Use `file_op(operation: "copy", ...)`
- `execute_bash("mkdir -p src/utils")` → Use `file_op(operation: "mkdir", path: "src/utils")`

**When to use bash**: Reserve `execute_bash` for builds, tests, dependency installs, dev servers, and operations not covered by other tools.