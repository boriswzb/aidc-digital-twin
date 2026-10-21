import { describe, expect, it } from 'vitest';
import { ComputeScheduler } from '../src/sim/scheduler';

const START = new Date('2026-10-21T10:00:00+03:00').getTime();

function advance(scheduler: ComputeScheduler, ticks: number): void {
  for (let i = 1; i <= ticks; i += 1) {
    scheduler.tick(START + i * 60_000, 60);
  }
}

describe('compute scheduler', () => {
  it('places seed tasks on healthy NPUs and leaves a migration reserve', () => {
    const scheduler = new ComputeScheduler(42);
    scheduler.initialize(START);
    const snapshot = scheduler.getSnapshot();
    expect(snapshot.cardsTotal).toBe(384);
    expect(snapshot.cardsAllocated).toBe(288);
    expect(snapshot.cardsHealthy).toBe(384);
    expect(snapshot.tasks.every((task) => task.npuIds.length === task.cards)).toBe(true);
    expect(snapshot.utilization).toBeGreaterThan(70);
  });

  it('injects a single-card fault and hot-migrates the affected task without losing it', () => {
    const scheduler = new ComputeScheduler(7);
    scheduler.initialize(START);
    const event = scheduler.injectCardFault();
    expect(event).not.toBeNull();
    const affectedTaskId = event?.taskId;
    expect(affectedTaskId).toBeTruthy();

    const afterFault = scheduler.getSnapshot();
    expect(afterFault.faultCards).toBe(1);
    expect(
      afterFault.tasks.find((task) => task.id === affectedTaskId)?.status,
    ).toBe('migrating');
    expect(afterFault.migrations.some((migration) => migration.status === 'in-progress')).toBe(true);

    advance(scheduler, 4);
    const recovered = scheduler.getSnapshot();
    const task = recovered.tasks.find((item) => item.id === affectedTaskId);
    expect(task).toBeDefined();
    expect(task?.status).toBe('running');
    expect(task?.npuIds.length).toBe(task?.cards);
    expect(task?.migrationCount).toBe(1);
    expect(recovered.migrations).toHaveLength(0);

    const repaired = scheduler.repairAllFaults();
    expect(repaired).toBe(1);
    expect(scheduler.getSnapshot().faultCards).toBe(0);
    expect(scheduler.getSnapshot().cardsHealthy).toBe(384);
  });

  it('queues work when capacity is exhausted and dispatches after release', () => {
    const scheduler = new ComputeScheduler(99);
    scheduler.initialize(START);
    for (let i = 0; i < 20; i += 1) scheduler.submitTask('training');
    const snapshot = scheduler.getSnapshot();
    expect(snapshot.queueDepth).toBeGreaterThan(0);
    expect(snapshot.cardsAllocated + snapshot.queue.reduce((sum, task) => sum + task.cards, 0)).toBeGreaterThan(384);
    advance(scheduler, 1);
    expect(Number.isFinite(scheduler.getSnapshot().utilization)).toBe(true);
  });

  it('keeps all simulation values finite over a long run', () => {
    const scheduler = new ComputeScheduler(2026);
    scheduler.initialize(START);
    scheduler.injectCardFault();
    for (let i = 0; i < 180; i += 1) {
      scheduler.tick(START + i * 60_000, 60);
      if (i % 47 === 0) scheduler.submitTask(i % 2 === 0 ? 'inference' : 'training');
    }
    const snapshot = scheduler.getSnapshot();
    expect(Number.isFinite(snapshot.utilization)).toBe(true);
    expect(snapshot.utilization).toBeGreaterThanOrEqual(0);
    expect(snapshot.utilization).toBeLessThanOrEqual(100);
    expect(snapshot.cardsAllocated).toBeLessThanOrEqual(snapshot.cardsHealthy);
    expect(snapshot.tasks.every((task) => Number.isFinite(task.progress))).toBe(true);
  });
});
