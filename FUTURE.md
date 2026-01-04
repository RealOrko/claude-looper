# Prompt Analysis & Recommendations for claude-looper

## Executive Summary

The prompt system is well-structured with clear role separation and hierarchical verification. However, there are significant opportunities for improvement around **context management**, **drift prevention**, and **learning from failures**.

---

## 1. Context Length Issues

### Current State
- **No truncation**: Full `previousAttempts`, `completedTasks`, and `codeContext` are passed without limits
- **Unbounded growth**: Deep replanning (up to 5 levels) compounds context size exponentially
- **No summarization**: Raw outputs passed verbatim between agents

### Problem Areas

| Template | Context Variable | Risk |
|----------|-----------------|------|
| `implement.hbs` | `completedTasks` | Grows linearly with plan size (up to 15 tasks × depth) |
| `implement.hbs` | `previousAttempts` | Up to 3 attempts × full output |
| `replan.hbs` | `previousAttempts` | Nested replans inherit parent attempt history |
| `verify.hbs` | `agentOutput` | Full implementation output, unbounded |
| `fix.hbs` | `previousFixes` | Up to 3 cycles × full diff history |

### Recommendations

#### R1.1: Implement context budgets per template
```javascript
// In agent-executor.js
const CONTEXT_BUDGETS = {
  'coder/implement': { previousAttempts: 2000, completedTasks: 1000 },
  'supervisor/verify': { agentOutput: 5000 },
  'coder/fix': { previousFixes: 1500 }
};
```

#### R1.2: Add summarization for previous attempts

Instead of passing full outputs in `implement.hbs`:
```handlebars
{{#each previousAttempts}}
### Attempt {{this.attemptNumber}}: {{this.result}}
**Key Issues:** {{this.issuesSummary}}  <!-- NEW: summarized, not full feedback -->
**Files Touched:** {{this.filesModified}}
{{/each}}
```

#### R1.3: Progressive context compression for deep replans
```javascript
// When replanDepth > 2, compress ancestor context
if (task.replanDepth > 2) {
  context.ancestorSummary = summarizeAncestorChain(task);
  delete context.previousAttempts; // Use summary instead
}
```

#### R1.4: Add token counting and warnings
```javascript
renderTemplate(templatePath, context) {
  const rendered = this.templates[templatePath](context);
  const estimatedTokens = rendered.length / 4;
  if (estimatedTokens > 8000) {
    this.emit('warning', `Prompt exceeds 8K tokens: ${templatePath}`);
  }
  return rendered;
}
```

---

## 2. Intent Clarity Issues

### Current State
- Templates mix instructions with output format
- Some scoping is implicit rather than explicit
- Verification criteria are unstructured strings

### Problem Areas

**`plan.hbs`** - Intent ambiguity
```
"Each task should be completable in a single focused session"
```
What is a "focused session"? 10 minutes? 2 hours? This is subjective.

**`implement.hbs`** - Missing explicit boundaries
```
"Match the existing code style and patterns in the codebase"
```
No mechanism to actually provide code style examples.

**`verify.hbs`** - Scope is well-defined BUT scoring is subjective
```
"70-100: Approve - work meets THIS ITEM's requirements"
```
No explicit rubric for what earns 70 vs 85 vs 100.

### Recommendations

#### R2.1: Add explicit task sizing criteria
```handlebars
## Task Sizing Guidelines
- **Simple (1 point)**: Single file, < 50 lines changed, no new dependencies
- **Medium (2 points)**: 2-3 files, < 200 lines, may add internal utilities
- **Complex (3 points)**: 4+ files, architectural changes, or external integrations

If a task doesn't fit these bounds, break it down further.
```

#### R2.2: Inject code style examples into coder context
```javascript
// In agent-coder.js
const codeStyle = await extractStyleFromFile(
  context.filesModified[0] || 'src/index.js'
);
templateContext.codeStyleExample = codeStyle;
```

#### R2.3: Structured verification rubric in `verify.hbs`
```handlebars
## Scoring Rubric

| Score Range | Criteria Met | Issues |
|-------------|--------------|--------|
| 90-100 | All verification criteria + clean implementation | 0 issues |
| 70-89 | All verification criteria | 1-2 minor issues |
| 50-69 | Partial criteria met | 3+ issues or 1 major |
| <50 | Core criteria unmet | Blocking issues |

Score each criterion explicitly before calculating total.
```

#### R2.4: Add task contract assertions
```handlebars
## Task Contract
INPUT REQUIREMENTS:
{{#each task.inputRequirements}}
- {{this}}
{{/each}}

OUTPUT REQUIREMENTS:
{{#each task.verificationCriteria}}
- [ ] {{this}}
{{/each}}

You MUST check each output requirement before calling implementationComplete.
```

---

## 3. Drift/Hallucination Guards

### Current State
- **Good**: Hierarchical scope enforcement in `verify.hbs`
  ```
  SCOPE: You are verifying a SUBTASK. Evaluate whether it satisfies its PARENT TASK's requirements.
  ```
- **Good**: Explicit "DO NOT" boundaries
  ```
  Do NOT reject because:
  - Other tasks/subtasks remain incomplete
  ```
- **Missing**: Output verification before tool calls
- **Missing**: State assertions / invariant checks
- **Missing**: Checksums or hashes for file modifications

### Problem Areas

**No grounding on actual filesystem state**

The prompts accept `implementation.filesModified` at face value without verification:
```handlebars
## Files Modified
{{#each implementation.filesModified}}
- {{this}}
{{/each}}
```
The agent could claim to modify files it didn't touch.

**No drift detection between attempts**

When the coder makes multiple attempts, there's no check that attempt N+1 builds on attempt N rather than starting over.

**Supervisor can be fooled by confident but wrong outputs**

The scoring in `verify.hbs` relies entirely on the agent's assessment with no external validation.

### Recommendations

#### R3.1: Add filesystem verification to tester template
```handlebars
## Pre-Test Verification
Before running tests, verify these files exist and were recently modified:
{{#each implementation.filesModified}}
- [ ] {{this}} (verify with: ls -la {{this}} | head -1)
{{/each}}

If any files are missing or unchanged, report status as "blocked" with details.
```

#### R3.2: Add state assertions to implement.hbs
```handlebars
## State Assertions

Before calling implementationComplete, verify:
1. Each file in filesModified actually exists: `test -f <path>`
2. Each test in testsAdded runs without error: `npm test -- <testfile>`
3. No untracked changes outside the task scope: `git diff --stat`

Include the output of these checks in your response.
```

#### R3.3: Add drift detection for repeated attempts
```handlebars
{{#if previousAttempts}}
## Drift Prevention Check

Your previous attempts modified these files:
{{#each previousAttempts}}
- Attempt {{this.attemptNumber}}: {{this.filesModified}}
{{/each}}

REQUIREMENT: Your current approach must either:
1. Build on previous changes (explain what you're adding), OR
2. Explicitly revert and explain why a fresh approach is needed

Do NOT silently ignore previous work.
{{/if}}
```

#### R3.4: Add external validation hooks

Add a `--verify` flag that the coder must run:
```handlebars
## Verification Command

After implementation, run this command and include its output:
```bash
{{verificationCommand}}
```

If the command fails, the implementation is incomplete.
```

#### R3.5: Hash-based change tracking
```javascript
// Before sending to coder
const fileHashes = await hashFiles(task.relevantFiles);
templateContext.expectedHashes = fileHashes;

// In template
## File Integrity
Expected file states (SHA256):
{{#each expectedHashes}}
- {{this.path}}: {{this.hash}}
{{/each}}

Report if any files were modified unexpectedly.
```

---

## 4. Replanning & Execution Improvements

### Current State
- **Good**: Strict escalation enforcement in orchestrator (can't skip retry→replan→impossible)
- **Good**: Depth limits prevent infinite recursion
- **Missing**: Pattern learning across similar failures
- **Missing**: Cross-task context when replanning
- **Weak**: Subtask creation doesn't leverage failure patterns

### Problem Areas

**`replan.hbs` doesn't analyze failure patterns across tasks**
```handlebars
{{#each previousAttempts}}
- Approach: {{this.approach}}
- Result: {{this.result}}
{{/each}}
```
This only shows attempts for the current task, not similar failures from other tasks.

**No learning accumulation**

Each replan starts fresh without leveraging what worked/failed in similar contexts.

**Subtask verification criteria are disconnected**

When breaking a task into subtasks, the subtask criteria don't explicitly map back to parent criteria.

### Recommendations

#### R4.1: Add failure pattern context to replan.hbs
```handlebars
{{#if similarFailures}}
## Similar Failures in This Session
Other tasks that failed for similar reasons:
{{#each similarFailures}}
- **{{this.taskDescription}}**: {{this.failurePattern}}
  - Resolution: {{this.resolution}}
{{/each}}

Consider these patterns when creating subtasks.
{{/if}}
```

#### R4.2: Explicit parent-child criteria mapping
```handlebars
## Subtask Criteria Mapping

For each subtask, specify which parent verification criteria it addresses:

Parent Criteria:
{{#each task.verificationCriteria}}
{{@index}}. {{this}}
{{/each}}

Each subtask must reference at least one parent criterion by index.
```

#### R4.3: Add "lessons learned" accumulator
```javascript
// In agent-core.js
recordLesson(taskId, lesson) {
  this.lessons.push({
    taskPattern: task.description.substring(0, 100),
    failureType: lesson.type,
    resolution: lesson.resolution,
    timestamp: Date.now()
  });
}

// Pass to planner
templateContext.recentLessons = this.getRelevantLessons(task);
```

#### R4.4: Add complexity re-estimation on replan
```handlebars
## Complexity Re-Estimation

The original task was rated: {{task.complexity}}
After {{attempts}} failed attempts, re-evaluate:

1. Was the complexity under-estimated? (likely if attempts > 2)
2. What specific aspect was harder than expected?
3. Assign complexity ratings to subtasks that total at least {{originalComplexityPoints}} points.
```

#### R4.5: Add dependency inference for subtasks
```handlebars
## Subtask Dependencies

When creating subtasks:
1. Identify which subtasks can run in parallel (no dependencies)
2. Identify which require outputs from others
3. Mark explicit dependencies in the subtask array

Avoid creating long chains - prefer parallel execution where possible.
```

---

## 5. Structural Improvements

#### R5.1: Separate concerns in templates

Split `verify.hbs` into focused variants:
- `verify-implementation.hbs` - For coder outputs
- `verify-plan.hbs` - For planner outputs
- `verify-test.hbs` - For tester outputs

Each can have specialized criteria relevant to that output type.

#### R5.2: Add template versioning
```handlebars
{{!-- Template: supervisor/verify.hbs v2.1 --}}
{{!-- Last modified: 2024-01-15 --}}
{{!-- Breaking changes: Added hierarchical scope section --}}
```

#### R5.3: Add explicit tool call format examples
```handlebars
## Output Format

Call `implementationComplete` exactly like this example:
```json
{
  "status": "complete",
  "summary": "Added user authentication with JWT tokens",
  "filesModified": ["src/auth.js", "src/middleware/auth.js"],
  "testsAdded": ["test/auth.test.js"],
  "commands": ["npm install jsonwebtoken"]
}
```
```

#### R5.4: Add self-check prompts
```handlebars
## Pre-Submission Checklist

Before calling {{toolName}}, verify:
- [ ] I have addressed ALL verification criteria
- [ ] I have not modified files outside the task scope
- [ ] I have included actual output, not summaries
- [ ] My status accurately reflects the work state

If any check fails, address it before submitting.
```

---

## 6. Priority Matrix

| Recommendation | Impact | Effort | Priority |
|----------------|--------|--------|----------|
| R1.1: Context budgets | High | Medium | **P1** |
| R3.3: Drift detection | High | Low | **P1** |
| R3.1: Filesystem verification | High | Low | **P1** |
| R2.3: Scoring rubric | Medium | Low | **P1** |
| R1.2: Attempt summarization | High | Medium | **P2** |
| R4.2: Parent-child criteria | Medium | Low | **P2** |
| R3.4: External validation hooks | High | Medium | **P2** |
| R4.1: Failure pattern context | Medium | Medium | **P2** |
| R5.4: Self-check prompts | Medium | Low | **P2** |
| R1.3: Progressive compression | Medium | High | **P3** |
| R3.5: Hash-based tracking | Medium | High | **P3** |
| R4.3: Lessons accumulator | Low | High | **P3** |

---

## Summary

The current system is well-architected with good separation of concerns and escalation logic. The main gaps are:

1. **Context explosion** - No limits on how much history is passed, leading to potential token exhaustion on deep replans
2. **Ungrounded assertions** - Agents can claim file modifications without verification
3. **No drift detection** - Repeated attempts don't explicitly build on each other
4. **Subjective scoring** - Verification lacks a concrete rubric
5. **No cross-task learning** - Each replan reinvents solutions

The highest-impact improvements are context budgets, drift detection, and filesystem verification - all relatively low effort with significant reliability gains.
