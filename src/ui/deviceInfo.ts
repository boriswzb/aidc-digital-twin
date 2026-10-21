import type { DeviceInfo, EngineSnapshot } from '../types';
import type { SceneDevice } from '../scene/DigitalTwinScene';

const fmt = (value: number, digits = 1): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '—';

export function buildDeviceInfo(device: SceneDevice, snapshot: EngineSnapshot): DeviceInfo {
  const compute = snapshot.compute;
  const energy = snapshot.energy;
  const thermal = snapshot.thermal;

  if (device.kind === 'rack') {
    const rack = compute.racks.find((item) => item.id === device.id);
    const tasks = compute.tasks.filter((task) => task.rackIds.includes(device.id));
    if (!rack) {
      return fallback(device);
    }
    const fault = rack.status === 'fault';
    return {
      ...device,
      subtitle: `${rack.row} 排 · ${rack.liquidCooled ? '液冷' : '风冷'} · 16 × NPU`,
      status: fault ? '故障隔离 / 热迁移处置中' : rack.status === 'running' ? '运行正常' : '待机就绪',
      tone: fault ? 'red' : rack.status === 'running' ? 'cyan' : 'green',
      metrics: [
        { label: '在跑算力卡', value: `${rack.allocatedCards} / ${rack.healthyCards}` },
        { label: '机柜负载', value: `${fmt(rack.loadKw)} kW` },
        { label: '进风温度', value: `${fmt(rack.intakeC)} °C` },
        { label: '机柜利用率', value: `${fmt(rack.utilization)} %` },
      ],
      detail: fault
        ? `检测到 ${rack.totalCards - rack.healthyCards} 张 NPU 离线，调度器已触发断点热迁移；健康算力 ${rack.healthyCards} 卡。`
        : tasks.length > 0
          ? `正在承载 ${tasks.map((task) => task.name).join('、')}，通过 ${rack.liquidCooled ? '冷板液冷' : '行级空调'} 散热。`
          : '机柜在线待命，母线槽与叶交换机链路均已就绪，可接收新任务。',
    };
  }

  if (device.kind === 'pv') {
    return {
      ...device,
      subtitle: '屋顶分布式光伏 · 组串式逆变',
      status: '并网发电中',
      tone: 'green',
      metrics: [
        { label: '实时功率', value: `${fmt(energy.pvKw)} kW` },
        { label: '装机容量', value: '760 kWp' },
        { label: '消纳占比', value: `${fmt(energy.renewableSharePct)} %` },
        { label: '组件面积', value: '4,200 m²' },
      ],
      detail: `光伏优先供给园区负荷，富余电量存入储能。当前环境 ${fmt(
        energy.ambientC,
      )}°C，组件表面温度由辐照与风速联合估算。`,
    };
  }

  if (device.kind === 'bess') {
    const charging = energy.batteryKw < 0;
    return {
      ...device,
      subtitle: '磷酸铁锂储能 · 2h 系统',
      status: charging ? '谷电 / 光伏充电中' : energy.batteryKw > 0 ? '削峰放电中' : '待机热备',
      tone: charging ? 'violet' : 'green',
      metrics: [
        { label: '电池 SOC', value: `${fmt(energy.batterySocPct)} %` },
        { label: '实时功率', value: `${fmt(Math.abs(energy.batteryKw))} kW` },
        { label: '额定容量', value: '1,200 kWh' },
        { label: '循环状态', value: charging ? '充电' : '放电 / 待机' },
      ],
      detail: `储能与光伏、柴发共同构成园区微网。当前电池${charging ? '吸收富余光伏' : '参与削峰调节'}，SOC 安全区间 12%–96%。`,
    };
  }

  if (device.kind === 'diesel') {
    return {
      ...device,
      subtitle: '2 × 1000 kW · 10.5 kV 并网',
      status: '热备待机',
      tone: 'amber',
      metrics: [
        { label: '额定功率', value: '2,000 kW' },
        { label: '实时输出', value: `${fmt(energy.dieselKw)} kW` },
        { label: '启动时间', value: '≤ 15 s' },
        { label: '燃油储备', value: '8 h @ 满载' },
      ],
      detail: '市电与柴发设置机械 / 电气双联锁，仅在电网失电或容量不足时投入，本次仿真处于热备状态。',
    };
  }

  if (device.kind === 'switchgear' || device.kind === 'transformer') {
    const loadRate = (energy.totalKw / 1600) * 100;
    return {
      ...device,
      subtitle: device.kind === 'switchgear' ? '双路 10 kV 进线 · 母联互备' : '1,600 kVA 干式变压器',
      status: '供电正常',
      tone: 'cyan',
      metrics: [
        { label: '当前总负荷', value: `${fmt(energy.totalKw)} kW` },
        { label: '进线容量', value: '1,600 kVA' },
        { label: '负载率', value: `${fmt(loadRate)} %` },
        { label: '供电来源', value: `市电 + 光伏` },
      ],
      detail: `A / B 路市电互为备用，UPS 与变压器损耗已计入 PUE 供配电分项。当前电网进线 ${fmt(
        energy.gridKw,
      )} kW。`,
    };
  }

  if (device.kind === 'cdu') {
    return {
      ...device,
      subtitle: '冷板式液冷 · 二次侧循环',
      status: '变频运行',
      tone: 'violet',
      metrics: [
        { label: '液冷负荷', value: `${fmt(energy.liquidCoolingKw)} kW` },
        { label: '供液温度', value: `${fmt(thermal.liquidSupplyC)} °C` },
        { label: '回液温度', value: `${fmt(thermal.liquidReturnC)} °C` },
        { label: '供回液温差', value: `${fmt(thermal.liquidReturnC - thermal.liquidSupplyC)} °C` },
      ],
      detail: 'CDU 依据 NPU 冷板负载调节二次侧泵速，供回液温度与 IT 功率实时联动；回液超温会自动请求冷源侧增强换热。',
    };
  }

  if (device.kind === 'crah') {
    return {
      ...device,
      subtitle: '行级精密空调 · EC 风机',
      status: '联动制冷中',
      tone: 'cyan',
      metrics: [
        { label: '冷通道均温', value: `${fmt(thermal.coldAisleC)} °C` },
        { label: '热通道均温', value: `${fmt(thermal.hotAisleC)} °C` },
        { label: '风冷负荷', value: `${fmt(energy.airCoolingKw)} kW` },
        { label: '冷机 COP', value: fmt(energy.cop, 2) },
      ],
      detail: '行级空调按冷通道回风温度与机柜负载进行 EC 风机调速，配合封闭冷通道抑制冷热掺混。',
    };
  }

  if (device.kind === 'spine' || device.kind === 'leaf') {
    return {
      ...device,
      subtitle: device.kind === 'spine' ? 'Spine 核心 · 800G 光互联' : 'Leaf 接入 · 25/400G 下行',
      status: '链路聚合正常',
      tone: 'cyan',
      metrics: [
        { label: '端口状态', value: device.kind === 'spine' ? '64 × 800G' : '48 × 400G' },
        { label: '集群利用率', value: `${fmt(compute.utilization)} %` },
        { label: '交换时延', value: '< 1.2 μs' },
        { label: '丢包率', value: '0.000%' },
      ],
      detail: 'Spine-Leaf 采用无阻塞 CLOS 架构，NPU 间 AllReduce 与 UnifiedBus 流量分平面承载，支持故障链路秒级切换。',
    };
  }

  if (device.kind === 'busway') {
    return {
      ...device,
      subtitle: '智能小母线 · 双路热插拔',
      status: '供电正常',
      tone: 'amber',
      metrics: [
        { label: '额定电流', value: '800 A' },
        { label: '机柜总负载', value: `${fmt(compute.racks.reduce((sum, rack) => sum + rack.loadKw, 0))} kW` },
        { label: '插接箱', value: '24 路' },
        { label: '压降', value: '< 0.8%' },
      ],
      detail: '双路小母线为机柜提供 A/B 路冗余供电，插接箱内置电量计量，可定位到单柜 PUE 与负载异常。',
    };
  }

  if (device.kind === 'chiller') {
    return {
      ...device,
      subtitle: '干冷器 + 冷机 · 自然冷却',
      status: energy.ambientC < 18 ? '自然冷却模式' : '机械制冷模式',
      tone: 'green',
      metrics: [
        { label: '冷机 COP', value: fmt(energy.cop, 2) },
        { label: '制冷功率', value: `${fmt(energy.coolingKw)} kW` },
        { label: '室外温度', value: `${fmt(energy.ambientC)} °C` },
        { label: '供液温度', value: `${fmt(thermal.liquidSupplyC)} °C` },
      ],
      detail: '冷源根据室外湿球温度切换自然冷却 / 机械制冷，并联合 CDU 与行级空调分配冷量。',
    };
  }

  return fallback(device);
}

function fallback(device: SceneDevice): DeviceInfo {
  return {
    ...device,
    subtitle: 'AIDC 数字孪生设备',
    status: '在线',
    tone: 'cyan',
    metrics: [
      { label: '资产状态', value: '已纳管' },
      { label: '遥测', value: '实时同步' },
      { label: '告警', value: '无' },
      { label: '维护模式', value: '自动' },
    ],
    detail: '设备已接入数字孪生体，遥测数据每仿真分钟刷新一次。',
  };
}
