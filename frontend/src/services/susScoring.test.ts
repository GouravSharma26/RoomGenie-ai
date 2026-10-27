import { describe, it, expect } from 'vitest';
import {
  SUS_QUESTIONS,
  calculateSusScore,
  validateSusResponses,
  getSusGrade,
} from './susScoring';

describe('System Usability Scale (SUS) Scoring & Validation', () => {
  it('defines exactly 10 standard SUS questions', () => {
    expect(SUS_QUESTIONS).toHaveLength(10);
    expect(SUS_QUESTIONS[0]).toContain('frequently');
    expect(SUS_QUESTIONS[1]).toContain('unnecessarily complex');
    expect(SUS_QUESTIONS[9]).toContain('learn a lot of things');
  });

  it('computes perfect usability score of 100 (Grade A) for ideal responses', () => {
    // Ideal: 5 for positive (odd), 1 for negative (even)
    const ideal = {
      1: 5, 2: 1, 3: 5, 4: 1, 5: 5,
      6: 1, 7: 5, 8: 1, 9: 5, 10: 1,
    };
    const result = calculateSusScore(ideal);
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.description).toBe('Excellent Usability');
    // Each item contributes (5-1)=4 or (5-1)=4 -> 10 * 4 = 40; 40 * 2.5 = 100
    for (let q = 1; q <= 10; q++) {
      expect(result.itemContributions[q]).toBe(4);
    }
  });

  it('computes worst usability score of 0 (Grade F) for worst responses', () => {
    // Worst: 1 for positive (odd), 5 for negative (even)
    const worst = {
      1: 1, 2: 5, 3: 1, 4: 5, 5: 1,
      6: 5, 7: 1, 8: 5, 9: 1, 10: 5,
    };
    const result = calculateSusScore(worst);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('F');
    expect(result.description).toBe('Poor / Not Acceptable');
  });

  it('computes exact neutral usability score of 50.0 (Grade D) when all responses are 3', () => {
    const neutral = {
      1: 3, 2: 3, 3: 3, 4: 3, 5: 3,
      6: 3, 7: 3, 8: 3, 9: 3, 10: 3,
    };
    const result = calculateSusScore(neutral);
    expect(result.score).toBe(50.0);
    expect(result.grade).toBe('D');
    expect(result.description).toBe('Marginal / Below Average');
  });

  it('correctly maps Bangor et al. grade thresholds', () => {
    expect(getSusGrade(85.0)).toEqual({ grade: 'A', description: 'Excellent Usability' });
    expect(getSusGrade(92.5)).toEqual({ grade: 'A', description: 'Excellent Usability' });
    expect(getSusGrade(71.0)).toEqual({ grade: 'B', description: 'Good Usability' });
    expect(getSusGrade(84.9)).toEqual({ grade: 'B', description: 'Good Usability' });
    expect(getSusGrade(68.0)).toEqual({ grade: 'C', description: 'Acceptable / Average' });
    expect(getSusGrade(65.0)).toEqual({ grade: 'C', description: 'Acceptable / Average' });
    expect(getSusGrade(50.0)).toEqual({ grade: 'D', description: 'Marginal / Below Average' });
    expect(getSusGrade(64.9)).toEqual({ grade: 'D', description: 'Marginal / Below Average' });
    expect(getSusGrade(49.9)).toEqual({ grade: 'F', description: 'Poor / Not Acceptable' });
    expect(getSusGrade(25.0)).toEqual({ grade: 'F', description: 'Poor / Not Acceptable' });
  });

  it('validates incomplete survey and returns missing question numbers', () => {
    const incomplete = {
      1: 4, 2: 2, 4: 1, 5: 4, 6: 2, 7: 4, 8: 2, 10: 1,
    }; // Missing 3 and 9
    const val = validateSusResponses(incomplete);
    expect(val.isValid).toBe(false);
    expect(val.missingQuestions).toEqual([3, 9]);
    expect(val.errorMessage).toContain('missing: 3, 9');
  });

  it('validates out-of-range Likert responses', () => {
    const outOfRange = {
      1: 4, 2: 2, 3: 6, 4: 1, 5: 4, 6: 2, 7: 4, 8: 2, 9: 4, 10: 1,
    }; // Question 3 has 6
    const val = validateSusResponses(outOfRange);
    expect(val.isValid).toBe(false);
    expect(val.errorMessage).toContain("Question 3 response '6' is out of range");
  });

  it('supports string keys and array input seamlessly', () => {
    const arrayInput = [4, 2, 4, 2, 4, 2, 4, 2, 4, 2];
    const result = calculateSusScore(arrayInput);
    // odd: 4-1 = 3 (5 items = 15); even: 5-2 = 3 (5 items = 15); total = 30; 30 * 2.5 = 75.0
    expect(result.score).toBe(75.0);
    expect(result.grade).toBe('B');
  });
});
