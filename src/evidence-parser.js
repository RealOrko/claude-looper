/**
 * Evidence Parser - Parses and evaluates evidence from completion claims
 *
 * Handles:
 * - File path extraction from responses
 * - Test/build command detection
 * - Code snippet extraction
 * - Evidence sufficiency evaluation
 */

/**
 * Parse evidence from Claude's challenge response
 */
export function parseEvidence(response) {
  const evidence = {
    files: [],
    testCommands: [],
    buildCommands: [],
    codeSnippets: [],
    subGoalConfirmations: 0,
    raw: response,
  };

  if (!response) return evidence;

  // Extract file paths (various formats)
  const filePatterns = [
    /`([^`\s]+\.\w+)`/g,                                    // `file.ext` in backticks
    /`([^`\s]+\/[^`\s]+)`/g,                                // `path/to/file` in backticks
    /(?:^|\s)(\.\/[\w\-\/\.]+\.\w+)/gm,                     // ./relative/path.ext
    /(?:^|\s)(src\/[\w\-\/\.]+\.\w+)/gm,                    // src/path.ext
    /(?:created?|modified?|wrote|edited?|updated?)\s+[`"]?([^\s`"]+\.\w+)[`"]?/gi,
    /(?:file|path):\s*[`"]?([^\s`"]+\.\w+)[`"]?/gi,
  ];

  const seenFiles = new Set();
  for (const pattern of filePatterns) {
    const matches = response.matchAll(pattern);
    for (const match of matches) {
      let filePath = match[1]?.trim();
      if (filePath && !seenFiles.has(filePath)) {
        if (!isLikelyFalsePositive(filePath)) {
          seenFiles.add(filePath);
          evidence.files.push(filePath);
        }
      }
    }
  }

  // Extract test commands
  const testPatterns = [
    /`(npm\s+(?:test|run\s+test)[^`]*)`/gi,
    /`(pytest[^`]*)`/gi,
    /`(go\s+test[^`]*)`/gi,
    /`(cargo\s+test[^`]*)`/gi,
    /`(make\s+test[^`]*)`/gi,
    /(?:run|execute|test):\s*`([^`]+)`/gi,
  ];

  for (const pattern of testPatterns) {
    const matches = response.matchAll(pattern);
    for (const match of matches) {
      const cmd = match[1]?.trim();
      if (cmd && !evidence.testCommands.includes(cmd)) {
        evidence.testCommands.push(cmd);
      }
    }
  }

  // Extract build commands
  const buildPatterns = [
    /`(npm\s+run\s+build[^`]*)`/gi,
    /`(go\s+build[^`]*)`/gi,
    /`(cargo\s+build[^`]*)`/gi,
    /`(make(?:\s+\w+)?)`/gi,
  ];

  for (const pattern of buildPatterns) {
    const matches = response.matchAll(pattern);
    for (const match of matches) {
      const cmd = match[1]?.trim();
      if (cmd && !evidence.buildCommands.includes(cmd)) {
        evidence.buildCommands.push(cmd);
      }
    }
  }

  // Count sub-goal confirmations (checked boxes)
  const checkboxMatches = response.match(/- \[x\]/gi);
  evidence.subGoalConfirmations = checkboxMatches ? checkboxMatches.length : 0;

  // Extract code snippets (content in code blocks)
  const codeBlockPattern = /```[\w]*\n([\s\S]*?)```/g;
  const codeMatches = response.matchAll(codeBlockPattern);
  for (const match of codeMatches) {
    const code = match[1]?.trim();
    if (code && code.length > 20) {
      evidence.codeSnippets.push(code.substring(0, 500));
    }
  }

  return evidence;
}

/**
 * Check if a file path is likely a false positive
 */
export function isLikelyFalsePositive(filePath) {
  const falsePositives = [
    /^https?:/i,           // URLs
    /^mailto:/i,           // Email links
    /^\d+\.\d+/,           // Version numbers
    /^[A-Z]+:/,            // Windows drive letters or labels
    /example\./i,          // Example files
    /placeholder/i,        // Placeholder text
  ];

  return falsePositives.some(pattern => pattern.test(filePath));
}

/**
 * Detect if this is a read-only/analysis task based on evidence response
 */
export function isReadOnlyTask(evidence) {
  const raw = (evidence.raw || '').toLowerCase();
  const readOnlyIndicators = [
    'no files were created',
    'no files were modified',
    'read-only',
    'analysis task',
    'counting task',
    'none - this was',
    '**none**',
    'none.',
    'did not create',
    'did not modify',
    'only ran commands',
    'only executed',
  ];
  return readOnlyIndicators.some(indicator => raw.includes(indicator));
}

/**
 * Evaluate if evidence is sufficient
 */
export function evaluateEvidence(evidence) {
  const isReadOnly = isReadOnlyTask(evidence);

  if (isReadOnly) {
    // For read-only tasks, require code snippets showing commands/output OR sub-goal confirmations
    return evidence.codeSnippets.length > 0 || evidence.subGoalConfirmations > 0;
  }

  // For file-creating tasks, must have files mentioned
  if (evidence.files.length === 0) {
    return false;
  }

  // Should have either code snippets or test/build commands
  const hasVerificationMethod =
    evidence.codeSnippets.length > 0 ||
    evidence.testCommands.length > 0 ||
    evidence.buildCommands.length > 0;

  return hasVerificationMethod;
}

/**
 * Build the challenge prompt for verification
 */
export function buildChallengePrompt(completionClaim, goal, subGoals = []) {
  return `## COMPLETION VERIFICATION REQUIRED

You claimed the task is complete. Before this can be accepted, you must provide concrete, verifiable evidence.

**Original Goal:** ${goal}

**Your Completion Claim:**
${completionClaim.substring(0, 800)}

---

**REQUIRED EVIDENCE - Respond with ALL of the following:**

### 1. FILES CREATED OR MODIFIED
List every file you created or modified. Use exact paths (relative to working directory or absolute).
Format each as: \`path/to/file.ext\`

### 2. KEY IMPLEMENTATION
Show the most critical piece of code you wrote. Include:
- File path
- The actual code (not a description)

### 3. VERIFICATION METHOD
How can this be tested? Provide ONE of:
- Test command to run (e.g., \`npm test\`, \`pytest\`)
- Build command (e.g., \`npm run build\`)
- Manual verification steps

### 4. SUB-GOAL CHECKLIST
Confirm each sub-goal is complete:
${subGoals.length > 0
  ? subGoals.map(g => `- [ ] ${g.description}`).join('\n')
  : '- [ ] Primary goal completed'}

---

**IMPORTANT:**
- Be specific. Vague responses will be REJECTED.
- List actual file paths, not descriptions.
- If you cannot provide evidence, admit it and continue working.

Provide your evidence now:`;
}

export default {
  parseEvidence,
  isLikelyFalsePositive,
  isReadOnlyTask,
  evaluateEvidence,
  buildChallengePrompt,
};
