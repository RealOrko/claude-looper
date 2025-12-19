/**
 * Task Classifier - Task type classification and patterns
 */

export const TaskType = {
  CODE_GENERATION: 'code_generation',
  CODE_MODIFICATION: 'code_modification',
  BUG_FIX: 'bug_fix',
  REFACTORING: 'refactoring',
  TESTING: 'testing',
  DOCUMENTATION: 'documentation',
  RESEARCH: 'research',
  CONFIGURATION: 'configuration',
  DEPLOYMENT: 'deployment',
  UNKNOWN: 'unknown',
};

const TASK_PATTERNS = {
  [TaskType.TESTING]: [/write.*tests?|unit\s*tests?|test|verify|validate|assert|spec/i],
  [TaskType.BUG_FIX]: [/fix|bug|issue|error|broken|repair|resolve|patch/i],
  [TaskType.REFACTORING]: [/refactor|restructure|reorganize|clean.*up|simplify/i],
  [TaskType.CODE_GENERATION]: [/create|implement|build|add.*new|write.*function|develop/i],
  [TaskType.CODE_MODIFICATION]: [/update|modify|change|enhance|improve|extend/i],
  [TaskType.DOCUMENTATION]: [/document|readme|comment|explain|describe/i],
  [TaskType.RESEARCH]: [/research|analyze|investigate|explore|understand|study/i],
  [TaskType.CONFIGURATION]: [/config|setup|install|configure|environment|settings/i],
  [TaskType.DEPLOYMENT]: [/deploy|release|publish|build|package/i],
};

export class TaskClassifier {
  constructor() {
    this.patterns = TASK_PATTERNS;
  }

  classify(description) {
    const desc = description.toLowerCase();
    for (const [type, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(desc)) {
          return type;
        }
      }
    }
    return TaskType.UNKNOWN;
  }

  getPatterns() {
    return { ...this.patterns };
  }
}

export default TaskClassifier;
