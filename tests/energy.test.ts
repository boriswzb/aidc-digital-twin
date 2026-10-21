import { describe, expect, it } from 'vitest';
import { EnergyModel, ThermalModel, canonicalReference } from '../src/sim/energy';

const baseline = {
  itKw: 500,
  liquidHeatKw: 250,
  airHeatKw: 250,
  ambientC: 25,
  pvKw: 0,
  socPct: 70,
  dtSec: 60,
};

describe('energy model', () => {
  it('balances sources and loads exactly', () => {
    const model = new EnergyModel();
    const snapshot = model.evaluate(baseline);
    const sources =
      snapshot.sources.grid +
      snapshot.sources.pv +
      snapshot.sources.battery +
      snapshot.sources.diesel;
    const sinks =
      snapshot.components.total + snapshot.sources.batteryCharge + snapshot.sources.export;
    expect(Math.abs(sources - sinks)).toBeLessThan(0.001);
    expect(snapshot.powerBalancePct).toBeLessThan(0.001);
    expect(Number.isFinite(snapshot.pue)).toBe(true);
  });

  it('computes PUE as total facility power divided by IT power', () => {
    const model = new EnergyModel();
    const snapshot = model.evaluate(baseline);
    expect(snapshot.pue).toBeCloseTo(snapshot.totalKw / snapshot.itKw, 2);
    expect(snapshot.components.it + snapshot.components.cooling + snapshot.components.distribution + snapshot.components.other).toBeCloseTo(snapshot.totalKw, 1);
    expect(snapshot.pue).toBeGreaterThan(1);
    expect(snapshot.pue).toBeLessThan(1.6);
  });

  it('produces a yellow warning when PUE exceeds the benchmark', () => {
    const model = new EnergyModel({ benchmarkPue: 1.05 });
    const snapshot = model.evaluate(baseline);
    expect(snapshot.pueStatus).toBe('warning');
    expect(snapshot.pueDeviationPct).toBeGreaterThan(0);
  });

  it('uses PV to reduce grid import and reports renewable share', () => {
    const model = new EnergyModel();
    const noSolar = model.evaluate({ ...baseline, pvKw: 0 });
    const solar = model.evaluate({ ...baseline, pvKw: 300 });
    expect(solar.gridKw).toBeLessThan(noSolar.gridKw);
    expect(solar.renewableSharePct).toBeGreaterThan(0);
  });

  it('has a stable canonical reference', () => {
    const reference = canonicalReference(baseline);
    expect(reference.pue).toBeGreaterThan(1);
    expect(reference.balanceDeviationPct).toBeLessThan(0.001);
  });
});

describe('thermal field', () => {
  it('remains bounded and responds to load changes', () => {
    const thermal = new ThermalModel();
    const racks = Array.from({ length: 24 }, (_, index) => ({
      id: `R${index}`,
      row: ['A', 'B', 'C', 'D'][Math.floor(index / 6)],
      loadKw: 21,
      liquidCooled: index % 2 === 0,
      utilization: 1,
    }));
    let last = thermal.update(
      { ambientC: 30, itKw: 520, airHeatKw: 280, liquidHeatKw: 240, racks },
      60,
    );
    for (let i = 0; i < 60; i += 1) {
      last = thermal.update(
        { ambientC: 30, itKw: 520, airHeatKw: 280, liquidHeatKw: 240, racks },
        60,
      );
    }
    expect(last.coldAisleC).toBeGreaterThan(18);
    expect(last.coldAisleC).toBeLessThan(32);
    expect(last.liquidReturnC).toBeGreaterThan(last.liquidSupplyC);
    expect(Object.values(last.rackTempsC).every(Number.isFinite)).toBe(true);

    const hot = last.hotAisleC;
    for (let i = 0; i < 60; i += 1) {
      last = thermal.update(
        {
          ambientC: 22,
          itKw: 160,
          airHeatKw: 90,
          liquidHeatKw: 70,
          racks: racks.map((rack) => ({ ...rack, loadKw: 6, utilization: 0.2 })),
        },
        60,
      );
    }
    expect(last.hotAisleC).toBeLessThan(hot);
    expect(thermal.isDiverging()).toBe(false);
  });
});
