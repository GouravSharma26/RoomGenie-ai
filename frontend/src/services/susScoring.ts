/**
 * Standard System Usability Scale (SUS) questionnaire definition, validation,
 * and authoritative scoring formulas.
 * Conforms strictly to:
 * - Brooke, J. (1996). "SUS: A quick and dirty usability scale."
 * - Bangor, A., Kortum, P. T., & Miller, J. T. (2008, 2009). Empirical grading bands.
 * - docs/RESEARCH_PROTOCOL_AND_TASKS.md Section 7.1
 */

export const SUS_QUESTIONS: readonly string[] = [
  'I think that I would like to use this system frequently.',
  'I found the system unnecessarily complex.',
  'I thought the system was easy to use.',
  'I think that I would need the support of a technical person to be able to use this system.',
  'I found the various functions in this system were well integrated.',
  'I thought there was too much inconsistency in this system.',
  'I would imagine that most people would learn to use this system very quickly.',
  'I found the system very cumbersome to use.',
  'I felt very confident using the system.',
  'I needed to learn a lot of things before I could get going with this system.',
];

export type SusGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SusGradeInfo {
  grade: SusGrade;
  description: string;
}

export interface SusScoreResult {
  score: number;
  grade: SusGrade;
  description: string;
  itemContributions: Record<number, number>;
  normalizedResponses: Record<number, number>;
}

export interface SusValidationResult {
  isValid: boolean;
  missingQuestions: number[];
  errorMessage?: string;
}

/**
 * Validates that all 10 questions have valid integer responses in the range [1, 5].
 */
export function validateSusResponses(
  responses: Record<number | string, number | undefined | null>
): SusValidationResult {
  const missingQuestions: number[] = [];

  for (let q = 1; q <= 10; q++) {
    const val = responses[q] ?? responses[String(q)];
    if (val === undefined || val === null) {
      missingQuestions.push(q);
      continue;
    }
    if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 5) {
      return {
        isValid: false,
        missingQuestions: [],
        errorMessage: `Question ${q} response '${val}' is out of range. Expected an integer between 1 and 5.`,
      };
    }
  }

  if (missingQuestions.length > 0) {
    return {
      isValid: false,
      missingQuestions,
      errorMessage: `Please answer all 10 questions to complete the usability evaluation (missing: ${missingQuestions.join(', ')}).`,
    };
  }

  return { isValid: true, missingQuestions: [] };
}

/**
 * Returns the standardized empirical grade according to Bangor, Kortum & Miller (2008, 2009).
 */
export function getSusGrade(score: number): SusGradeInfo {
  if (score >= 85.0) {
    return { grade: 'A', description: 'Excellent Usability' };
  }
  if (score >= 71.0) {
    return { grade: 'B', description: 'Good Usability' };
  }
  if (score >= 65.0) {
    return { grade: 'C', description: 'Acceptable / Average' };
  }
  if (score >= 50.0) {
    return { grade: 'D', description: 'Marginal / Below Average' };
  }
  return { grade: 'F', description: 'Poor / Not Acceptable' };
}

/**
 * Calculates composite SUS score from 10 Likert responses:
 * - Odd items (1, 3, 5, 7, 9): X_i = Q_i - 1
 * - Even items (2, 4, 6, 8, 10): X_i = 5 - Q_i
 * - SUS = 2.5 * sum(X_i)
 */
export function calculateSusScore(
  responses: Record<number | string, number | undefined | null> | number[]
): SusScoreResult {
  const respMap: Record<number, number> = {};

  if (Array.isArray(responses)) {
    responses.forEach((val, idx) => {
      respMap[idx + 1] = val;
    });
  } else {
    for (let q = 1; q <= 10; q++) {
      const val = responses[q] ?? responses[String(q)];
      if (val !== undefined && val !== null) {
        respMap[q] = val;
      }
    }
  }

  const validation = validateSusResponses(respMap);
  if (!validation.isValid) {
    throw new Error(validation.errorMessage || 'Invalid SUS responses.');
  }

  let totalContribution = 0;
  const itemContributions: Record<number, number> = {};

  for (let q = 1; q <= 10; q++) {
    const val = respMap[q];
    let contrib: number;
    if (q % 2 === 1) {
      contrib = val - 1;
    } else {
      contrib = 5 - val;
    }
    itemContributions[q] = contrib;
    totalContribution += contrib;
  }

  const rawScore = totalContribution * 2.5;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)) * 10) / 10;
  const gradeInfo = getSusGrade(score);

  return {
    score,
    grade: gradeInfo.grade,
    description: gradeInfo.description,
    itemContributions,
    normalizedResponses: respMap,
  };
}
