/**
 * Exploratory Testing
 * LLM-based exploratory testing and result parsing
 */

import { identifyRelevantEdgeCases } from './coverage-analysis.js';

/**
 * Build prompt for exploratory testing
 */
export function buildExploratoryTestPrompt(step, codeOutput, learningContext = null) {
  const filesInfo = codeOutput.files?.map(f =>
    `- ${f.path} (${f.action}): ${f.content?.substring(0, 500) || 'content not available'}`,
  ).join('\n') || 'No files available';

  const testsInfo = codeOutput.tests?.map(t =>
    `- ${t.path}: ${t.content?.substring(0, 300) || 'test content not available'}`,
  ).join('\n') || 'No tests created';

  const codeContent = codeOutput.files?.map(f => f.content || '').join('\n') || '';
  const relevantPatterns = identifyRelevantEdgeCases(codeContent);
  const edgeCaseChecklist = relevantPatterns.length > 0
    ? `\n## EDGE CASES TO CHECK\n${relevantPatterns.map(p => `- ${p.description}`).join('\n')}`
    : '';

  const learningInfo = learningContext?.commonIssues?.length > 0
    ? `\n## COMMON ISSUES IN THIS CODEBASE\n${learningContext.commonIssues.slice(-5).map(i => `- ${i}`).join('\n')}`
    : '';

  return `You are a thorough QA engineer performing exploratory testing on new code.

## STEP BEING TESTED
Step ${step.number}: ${step.description}
Complexity: ${step.complexity}

## CODE CHANGES
${filesInfo}

## TESTS WRITTEN
${testsInfo}
${edgeCaseChecklist}
${learningInfo}

## YOUR TASK

Perform exploratory testing by analyzing the code for:

1. **Logic Errors**: Bugs, incorrect algorithms, wrong conditions
2. **Edge Cases**: Null/undefined handling, empty arrays, boundary values
3. **Error Handling**: Missing try/catch, unhandled promises, bad error messages
4. **Security Issues**: Input validation, injection risks, sensitive data exposure
5. **Performance**: Inefficient loops, memory leaks, blocking operations
6. **Code Quality**: Missing types, unclear names, code duplication

For each issue found, provide:
- Severity level (CRITICAL for security/data loss, MAJOR for broken functionality, MINOR for quality)
- Specific location in the code if identifiable
- Root cause if you can determine it
- Suggested fix

## OUTPUT FORMAT

Respond in EXACTLY this format:

ANALYSIS:
[Brief analysis of the code quality and test coverage]

ISSUES:
- [CRITICAL/MAJOR/MINOR] [Description] | [Location] | [Root cause] | [Suggested fix]
- [CRITICAL/MAJOR/MINOR] [Description] | [Location] | [Root cause] | [Suggested fix]
(or "None found" if no issues)

EDGE_CASES:
- [COVERED/MISSING] [Edge case description]
(List edge cases and whether they are tested)

SUGGESTIONS:
- [HIGH/MEDIUM/LOW] [Suggestion for improvement]
(or "None" if no suggestions)

COVERAGE:
[Estimate of test coverage: EXCELLENT/GOOD/PARTIAL/POOR/NONE]
[List any untested code paths]

VERDICT:
[PASS/FAIL] - [One sentence summary]`;
}

/**
 * Parse exploratory testing results
 */
export function parseExploratoryResults(response, result, onCommonIssue = null) {
  // Parse issues with enhanced format
  const issuesSection = response.match(/ISSUES:\s*\n([\s\S]*?)(?=EDGE_CASES:|SUGGESTIONS:|COVERAGE:|VERDICT:|$)/i);
  if (issuesSection && !issuesSection[1].toLowerCase().includes('none found')) {
    const issueLines = issuesSection[1].split('\n').filter(l => l.trim().startsWith('-'));

    for (const line of issueLines) {
      const enhancedMatch = line.match(/-\s*\[(CRITICAL|MAJOR|MINOR)\]\s*([^|]+?)(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*([^|]+?))?(?:\s*\|\s*(.+))?$/i);
      if (enhancedMatch) {
        const severity = enhancedMatch[1].toLowerCase();
        const description = enhancedMatch[2].trim();
        const location = enhancedMatch[3]?.trim() || null;
        const rootCause = enhancedMatch[4]?.trim() || null;
        const suggestedFix = enhancedMatch[5]?.trim() || null;

        result.addIssue(severity, description, location);

        const issue = result.issues[result.issues.length - 1];
        issue.rootCause = rootCause;
        issue.suggestedFix = suggestedFix;

        if ((severity === 'critical' || severity === 'major') && onCommonIssue) {
          onCommonIssue(description);
        }
      } else {
        const simpleMatch = line.match(/-\s*\[(CRITICAL|MAJOR|MINOR)\]\s*(.+?)(?:\s*\|\s*(.+))?$/i);
        if (simpleMatch) {
          result.addIssue(
            simpleMatch[1].toLowerCase(),
            simpleMatch[2].trim(),
            simpleMatch[3]?.trim() || null,
          );
        }
      }
    }
  }

  // Parse edge cases section
  const edgeCasesSection = response.match(/EDGE_CASES:\s*\n([\s\S]*?)(?=SUGGESTIONS:|COVERAGE:|VERDICT:|$)/i);
  if (edgeCasesSection) {
    const edgeCaseLines = edgeCasesSection[1].split('\n').filter(l => l.trim().startsWith('-'));
    result.edgeCases = { covered: [], missing: [] };

    for (const line of edgeCaseLines) {
      const match = line.match(/-\s*\[(COVERED|MISSING)\]\s*(.+)$/i);
      if (match) {
        const status = match[1].toUpperCase();
        const description = match[2].trim();

        if (status === 'COVERED') {
          result.edgeCases.covered.push(description);
        } else {
          result.edgeCases.missing.push(description);
          result.addIssue('minor', `Missing edge case test: ${description}`);
        }
      }
    }
  }

  // Parse suggestions
  const suggestionsSection = response.match(/SUGGESTIONS:\s*\n([\s\S]*?)(?=COVERAGE:|VERDICT:|$)/i);
  if (suggestionsSection && !suggestionsSection[1].toLowerCase().includes('none')) {
    const suggestionLines = suggestionsSection[1].split('\n').filter(l => l.trim().startsWith('-'));

    for (const line of suggestionLines) {
      const match = line.match(/-\s*\[(HIGH|MEDIUM|LOW)\]\s*(.+)$/i);
      if (match) {
        result.addSuggestion(match[2].trim(), match[1].toLowerCase());
      }
    }
  }

  // Parse coverage
  const coverageMatch = response.match(/COVERAGE:\s*\n?\s*(EXCELLENT|GOOD|PARTIAL|POOR|NONE)/i);
  if (coverageMatch) {
    result.coverage = coverageMatch[1].toUpperCase();
  }

  // Parse verdict
  const verdictMatch = response.match(/VERDICT:\s*\n?\s*(PASS|FAIL)/i);
  if (verdictMatch) {
    result.passed = verdictMatch[1].toUpperCase() === 'PASS';
  }
}

/**
 * Build prompt for suggested approach
 */
export function buildSuggestedApproachPrompt(step, testResult, fixCycleInfo, failedApproaches = []) {
  return `Based on the following test failures, suggest the best approach to fix them.

Step: ${step.description}
Attempt: ${fixCycleInfo.attempts + 1} of ${fixCycleInfo.maxAttempts}

Issues found:
${testResult.issues.map(i => `- [${i.severity}] ${i.description}`).join('\n')}

${fixCycleInfo.previousPlans.length > 0 ? `
Previous attempts: ${fixCycleInfo.previousPlans.length}
Issues have persisted through previous fixes.
` : ''}

${failedApproaches.length > 0 ? `
Approaches to avoid (failed before):
${failedApproaches.slice(-3).map(a => `- ${a.approach}`).join('\n')}
` : ''}

Respond with a single sentence describing the recommended fix approach.`;
}
