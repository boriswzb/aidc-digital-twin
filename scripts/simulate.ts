import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DigitalTwinEngine } from '../src/sim/engine';
import { eventsToCsv, telemetryToCsv } from '../src/logging/csv';
import { generateOpsReport } from '../src/logging/report';

const START = new Date('2026-10-21T10:00:00+03:00');
const TICKS = 720; // 12 simulated hours at one minute per tick.

const engine = new DigitalTwinEngine({
  startTime: START,
  tickIntervalMs: 2200,
  autoTaskGeneration: true,
});

for (let tick = 1; tick <= TICKS; tick += 1) {
  engine.tick();
  if (tick === 90 || tick === 310 || tick === 515) {
    engine.injectFault();
  }
  if (tick === 120 || tick === 340 || tick === 545) {
    engine.repairFaults();
  }
  if (tick === 240) engine.addTask('training');
  if (tick === 420) engine.addTask('inference');
}

const snapshot = engine.getSnapshot();
const telemetry = engine.getTelemetry();
const events = engine.getEvents();
const reportsDir = resolve(process.cwd(), 'reports');
mkdirSync(reportsDir, { recursive: true });

writeFileSync(resolve(reportsDir, 'runtime-log.csv'), telemetryToCsv(telemetry), 'utf8');
writeFileSync(resolve(reportsDir, 'fault-events.csv'), eventsToCsv(events), 'utf8');
writeFileSync(
  resolve(reportsDir, 'ops-report.md'),
  generateOpsReport(snapshot, telemetry, events),
  'utf8',
);
writeFileSync(
  resolve(reportsDir, 'validation-report.json'),
  JSON.stringify(snapshot.validation, null, 2),
  'utf8',
);
writeFileSync(
  resolve(reportsDir, 'run-summary.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      simulationStart: START.toISOString(),
      simulationEnd: snapshot.timestamp,
      ticks: TICKS,
      compute: {
        theoreticalPflops: snapshot.compute.theoreticalPflops,
        cardsTotal: snapshot.compute.cardsTotal,
        cardsHealthy: snapshot.compute.cardsHealthy,
        utilizationPct: snapshot.compute.utilization,
        queueDepth: snapshot.compute.queueDepth,
        tokenRate: snapshot.compute.tokenRate,
        tokensTotal: snapshot.compute.tokensTotal,
        faultsInjected: 3,
      },
      energy: {
        itKw: snapshot.energy.itKw,
        totalKw: snapshot.energy.totalKw,
        pue: snapshot.energy.pue,
        benchmarkPue: snapshot.energy.benchmarkPue,
        renewableSharePct: snapshot.energy.renewableSharePct,
        powerBalancePct: snapshot.energy.powerBalancePct,
      },
      thermal: {
        coldAisleC: snapshot.thermal.coldAisleC,
        hotAisleC: snapshot.thermal.hotAisleC,
        liquidSupplyC: snapshot.thermal.liquidSupplyC,
        liquidReturnC: snapshot.thermal.liquidReturnC,
      },
      validation: snapshot.validation,
      replayGuard: snapshot.replayGuard,
      eventCount: events.length,
    },
    null,
    2,
  ),
  'utf8',
);

console.log('NEXUS AIDC simulation complete');
console.log(`  range      ${START.toISOString()} -> ${snapshot.timestamp}`);
console.log(`  compute    ${snapshot.compute.cardsHealthy}/${snapshot.compute.cardsTotal} healthy NPUs, ${snapshot.compute.utilization}% utilized`);
console.log(`  power      ${snapshot.energy.totalKw} kW, PUE ${snapshot.energy.pue}`);
console.log(`  thermal    cold ${snapshot.thermal.coldAisleC} C / hot ${snapshot.thermal.hotAisleC} C / liquid ${snapshot.thermal.liquidSupplyC}->${snapshot.thermal.liquidReturnC} C`);
console.log(`  validation ${snapshot.validation.status}, max PUE delta ${snapshot.validation.maxPueDeviationPct}%`);
console.log('  artifacts  reports/runtime-log.csv, reports/fault-events.csv, reports/ops-report.md');
