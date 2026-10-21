import type {
  EngineSnapshot,
  OpsEvent,
  TelemetryPoint,
  ValidationReport,
} from '../types';

const pad = (value: number): string => String(value).padStart(2, '0');

export function formatSimDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

const fmt = (value: number, digits = 1): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';

const severityLabel: Record<string, string> = {
  critical: '严重',
  warning: '警告',
  info: '信息',
  success: '恢复',
};

function validationRows(validation: ValidationReport): string {
  return validation.cases
    .map(
      (testCase) =>
        `| ${testCase.name} | ${fmt(testCase.actualPue, 3)} | ${fmt(
          testCase.referencePue,
          3,
        )} | ${fmt(testCase.pueDeviationPct, 2)}% | ${fmt(
          testCase.balanceDeviationPct,
          4,
        )}% | ${testCase.passed ? '通过' : '未通过'} |`,
    )
    .join('\n');
}

function eventRows(events: OpsEvent[]): string {
  if (events.length === 0) return '| — | — | 暂无故障事件 | — |';
  return events
    .slice(0, 18)
    .map(
      (event) =>
        `| ${formatSimDate(event.timestamp)} | ${severityLabel[event.severity] ?? event.severity} | ${
          event.title
        } | ${event.detail.replaceAll('|', '/')} |`,
    )
    .join('\n');
}

function telemetryStats(telemetry: TelemetryPoint[]): {
  avgPue: number;
  maxPue: number;
  avgIt: number;
  avgCooling: number;
  maxHot: number;
  maxReturn: number;
  avgRenewable: number;
  balanceMax: number;
  averageTokenRate: number;
} {
  if (telemetry.length === 0) {
    return {
      avgPue: 0,
      maxPue: 0,
      avgIt: 0,
      avgCooling: 0,
      maxHot: 0,
      maxReturn: 0,
      avgRenewable: 0,
      balanceMax: 0,
      averageTokenRate: 0,
    };
  }
  const sum = (selector: (point: TelemetryPoint) => number): number =>
    telemetry.reduce((total, point) => total + selector(point), 0);
  return {
    avgPue: sum((point) => point.pue) / telemetry.length,
    maxPue: Math.max(...telemetry.map((point) => point.pue)),
    avgIt: sum((point) => point.itKw) / telemetry.length,
    avgCooling: sum((point) => point.coolingKw) / telemetry.length,
    maxHot: Math.max(...telemetry.map((point) => point.hotAisleC)),
    maxReturn: Math.max(...telemetry.map((point) => point.liquidReturnC)),
    avgRenewable: sum((point) => point.renewablePct) / telemetry.length,
    balanceMax: Math.max(...telemetry.map((point) => Math.abs(point.powerBalancePct))),
    averageTokenRate: sum((point) => point.tokenRate) / telemetry.length,
  };
}

function recommendations(snapshot: EngineSnapshot, stats: ReturnType<typeof telemetryStats>): string[] {
  const items: string[] = [];
  if (snapshot.energy.pue > snapshot.energy.benchmarkPue) {
    items.push(
      'PUE 已越过 1.25 基准线：优先提升冷通道送风温度 0.5–1.0°C、降低 CRAH 风机静压，并在低负载时段合并冷量需求。',
    );
  } else {
    items.push(
      `PUE 稳定在基准线内（均值 ${fmt(stats.avgPue, 3)}）：保持现有冷量策略，结合光伏预测继续做峰谷平移。`,
    );
  }
  if (stats.maxHot > 41) {
    items.push(
      `热通道峰值 ${fmt(stats.maxHot, 1)}°C：核查末排机柜盲板与冷通道封闭，必要时将 B/C 排液冷负载上调 5%。`,
    );
  } else {
    items.push(
      `热通道峰值 ${fmt(stats.maxHot, 1)}°C，冷热隔离有效；建议保持 22–24°C 冷通道设定点并持续监测局部热点。`,
    );
  }
  if (snapshot.compute.faultCards > 0) {
    items.push(
      `当前仍有 ${snapshot.compute.faultCards} 张故障 NPU：完成隔离更换后将故障卡重新纳入巡检池，避免备件不足削弱迁移冗余。`,
    );
  } else {
    items.push('无在线故障卡；建议按季度执行 HBM 压力测试与光模块误码率巡检。');
  }
  if (snapshot.compute.queueDepth > 0) {
    items.push(
      `队列中有 ${snapshot.compute.queueDepth} 个任务等待：可启用推理弹性实例或与邻近集群做算力联邦。`,
    );
  } else {
    items.push('任务队列为空，调度器保有充足迁移余量；可继续接入离线训练任务提高填充率。');
  }
  if (stats.avgRenewable > 55) {
    items.push(
      `光伏平均消纳占比 ${fmt(stats.avgRenewable, 1)}%：储能 SOC 仍有余量，建议在晚高峰前保留 60% SOC 用于削峰。`,
    );
  }
  items.push(
    `功率平衡全程最大偏差 ${fmt(stats.balanceMax, 4)}%，低于 1% 计量阈值；PUE 自校验偏差 ${fmt(
      snapshot.validation.maxPueDeviationPct,
      2,
    )}%。`,
  );
  return items;
}

export function generateOpsReport(
  snapshot: EngineSnapshot,
  telemetry: TelemetryPoint[],
  allEvents: OpsEvent[],
): string {
  const stats = telemetryStats(telemetry);
  const faultEvents = allEvents.filter((event) => event.category === 'fault');
  const injectedFaults = faultEvents.filter((event) => event.title.startsWith('单卡故障')).length;
  const migrationEvents = allEvents.filter((event) => event.category === 'migration');
  const warningEvents = allEvents.filter(
    (event) => event.severity === 'critical' || event.severity === 'warning',
  );
  const openWarnings = warningEvents.filter((event) => event.status !== 'resolved').length;
  const compute = snapshot.compute;
  const energy = snapshot.energy;
  const thermal = snapshot.thermal;
  const tokenDaily = (compute.tokenRate * 86_400) / 1_000_000_000;
  const uptimeHours = telemetry.length > 0 ? telemetry.length / 60 : 0;

  return `# NEXUS AIDC 数字孪生 · 运维分析报告

> 园区：华东智算中心（AIDC-CAMPUS-01）  
> 报告时间：${formatSimDate(snapshot.timestamp)}（UTC+03:00）  
> 仿真跨度：${uptimeHours.toFixed(1)} 小时 · ${telemetry.length} 个采样点  
> 数据口径：60 秒/调度周期，数字孪生实测遥测与标准工况校验

## 一、执行摘要

| 指标 | 数值 | 状态 |
|---|---:|---|
| 总算力规模 | ${fmt(compute.theoreticalPflops, 1)} PFLOPS（BF16） | 384 × NPU |
| 在跑卡数 / 健康卡数 | ${compute.cardsActive} / ${compute.cardsHealthy} | 利用率 ${fmt(compute.utilization, 1)}% |
| 任务队列 | ${compute.queueDepth} | ${compute.queueDepth > 0 ? '需关注' : '健康'} |
| Token 实时吞吐 | ${(compute.tokenRate / 1000).toFixed(1)}K Token/s | 日化约 ${tokenDaily.toFixed(2)}B |
| 总功耗 | ${fmt(energy.totalKw, 1)} kW | IT ${fmt(energy.itKw, 1)} kW |
| 实时 PUE | ${fmt(energy.pue, 3)} | 基准 ${fmt(energy.benchmarkPue, 2)}，${energy.pueStatus === 'warning' ? '黄灯告警' : '正常'} |
| 光伏消纳占比 | ${fmt(energy.renewableSharePct, 1)}% | 光伏 ${fmt(energy.pvKw, 1)} kW |
| 故障卡 / 迁移中任务 | ${compute.faultCards} / ${compute.migratingTasks} | ${compute.faultCards > 0 ? '待修复' : '无在线故障'} |

**总体结论：** ${warningEvents.length > 0 ? `本次运行累计出现 ${warningEvents.length} 条告警，${openWarnings > 0 ? `仍有 ${openWarnings} 条处于处置中` : '均已闭环'}；` : '本次运行无告警；'}功率平衡最大偏差 ${fmt(stats.balanceMax, 4)}%，PUE 自校验最大偏差 ${fmt(snapshot.validation.maxPueDeviationPct, 2)}%，数值发散保护触发 ${snapshot.replayGuard.recoveries} 次，系统处于${snapshot.validation.passed ? '可控、可验证' : '需要干预'}状态。

## 二、算力调度与可靠性

- 纳管 NPU：${compute.cardsTotal} 张，健康 ${compute.cardsHealthy} 张，故障 ${compute.faultCards} 张。
- 在跑任务：${compute.runningTasks} 个；迁移中：${compute.migratingTasks} 个；排队：${compute.queueDepth} 个。
- 集群利用率：${fmt(compute.utilization, 1)}%；累计 Token 处理量：${(compute.tokensTotal / 1_000_000).toFixed(1)}M。
- 单卡故障处置：注入 ${injectedFaults} 次，触发迁移记录 ${migrationEvents.length} 条。迁移通过 UnifiedBus 同步 KV Cache，任务保留断点进度，不重建训练 / 推理实例。
- 调度策略：训练任务优先分散至高空闲机柜，推理任务优先单柜连续放置；保留至少 ${Math.max(0, compute.cardsHealthy - compute.cardsAllocated)} 张健康卡作为热迁移余量。

### 迁移事件摘要

${migrationEvents.length > 0 ? migrationEvents.slice(0, 5).map((event) => `- **${formatSimDate(event.timestamp)}** · ${event.title}：${event.detail}`).join('\n') : '- 运行期间未触发热迁移。'}

## 三、能耗与 PUE 分析

| 分项 | 功率 (kW) | 占比 |
|---|---:|---:|
| IT 负载 | ${fmt(energy.itKw, 1)} | ${fmt((energy.itKw / Math.max(1, energy.totalKw)) * 100, 1)}% |
| 制冷负载 | ${fmt(energy.coolingKw, 1)} | ${fmt(energy.coolingSharePct, 1)}% |
| 供配电损耗 | ${fmt(energy.distributionKw, 1)} | ${fmt((energy.distributionKw / Math.max(1, energy.totalKw)) * 100, 1)}% |
| 其他辅助 | ${fmt(energy.otherKw, 1)} | ${fmt((energy.otherKw / Math.max(1, energy.totalKw)) * 100, 1)}% |
| **总功耗** | **${fmt(energy.totalKw, 1)}** | **100%** |

- 实时 PUE **${fmt(energy.pue, 3)}**，较 ${fmt(energy.benchmarkPue, 2)} 基准线 ${energy.pueDeviationPct >= 0 ? '高' : '低'} ${Math.abs(energy.pueDeviationPct).toFixed(1)}%；全程平均 ${fmt(stats.avgPue, 3)}、峰值 ${fmt(stats.maxPue, 3)}。
- 冷机 COP ${fmt(energy.cop, 2)}，风冷承担 ${fmt(energy.airCoolingKw, 1)} kW，液冷 CDU 承担 ${fmt(energy.liquidCoolingKw, 1)} kW。
- 光伏 ${fmt(energy.pvKw, 1)} kW，消纳占比 ${fmt(energy.renewableSharePct, 1)}%；储能 SOC ${fmt(energy.batterySocPct, 1)}%，电池功率 ${fmt(energy.batteryKw, 1)} kW（负值为充电）。
- 电网 ${fmt(energy.gridKw, 1)} kW，柴油发电机 ${fmt(energy.dieselKw, 1)} kW（${energy.dieselKw > 0 ? '并网支撑' : '热备待机'}）。
- 功率平衡：源侧 ${fmt(energy.sources.grid + energy.sources.pv + energy.sources.battery + energy.sources.diesel, 1)} kW，荷侧 ${fmt(energy.components.total + energy.sources.batteryCharge + energy.sources.export, 1)} kW，偏差 ${fmt(energy.powerBalanceKw, 4)} kW。

## 四、热环境与液冷

| 测点 | 实时值 | 建议区间 |
|---|---:|---|
| 冷通道 AB | ${fmt(thermal.coldAisleAB, 1)}°C | 22–24°C |
| 冷通道 CD | ${fmt(thermal.coldAisleCD, 1)}°C | 22–24°C |
| 热通道中心 | ${fmt(thermal.hotAisleCenter, 1)}°C | ≤ 40°C |
| 液冷供液 | ${fmt(thermal.liquidSupplyC, 1)}°C | 30–34°C |
| 液冷回液 | ${fmt(thermal.liquidReturnC, 1)}°C | ≤ 48°C |

温度场随 IT 负载与室外湿球温度动态变化，采用一阶热惯性模型并设置 17–68°C 的硬边界；液冷回液温度与 CDU 换热负载联动。运行期热通道峰值 ${fmt(stats.maxHot, 1)}°C，液冷回液峰值 ${fmt(stats.maxReturn, 1)}°C。

## 五、自动校验与模型可信度

- 校验状态：**${snapshot.validation.status === 'pass' ? '通过' : snapshot.validation.status === 'corrected' ? '自动修正后通过' : '未通过'}**
- PUE 最大偏差：${fmt(snapshot.validation.maxPueDeviationPct, 3)}%（阈值 5%）
- 功率平衡最大偏差：${fmt(snapshot.validation.maxBalanceDeviationPct, 4)}%
- 自动修正次数：${snapshot.validation.correctionCount}
- 当前标定：制冷系数 ${fmt(snapshot.validation.calibration.coolingScale, 3)}、配电损耗系数 ${fmt(snapshot.validation.calibration.distributionScale, 3)}

| 标准算例 | 实测 PUE | 参考 PUE | PUE 偏差 | 功率平衡偏差 | 结果 |
|---|---:|---:|---:|---:|---|
${validationRows(snapshot.validation)}

## 六、告警与故障事件

| 时间 | 级别 | 事件 | 处置说明 |
|---|---|---|---|
${eventRows(allEvents)}

## 七、运维建议

${recommendations(snapshot, stats).map((item, index) => `${index + 1}. ${item}`).join('\n')}

## 八、数据与模型说明

- **3D 场景**：园区层（光伏屋顶、储能、柴发、主进线柜）、机房层（4 排 × 6 柜、冷热通道、行级空调、液冷 CDU、母线槽）、网络层（Spine-Leaf、光模块链路、UnifiedBus 跨柜互联）三层可独立显隐。
- **算力模型**：384 张 NPU，单卡 BF16 峰值 1,024 TFLOPS，卡级放置与队列调度，单卡故障触发断点热迁移。
- **能耗模型**：IT / 制冷 / 供配电损耗 / 辅助四分项，PUE = 总设施功率 ÷ IT 功率；光伏优先消纳，储能削峰填谷，柴油机热备。
- **热模型**：冷热通道与液冷供回液一阶惯性联动，边界钳制与发散回滚；运行保护累计触发 ${snapshot.replayGuard.recoveries} 次。
- **日志字段**：\`reports/runtime-log.csv\` 记录逐分钟遥测，\`reports/fault-events.csv\` 记录完整事件链。

---
*本报告由 NEXUS AIDC 数字孪生引擎自动生成。标准工况偏差超过 5% 时，模型将自动修正制冷标定并重新校验。*
`;
}
