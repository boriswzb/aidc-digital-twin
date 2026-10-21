import { describe, expect, it } from 'vitest';
import { EnergyModel } from '../src/sim/energy';
import { EnergyValidator, STANDARD_CASES } from '../src/sim/validator';

describe('automatic model validation', () => {
  it('passes all standard cases with the calibrated default model', () => {
    const model = new EnergyModel();
    const report = new EnergyValidator(model).validate();
    expect(report.passed).toBe(true);
    expect(report.status).toBe('pass');
    expect(report.cases).toHaveLength(STANDARD_CASES.length);
    expect(report.maxPueDeviationPct).toBeLessThan(5);
    expect(report.maxBalanceDeviationPct).toBeLessThan(0.01);
  });

  it('detects a biased model, corrects it, and brings PUE within 5%', () => {
    const model = new EnergyModel({}, { coolingScale: 0.35 });
    const validator = new EnergyValidator(model);
    const report = validator.validate();
    expect(report.correctionCount).toBeGreaterThan(0);
    expect(report.status).toBe('corrected');
    expect(report.passed).toBe(true);
    expect(report.maxPueDeviationPct).toBeLessThan(5);
    expect(report.calibration.coolingScale).toBeGreaterThan(0.35);
    expect(report.calibration.coolingScale).toBeLessThanOrEqual(2.5);
  });

  it('detects and corrects a >5% power-balance meter drift', () => {
    const model = new EnergyModel({}, { balanceTrimKw: 40 });
    const before = new EnergyValidator(model).validate();
    expect(before.passed).toBe(true);
    expect(before.correctionCount).toBeGreaterThan(0);
    expect(
      before.cases.some((testCase) =>
        testCase.corrections.some((correction) => correction.includes('功率平衡')),
      ),
    ).toBe(true);
    expect(before.maxBalanceDeviationPct).toBeLessThan(5);
    expect(model.getCalibration().balanceTrimKw).toBe(0);
  });

  it('re-runs cleanly after correction and remains stable', () => {
    const model = new EnergyModel({}, { coolingScale: 1.6 });
    const validator = new EnergyValidator(model);
    const first = validator.validate();
    const second = validator.validate();
    expect(first.passed).toBe(true);
    expect(second.passed).toBe(true);
    expect(second.correctionCount).toBe(0);
  });
});
