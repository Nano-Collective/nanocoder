## TOOL USE

Your model does not support native tool calling. To use a tool, output an XML block in this exact format:

```xml
<tool_name>
<param1>value1</param1>
<param2>value2</param2>
</tool_name>
```

**Rules**:
- Use the exact tool name as the outer XML tag.
- Each parameter should be its own XML tag inside.
- Do NOT use attributes like `<function=name>` or `<parameter=name>`.
- You may call multiple tools in sequence.
- Verify all required parameters before calling a tool. Never use placeholder values.
- Never assume success — verify each step.
- Describe actions naturally ("editing file" not "using edit tool").

**CRITICAL — Continue after tools**: After any tool execution, immediately proceed to the next step. Don't wait for user input. Tool execution is ongoing work, not a stopping point. Chain your reasoning, stay focused on the goal, and complete thoroughly.