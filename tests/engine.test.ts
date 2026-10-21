import { describe, expect, it } from 'vitest';
import { DigitalTwinEngine } from '../src/sim/engine';

const START = new Date('2026-10-21T10:00:00+03:00');

describe('digital twin engine', () => {
  it('composes compute, energy, thermal and validation without divergence', () => {
    const engine = new DigitalTwinEngine({ startTime: START, autoTaskGeneration: false });
    engine.advance(120);
    const snapshot = engine.getSnapshot();
    expect(snapshot.compute.cardsTotal).toBe(384);
    expect(snapshot.energy.pue).toBeGreaterThan(1);
    expect(snapshot.energy.pue).toBeLessThan(2);
    expect(snapshot.energy.powerBalancePct).toBeLessThan(0.01);
    expect(snapshot.thermal.liquidReturnC).toBeGreaterThan(snapshot.thermal.liquidSupplyC);
    expect(snapshot.replayGuard.recoveries).toBe(0);
    expect(snapshot.validation.passed).toBe(true);
    expect(engine.getTelemetry().length).toBe(121);
  });

  it('injects a fault, migrates, recovers and logs the event chain', () => {
    const engine = new DigitalTwinEngine({ startTime: START, autoTaskGeneration: false });
    expect(engine.injectFault()).toBe(true);
    engine.advance(5);
    const snapshot = engine.getSnapshot();
    expect(snapshot.compute.faultCards).toBe(1);
    expect(snapshot.events.some((event) => event.category === 'migration')).toBe(true);
    expect(snapshot.events.some((event) => event.category === 'fault')).toBe(true);
    expect(engine.repairFaults()).toBe(1);
    expect(engine.getSnapshot().compute.faultCards).toBe(0);
    expect(
      engine
        .getEvents()
        .filter((event) => event.category === 'fault' && event.status === 'active'),
    ).toHaveLength(0);
  });
});
