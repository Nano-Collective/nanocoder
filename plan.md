Analysis & Plan for /rename Session Naming Feature

 ---

 Phase 1: Discovery & Understanding

 1.1 Explore Current Indicator Bar Structure
 • Locate where "Development mode" text is rendered in the
 CLI UI
 • Find the component that renders status indicators (likely
 in source/components/)
 • Identify how context-used indicator is displayed
 • Map the current layout hierarchy

 1.2 Understand Command Registration System
 • Examine existing /commands directory to see how built-in
 commands are structured
 • Find similar simple commands (like /clear, /mode, etc.)
 as reference patterns
 • Document the command handler interface and lifecycle

 1.3 Trace Session State Management
 • Review useAppState.tsx or equivalent state hook
 • Identify what session metadata currently exists
 • Determine where new session properties should be added

 ---

 Phase 2: Architecture Decisions

 2.1 State Layer
 • Add sessionName?: string property to session state
 interface
 • Decide if name persists across sessions or only within a
 session
 • Consider if name needs to be stored in history/metadata

 2.2 UI Layer
 • Create/update indicator bar component to include optional
 session name display
 • Position: after context indicator, before any closing
 elements
 • Style: consistent with existing indicators (color,
 spacing, icon)

 2.3 Command Layer
 • Create rename-command.tsx (or .ts) following existing
 patterns
 • Handler receives parameter via Ink.js argument parsing
 • Validates input (non-empty, reasonable length limits)
 • Updates session state and triggers UI refresh

 ---

 Phase 3: Implementation Tasks

 Task A: State Changes
 1. Update session state type/interface to include name
 field
 2. Add setter function for updating session name
 3. Ensure reactive update propagates to UI components

 Task B: UI Component Updates
 1. Locate/identify the indicator bar component
 2. Add conditional rendering for session name
 3. Ensure proper spacing between "context used" and new
 name
 4. Handle edge cases: no name shown vs. long names
 (truncation?)

 Task C: Command Creation
 1. Create new command file following project conventions
 2. Register command in command registry/dispatcher
 3. Implement:
    • Parameter validation
    • State mutation via provided setter
    • Error handling for invalid inputs
    • Success feedback message

 Task D: Integration & Testing
 1. Verify command appears in help/documentation
 2. Test command with valid/invalid inputs
 3. Confirm UI updates correctly after rename
 4. Check that name persists through conversation flow

 ---

 Phase 4: Edge Cases to Consider

 ┌────────────────────────┬───────────────────────────┐
 │ Scenario               │ Handling                  │
 ├────────────────────────┼───────────────────────────┤
 │ Empty name input       │ Reject with error message │
 ├────────────────────────┼───────────────────────────┤
 │ Name too long          │ Truncate it up to 100chars│
 ├────────────────────────┼───────────────────────────┤
 │ Special characters     │ Sanitize.                 │
 ├────────────────────────┼───────────────────────────┤
 │ Rename during active   │ Queue or defer until      │
 │ generation             │ complete                  │
 ├────────────────────────┼───────────────────────────┤
 │ Clear/reset session    │ the name should be cleared│
 └────────────────────────┴───────────────────────────┘

 ---

 Recommended File Locations

 Based on existing structure:
 • Command: source/commands/rename-command.tsx
 • State update: source/context/use-state.tsx (or wherever
 useAppState lives)
 • UI component: Likely source/components/session-bar.tsx or
 similar indicator component

 ---

 Estimated Complexity: Low-Medium
 This is a straightforward feature with minimal risk since
 it doesn't affect core functionality — only adds metadata
 display and one new command.