import type {
  EnergySnapshot,
  ValidationCaseResult,
  ValidationReport,
} from '../types';
import {
  canonicalReference,
  type EnergyInputs,
  type EnergyModel,
} from './energy';
import { clamp, round } from './math';

export interface StandardCase {
  id: string;
  name: string;
  description: string;
  input: Omit<EnergyInputs, 'dtSec'>;
}

/**
 * Reproducible standard operating cases. The canonical reference is rebuilt
 * from immutable default coefficients, so any live-model drift is measurable.
 */
export const STANDARD_CASES: StandardCase[] = [
  {
    id: 'STD-01',
    name: '设计工况 · 满负载',
    description: 'IT 500 kW，风冷 / 液冷各 50%，环境 25°C，无光伏',
    input: {
      itKw: 500,
      liquidHeatKw: 250,
      airHeatKw: 250,
      ambientC: 25,
      pvKw: 0,
      socPct: 70,
    },
  },
  {
    id: 'STD-02',
    name: '夏季高温 · 部分负载',
    description: 'IT 400 kW，环境 35°C，光伏 180 kW，验证高温 COP 与功率平衡',
    input: {
      itKw: 400,
      liquidHeatKw: 200,
      airHeatKw: 200,
      ambientC: 35,
      pvKw: 180,
      socPct: 62,
    },
  },
  {
    id: 'STD-03',
    name: '夜间低负载 · 待机',
    description: 'IT 220 kW，环境 24°C，验证固定冷却开销对 PUE 的影响',
    input: {
      itKw: 220,
      liquidHeatKw: 110,
      airHeatKw: 110,
      ambientC: 24,
      pvKw: 0,
      socPct: 54,
    },
  },
];

const MAX_DEVIATION_PCT = 5;

/**
 * Validates PUE and power conservation against standard cases. If PUE drifts
 * beyond 5%, the cooling calibration is corrected in a bounded feedback loop
 * rather than allowing an unstable / biased model to reach the dashboard.
 */
export class EnergyValidator {
  constructor(private readonly model: EnergyModel) {}

  validate(checkedAt = new Date().toISOString()): ValidationReport {
    const cases: ValidationCaseResult[] = [];
    let corrections = 0;
    let maxPueDeviation = 0;
    let maxBalanceDeviation = 0;

    for (const testCase of STANDARD_CASES) {
      const correctionsForCase: string[] = [];
      let actual = this.runCase(testCase);
      const reference = canonicalReference(testCase.input);
      let pueDeviation = Math.abs((actual.pue - reference.pue) / reference.pue) * 100;
      let balanceDeviation = this.balanceDeviation(actual);

      // Resolve metering drift before PUE calibration; otherwise the two
      // feedback loops can partially cancel each other.
      if (balanceDeviation > MAX_DEVIATION_PCT) {
        const before = this.model.getCalibration().balanceTrimKw;
        this.model.reconcilePowerBalance();
        const after = this.model.getCalibration().balanceTrimKw;
        corrections += 1;
        correctionsForCase.push(
          `功率平衡偏差超 5%，已重同步计量通道 ${before.toFixed(2)} → ${after.toFixed(2)} kW`,
        );
        actual = this.runCase(testCase);
        balanceDeviation = this.balanceDeviation(actual);
        pueDeviation = Math.abs((actual.pue - reference.pue) / reference.pue) * 100;
      }

      if (pueDeviation > MAX_DEVIATION_PCT) {
        const initialScale = this.model.getCalibration().coolingScale;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const targetGap = reference.totalKw - actual.totalKw;
          const rawCooling = actual.coolingKw / Math.max(0.05, this.model.getCalibration().coolingScale);
          if (Math.abs(targetGap) < 0.5) break;
          const nextScale = clamp(
            this.model.getCalibration().coolingScale + targetGap / Math.max(8, rawCooling),
            0.35,
            2.5,
          );
          this.model.setCalibration({ coolingScale: nextScale });
          actual = this.runCase(testCase);
          pueDeviation = Math.abs((actual.pue - reference.pue) / reference.pue) * 100;
          if (pueDeviation <= MAX_DEVIATION_PCT) break;
        }
        corrections += 1;
        correctionsForCase.push(
          `PUE 偏差超 5%，制冷标定系数 ${initialScale.toFixed(3)} → ${this.model
            .getCalibration()
            .coolingScale.toFixed(3)}`,
        );
        balanceDeviation = this.balanceDeviation(actual);
      }

      maxPueDeviation = Math.max(maxPueDeviation, pueDeviation);
      maxBalanceDeviation = Math.max(maxBalanceDeviation, balanceDeviation);
      const passed = pueDeviation <= MAX_DEVIATION_PCT && balanceDeviation <= MAX_DEVIATION_PCT;
      cases.push({
        name: `${testCase.id} · ${testCase.name}`,
        description: testCase.description,
        itKw: round(actual.itKw, 1),
        actualPue: round(actual.pue, 3),
        referencePue: round(reference.pue, 3),
        pueDeviationPct: round(pueDeviation, 3),
        balanceDeviationPct: round(balanceDeviation, 4),
        coolingKw: round(actual.coolingKw, 1),
        totalKw: round(actual.totalKw, 1),
        corrections: correctionsForCase,
        passed,
      });
    }

    const passed = cases.every((testCase) => testCase.passed);
    return {
      checkedAt,
      status: !passed ? 'fail' : corrections > 0 ? 'corrected' : 'pass',
      passed,
      maxPueDeviationPct: round(maxPueDeviation, 3),
      maxBalanceDeviationPct: round(maxBalanceDeviation, 4),
      calibration: this.model.getCalibration(),
      cases,
      correctionCount: corrections,
    };
  }

  private runCase(testCase: StandardCase): EnergySnapshot {
    return this.model.evaluate({
      ...testCase.input,
      dtSec: 60,
    });
  }

  private balanceDeviation(snapshot: EnergySnapshot): number {
    return Math.abs(snapshot.powerBalancePct);
  }
}
