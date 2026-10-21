import { describe, expect, it } from 'vitest';
import { DigitalTwinEngine } from '../src/sim/engine';
import { eventsToCsv, telemetryToCsv } from '../src/logging/csv';
import { generateOpsReport } from '../src/logging/report';

const START = new Date('2026-10-21T10:00:00+03:00');

describe('reporting pipeline', () => {
  it('serializes telemetry and events with stable CSV schemas', () => {
    const engine = new DigitalTwinEngine({ startTime: START, autoTaskGeneration: false });
    engine.advance(8);
    engine.injectFault();
    engine.advance(4);
    engine.repairFaults();
    const csv = telemetryToCsv(engine.getTelemetry());
    const rows = csv.trim().split('\r\n');
    expect(rows[0]).toContain('timestamp,tick,it_kw,cooling_kw');
    expect(rows[0]).toContain('pue');
    expect(rows.length).toBe(engine.getTelemetry().length + 1);
    expect(rows.length).toBeGreaterThan(10);

    const eventCsv = eventsToCsv(engine.getEvents());
    expect(eventCsv).toContain('severity,category,title');
    expect(eventCsv).toContain('fault');
    expect(eventCsv).toContain('migration');
  });

  it('generates a complete markdown operations report', () => {
    const engine = new DigitalTwinEngine({ startTime: START, autoTaskGeneration: false });
    engine.advance(60);
    engine.injectFault();
    engine.advance(4);
    engine.repairFaults();
    const report = generateOpsReport(
      engine.getSnapshot(),
      engine.getTelemetry(),
      engine.getEvents(),
    );
    expect(report).toContain('# NEXUS AIDC 数字孪生 · 运维分析报告');
    expect(report).toContain('## 五、自动校验与模型可信度');
    expect(report).toContain('STD-01');
    expect(report).toContain('功率平衡');
    expect(report).toContain('迁移');
    expect(report).toContain('## 七、运维建议');
    expect(report.length).toBeGreaterThan(3000);
  });
});
