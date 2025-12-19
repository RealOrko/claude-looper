/**
 * Plan Parser Module
 *
 * Parses Claude's plan responses into ExecutionPlan objects.
 */

import { ExecutionPlan, PlanStep } from '../interfaces.js';
import { MAX_PLAN_STEPS, MIN_PLAN_STEPS } from './quality-assessment.js';

/**
 * Parse Claude's plan response into ExecutionPlan
 * @param {string} response - The raw response text
 * @param {string} goal - The goal for the plan
 * @returns {ExecutionPlan} Parsed execution plan
 */
export function parsePlanResponse(response, goal) {
  const plan = new ExecutionPlan(goal);

  const lines = response.split('\n');
  let inPlanSection = false;
  let inAnalysisSection = false;
  let analysisLines = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract analysis
    if (trimmed.startsWith('ANALYSIS:')) {
      inAnalysisSection = true;
      const inlineAnalysis = trimmed.substring('ANALYSIS:'.length).trim();
      if (inlineAnalysis) {
        analysisLines.push(inlineAnalysis);
      }
      continue;
    }

    // End analysis section
    if (inAnalysisSection && (trimmed.startsWith('PLAN:') || trimmed.startsWith('ALTERNATIVE_APPROACH:'))) {
      inAnalysisSection = false;
      plan.analysis = analysisLines.join(' ').trim();
    }

    // Collect analysis lines
    if (inAnalysisSection && trimmed && !trimmed.startsWith('##')) {
      analysisLines.push(trimmed);
      continue;
    }

    // Detect plan section
    if (trimmed === 'PLAN:' || trimmed.startsWith('PLAN:')) {
      inPlanSection = true;
      continue;
    }

    // Extract total steps (ends plan section)
    if (trimmed.startsWith('TOTAL_STEPS:')) {
      inPlanSection = false;
      continue;
    }

    // End plan section on other headers
    if (trimmed.startsWith('DEPENDENCIES:') || trimmed.startsWith('RISKS:')) {
      inPlanSection = false;
      continue;
    }

    // Parse plan steps
    if (inPlanSection) {
      const step = parseStepLine(trimmed, plan.steps.length + 1);
      if (step) {
        plan.steps.push(step);
      }
    }
  }

  // Fallback: try to extract numbered items if no steps found
  if (plan.steps.length === 0) {
    const numberedItems = response.match(/^\d+\.\s*.+$/gm);
    if (numberedItems) {
      for (const item of numberedItems) {
        const step = parseStepLine(item, plan.steps.length + 1);
        if (step) {
          plan.steps.push(step);
        }
      }
    }
  }

  // Validate and adjust
  validatePlan(plan);

  return plan;
}

/**
 * Parse a single step line
 * @param {string} line - The line to parse
 * @param {number} defaultNumber - Default step number if not found
 * @returns {PlanStep|null} Parsed step or null
 */
export function parseStepLine(line, defaultNumber) {
  if (!line || line.startsWith('#') || (line.startsWith('-') && !line.match(/^\d/))) {
    return null;
  }

  // Try to match: "1. Description | complexity"
  const stepMatch = line.match(/^(\d+)\.\s*(.+?)(?:\s*\|\s*(simple|medium|complex))?$/i);

  if (stepMatch) {
    const number = parseInt(stepMatch[1], 10);
    let description = stepMatch[2].trim();
    const complexity = (stepMatch[3] || 'medium').toLowerCase();

    // Clean up description
    description = description.replace(/\|.*$/, '').trim();

    if (description.length > 5) { // Minimum meaningful description
      return new PlanStep(number, description, complexity);
    }
  }

  // Try simpler format: "1. Description"
  const simpleMatch = line.match(/^(\d+)\.\s*(.+)$/);
  if (simpleMatch) {
    const number = parseInt(simpleMatch[1], 10);
    let description = simpleMatch[2].trim();
    description = description.replace(/\|.*$/, '').trim();

    if (description.length > 5) {
      return new PlanStep(number, description, 'medium');
    }
  }

  return null;
}

/**
 * Validate and adjust a plan
 * @param {ExecutionPlan} plan - The plan to validate
 */
export function validatePlan(plan) {
  // Ensure at least minimum steps
  if (plan.steps.length < MIN_PLAN_STEPS) {
    // If we have at least one step, it's still valid
    if (plan.steps.length === 0) {
      plan.steps.push(new PlanStep(1, 'Execute the goal directly', 'complex'));
    }
  }

  // Limit maximum steps
  if (plan.steps.length > MAX_PLAN_STEPS) {
    plan.steps = plan.steps.slice(0, MAX_PLAN_STEPS);
  }

  // Re-number steps sequentially
  plan.steps.forEach((step, index) => {
    step.number = index + 1;
  });

  // Ensure analysis exists
  if (!plan.analysis) {
    plan.analysis = `Plan to achieve: ${plan.goal}`;
  }
}

/**
 * Extract analysis section from response
 * @param {string} response - The raw response text
 * @returns {string} Extracted analysis text
 */
export function extractAnalysis(response) {
  const analysisMatch = response.match(/ANALYSIS:\s*\n?([\s\S]*?)(?=PLAN:|ALTERNATIVE_APPROACH:|$)/i);
  if (analysisMatch) {
    return analysisMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('##'))
      .join(' ')
      .trim();
  }
  return '';
}

/**
 * Extract risks section from response
 * @param {string} response - The raw response text
 * @returns {string[]} Array of risks
 */
export function extractRisks(response) {
  const risksMatch = response.match(/RISKS:\s*\n([\s\S]*?)(?=TOTAL_STEPS:|$)/i);
  if (!risksMatch || risksMatch[1].toLowerCase().includes('none')) {
    return [];
  }

  return risksMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.replace(/^[-*]\s*/, ''));
}

/**
 * Extract total steps count from response
 * @param {string} response - The raw response text
 * @returns {number|null} Total steps or null
 */
export function extractTotalSteps(response) {
  const match = response.match(/TOTAL_STEPS:\s*(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

export default {
  parsePlanResponse,
  parseStepLine,
  validatePlan,
  extractAnalysis,
  extractRisks,
  extractTotalSteps,
};
