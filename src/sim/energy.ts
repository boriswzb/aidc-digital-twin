import { CAMPUS } from '../data/topology';
import type {
  EnergySnapshot,
  SolarState,
  ThermalSnapshot,
} from '../types';
import { approach, clamp, clampFinite, finite, round } from './math';

export interface EnergyCalibration {
  coolingScale: number;
  distributionScale: number;
  balanceTrimKw: number;
}

export interface EnergyInputs {
  itKw: number;
  liquidHeatKw: number;
  airHeatKw: number;
  ambientC: number;
  pvKw: number;
  socPct: number;
  dtSec: number;
}

export interface EnergyConfig {
  benchmarkPue: number;
  gridCapacityKw: number;
  peakShaveKw: number;
  pvRatedKw: number;
  bessCapacityKwh: number;
  bessPowerKw: number;
  bessSocMin: number;
  bessSocMax: number;
  copRated: number;
  copAmbientSlope: number;
  fanFactor: number;
  liquidFactor: number;
  cduFixedKw: number;
  fixedCoolingKw: number;
  distributionItRate: number;
  distributionCoolingRate: number;
  otherKw: number;
}

export interface ThermalInputs {
  ambientC: number;
  itKw: number;
  airHeatKw: number;
  liquidHeatKw: number;
  racks: Array<{ id: string; row: string; loadKw: number; liquidCooled: boolean; utilization: number }>;
}

export const DEFAULT_ENERGY_CONFIG: EnergyConfig = {
  benchmarkPue: 1.25,
  gridCapacityKw: CAMPUS.gridCapacityKw,
  peakShaveKw: 680,
  pvRatedKw: CAMPUS.pvRatedKw,
  bessCapacityKwh: CAMPUS.bessCapacityKwh,
  bessPowerKw: CAMPUS.bessPowerKw,
  bessSocMin: 12,
  bessSocMax: 96,
  copRated: 6.4,
  copAmbientSlope: 0.11,
  fanFactor: 0.034,
  liquidFactor: 0.068,
  cduFixedKw: 3,
  fixedCoolingKw: 4,
  distributionItRate: 0.04,
  distributionCoolingRate: 0.02,
  otherKw: 10,
};

export const DEFAULT_CALIBRATION: EnergyCalibration = {
  coolingScale: 1,
  distributionScale: 1,
  balanceTrimKw: 0,
};

/**
 * Canonical PUE reference used by the self-validator. Deliberately built from
 * the immutable defaults so a drifting live model can be measured against it.
 */
export function canonicalReference(input: Omit<EnergyInputs, 'dtSec'>): {
  pue: number;
  totalKw: number;
  coolingKw: number;
  balanceDeviationPct: number;
} {
  const model = new EnergyModel();
  const snapshot = model.evaluate({ ...input, dtSec: 60 });
  return {
    pue: snapshot.pue,
    totalKw: snapshot.totalKw,
    coolingKw: snapshot.coolingKw,
    balanceDeviationPct: snapshot.powerBalancePct,
  };
}

export class SolarModel {
  constructor(
    private readonly ratedKw = CAMPUS.pvRatedKw,
    private readonly seed = 0.37,
  ) {}

  getState(nowMs: number): SolarState {
    const date = new Date(nowMs);
    const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
    const solarAngle = Math.sin(((hour - 6) / 12) * Math.PI);
    const daylight = clamp(solarAngle, 0, 1);
    const slowCloud = 0.82 + 0.09 * Math.sin(nowMs / 7_200_000 + this.seed);
    const cloudPulse = 0.035 * Math.sin(nowMs / 1_100_000 + this.seed * 4);
    const solarFactor = clamp(daylight * slowCloud + (daylight > 0 ? cloudPulse : 0), 0, 1);
    const pvKw = round(this.ratedKw * solarFactor, 1);
    const ambientC = round(
      25.6 +
        4.8 * Math.sin(((hour - 9) / 24) * Math.PI * 2) +
        0.6 * Math.sin(nowMs / 3_400_000),
      1,
    );
    const weather = solarFactor > 0.62 ? '晴间多云' : solarFactor > 0.28 ? '多云' : '阴';
    return {
      pvKw,
      solarFactor,
      ambientC,
      weather,
    };
  }
}

export class EnergyModel {
  readonly config: EnergyConfig;
  private calibration: EnergyCalibration;
  private socPct = 74;
  private lastSnapshot: EnergySnapshot | null = null;

  constructor(
    config: Partial<EnergyConfig> = {},
    calibration: Partial<EnergyCalibration> = {},
  ) {
    this.config = { ...DEFAULT_ENERGY_CONFIG, ...config };
    this.calibration = { ...DEFAULT_CALIBRATION, ...calibration };
  }

  setCalibration(next: Partial<EnergyCalibration>): void {
    this.calibration = {
      coolingScale: clampFinite(next.coolingScale ?? this.calibration.coolingScale, 0.35, 2.5, 1),
      distributionScale: clampFinite(
        next.distributionScale ?? this.calibration.distributionScale,
        0.5,
        2,
        1,
      ),
      balanceTrimKw: clampFinite(next.balanceTrimKw ?? this.calibration.balanceTrimKw, -250, 250, 0),
    };
  }

  getCalibration(): EnergyCalibration {
    return { ...this.calibration };
  }

  getSoc(): number {
    return this.socPct;
  }

  setSoc(socPct: number): void {
    this.socPct = clampFinite(socPct, 0, 100, 74);
  }

  evaluate(input: EnergyInputs): EnergySnapshot {
    const itKw = clampFinite(input.itKw, 0, 2500, 0);
    const liquidHeatKw = clampFinite(input.liquidHeatKw, 0, itKw, 0);
    const airHeatKw = clampFinite(input.airHeatKw, 0, Math.max(0, itKw - liquidHeatKw), 0);
    const ambientC = clampFinite(input.ambientC, -20, 55, 26);
    const pvKw = clampFinite(input.pvKw, 0, this.config.pvRatedKw * 1.15, 0);
    const socPct = clampFinite(input.socPct, 0, 100, this.socPct);
    const dtSec = clampFinite(input.dtSec, 1, 3600, 60);

    const airRatio = clamp(airHeatKw / 280, 0.08, 1.25);
    const partLoadPenalty = 0.72 * (1 - Math.min(1, airRatio)) ** 2;
    const cop = clamp(
      this.config.copRated -
        this.config.copAmbientSlope * Math.max(0, ambientC - 24) -
        partLoadPenalty,
      2.8,
      6.8,
    );
    const airCooling =
      airHeatKw / cop + airHeatKw * this.config.fanFactor + this.config.fixedCoolingKw;
    const liquidCooling =
      liquidHeatKw * this.config.liquidFactor + (liquidHeatKw > 2 ? this.config.cduFixedKw : 0);
    const coolingRaw = (airCooling + liquidCooling) * this.calibration.coolingScale;
    const distributionRaw =
      (itKw * this.config.distributionItRate + coolingRaw * this.config.distributionCoolingRate) *
      this.calibration.distributionScale;

    const coolingKw = Math.max(0, coolingRaw);
    const distributionKw = Math.max(0, distributionRaw);
    const otherKw = this.config.otherKw;
    const totalKw = itKw + coolingKw + distributionKw + otherKw;

    const directPv = Math.min(pvKw, totalKw);
    const surplusPv = Math.max(0, pvKw - directPv);
    const chargeHeadroomKw =
      (((this.config.bessSocMax - socPct) / 100) * this.config.bessCapacityKwh * 3600) / dtSec;
    const batteryCharge = clamp(
      Math.min(surplusPv, this.config.bessPowerKw, chargeHeadroomKw),
      0,
      this.config.bessPowerKw,
    );
    const exportKw = Math.max(0, surplusPv - batteryCharge);
    const remainingDemand = Math.max(0, totalKw - directPv);
    const availableDischargeKw =
      (((socPct - this.config.bessSocMin) / 100) *
        this.config.bessCapacityKwh *
        3600 *
        0.95) /
      dtSec;
    const desiredDischarge = Math.max(0, remainingDemand - this.config.peakShaveKw);
    const batteryDischarge = clamp(
      Math.min(desiredDischarge, this.config.bessPowerKw, availableDischargeKw),
      0,
      this.config.bessPowerKw,
    );
    const netDemand = Math.max(0, remainingDemand - batteryDischarge);
    const gridImport = Math.min(netDemand, this.config.gridCapacityKw);
    const dieselKw = Math.max(0, netDemand - this.config.gridCapacityKw);

    // balanceTrimKw represents a source-side metering bias, normally zero.
    // The self-validator uses it to reproduce and then eliminate >5% drift.
    const baseSources = gridImport + pvKw + batteryDischarge + dieselKw;
    const sources = baseSources + this.calibration.balanceTrimKw;
    const sinks = totalKw + batteryCharge + exportKw;
    const powerBalanceKw = round(sources - sinks, 4);
    const powerBalancePct = round(
      (Math.abs(powerBalanceKw) / Math.max(1, sources)) * 100,
      4,
    );
    const pue = totalKw / Math.max(1, itKw);
    const benchmark = this.config.benchmarkPue;
    const pueStatus: EnergySnapshot['pueStatus'] =
      pue > benchmark ? 'warning' : pue <= benchmark - 0.04 ? 'optimal' : 'normal';
    const renewableSharePct = clamp((directPv / Math.max(1, totalKw)) * 100, 0, 100);
    const coolingSharePct = clamp((coolingKw / Math.max(1, totalKw)) * 100, 0, 100);

    const snapshot: EnergySnapshot = {
      itKw: round(itKw, 2),
      coolingKw: round(coolingKw, 2),
      airCoolingKw: round(airCooling * this.calibration.coolingScale, 2),
      liquidCoolingKw: round(liquidCooling * this.calibration.coolingScale, 2),
      distributionKw: round(distributionKw, 2),
      otherKw: round(otherKw, 2),
      totalKw: round(totalKw, 2),
      pue: round(pue, 3),
      benchmarkPue: benchmark,
      pueStatus,
      pueDeviationPct: round(((pue - benchmark) / benchmark) * 100, 2),
      coolingSharePct: round(coolingSharePct, 1),
      renewableSharePct: round(renewableSharePct, 1),
      ambientC: round(ambientC, 1),
      cop: round(cop, 2),
      solarKw: round(pvKw, 1),
      batterySocPct: round(socPct, 1),
      batteryKw: round(batteryDischarge - batteryCharge, 1),
      gridKw: round(gridImport, 2),
      pvKw: round(pvKw, 2),
      dieselKw: round(dieselKw, 2),
      powerBalanceKw,
      powerBalancePct,
      components: {
        it: round(itKw, 2),
        cooling: round(coolingKw, 2),
        distribution: round(distributionKw, 2),
        other: round(otherKw, 2),
        total: round(totalKw, 2),
      },
      sources: {
        grid: round(gridImport, 2),
        pv: round(pvKw, 2),
        battery: round(batteryDischarge, 2),
        diesel: round(dieselKw, 2),
        batteryCharge: round(batteryCharge, 2),
        export: round(exportKw, 2),
      },
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  simulate(input: EnergyInputs): EnergySnapshot {
    const effectiveInput = { ...input, socPct: this.socPct };
    const snapshot = this.evaluate(effectiveInput);
    const dtHours = clampFinite(input.dtSec, 1, 3600, 60) / 3600;
    const charge = snapshot.sources.batteryCharge;
    const discharge = snapshot.sources.battery;
    const deltaKwh = charge * 0.95 * dtHours - (discharge / 0.95) * dtHours;
    this.socPct = clamp(
      this.socPct + (deltaKwh / this.config.bessCapacityKwh) * 100,
      this.config.bessSocMin,
      this.config.bessSocMax,
    );
    snapshot.batterySocPct = round(this.socPct, 1);
    return snapshot;
  }

  getLast(): EnergySnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * Repairs unmetered drift in the power balance. Standard runs conserve power
   * exactly; this guard exists for corrupted telemetry or hot model reloads.
   */
  reconcilePowerBalance(): number {
    const last = this.lastSnapshot;
    if (!last) return 0;
    const drift =
      last.components.total +
      last.sources.batteryCharge +
      last.sources.export -
      (last.sources.grid + last.sources.pv + last.sources.battery + last.sources.diesel) -
      this.calibration.balanceTrimKw;
    const trim = clampFinite(this.calibration.balanceTrimKw + drift, -250, 250, 0);
    this.setCalibration({ balanceTrimKw: trim });
    return round(drift, 3);
  }
}

export class ThermalModel {
  private coldAB = 22.3;
  private coldCD = 22.4;
  private hotCenter = 31.8;
  private supply = 32.2;
  private return = 39.5;
  private exhaust: Record<string, number> = {};
  private last: ThermalSnapshot = {
    coldAisleC: 22.3,
    hotAisleC: 31.8,
    liquidSupplyC: 32.2,
    liquidReturnC: 39.5,
    coldAisleAB: 22.3,
    coldAisleCD: 22.4,
    hotAisleCenter: 31.8,
    rackTempsC: {},
    rackIntakeC: {},
  };
  private initialized = false;

  update(input: ThermalInputs, dtSec: number): ThermalSnapshot {
    const dt = clampFinite(dtSec, 1, 3600, 60);
    const ambientC = clampFinite(input.ambientC, -20, 55, 26);
    const airAB =
      input.racks
        .filter((rack) => rack.row === 'A' || rack.row === 'B')
        .reduce((sum, rack) => sum + rack.loadKw, 0) / 2;
    const airCD =
      input.racks
        .filter((rack) => rack.row === 'C' || rack.row === 'D')
        .reduce((sum, rack) => sum + rack.loadKw, 0) / 2;
    const designAir = 260;
    const designLiquid = 260;
    const targetColdAB =
      21.9 + (airAB / designAir) * 1.8 + Math.max(0, ambientC - 27) * 0.1;
    const targetColdCD =
      22.0 + (airCD / designAir) * 1.8 + Math.max(0, ambientC - 27) * 0.1;
    const centerRowsLoad =
      input.racks
        .filter((rack) => rack.row === 'B' || rack.row === 'C')
        .reduce((sum, rack) => sum + rack.loadKw, 0) / 2;
    const targetHot =
      30.5 + (centerRowsLoad / designAir) * 8.5 + Math.max(0, ambientC - 28) * 0.24;
    const targetSupply = 31.8 + Math.max(0, ambientC - 28) * 0.3;
    const targetReturn =
      targetSupply + 5.8 + (clamp(input.liquidHeatKw, 0, 1000) / designLiquid) * 7.2;

    if (!this.initialized) {
      this.coldAB = targetColdAB;
      this.coldCD = targetColdCD;
      this.hotCenter = targetHot;
      this.supply = targetSupply;
      this.return = targetReturn;
      this.initialized = true;
    } else {
      this.coldAB = approach(this.coldAB, targetColdAB, dt, 210);
      this.coldCD = approach(this.coldCD, targetColdCD, dt, 210);
      this.hotCenter = approach(this.hotCenter, targetHot, dt, 180);
      this.supply = approach(this.supply, targetSupply, dt, 240);
      this.return = approach(this.return, targetReturn, dt, 150);
    }

    this.coldAB = clamp(finite(this.coldAB, 22), 17, 34);
    this.coldCD = clamp(finite(this.coldCD, 22), 17, 34);
    this.hotCenter = clamp(finite(this.hotCenter, 32), 26, 58);
    this.supply = clamp(finite(this.supply, 32), 20, 48);
    this.return = clamp(finite(this.return, 40), this.supply + 2, 68);

    const exhaust: Record<string, number> = {};
    const intake: Record<string, number> = {};
    for (const rack of input.racks) {
      const isLeft = rack.row === 'A' || rack.row === 'B';
      const cold = isLeft ? this.coldAB : this.coldCD;
      const util = clampFinite(rack.utilization, 0, 1, 0);
      const slotNoise = ((rack.id.charCodeAt(2) * 7 + rack.loadKw * 13) % 11) / 10;
      intake[rack.id] = round(cold + util * 0.65 + slotNoise * 0.12, 2);
      exhaust[rack.id] = round(
        rack.liquidCooled
          ? this.return - 2.2 + util * 1.6 + slotNoise * 0.3
          : this.hotCenter - 0.8 + util * 3.4 + slotNoise * 0.45,
        2,
      );
    }
    this.exhaust = exhaust;
    this.last = {
      coldAisleC: round((this.coldAB + this.coldCD) / 2, 2),
      hotAisleC: round(this.hotCenter, 2),
      liquidSupplyC: round(this.supply, 2),
      liquidReturnC: round(this.return, 2),
      coldAisleAB: round(this.coldAB, 2),
      coldAisleCD: round(this.coldCD, 2),
      hotAisleCenter: round(this.hotCenter, 2),
      rackTempsC: exhaust,
      rackIntakeC: intake,
    };
    return this.last;
  }

  getLast(): ThermalSnapshot {
    return this.last;
  }

  reset(): void {
    this.coldAB = 22.3;
    this.coldCD = 22.4;
    this.hotCenter = 31.8;
    this.supply = 32.2;
    this.return = 39.5;
    this.exhaust = {};
    this.initialized = false;
  }

  isDiverging(): boolean {
    const values = [
      this.coldAB,
      this.coldCD,
      this.hotCenter,
      this.supply,
      this.return,
      ...Object.values(this.exhaust),
    ];
    return values.some((value) => !Number.isFinite(value) || Math.abs(value) > 120);
  }
}
