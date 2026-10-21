import type { RackDefinition } from '../types';

export const ROWS = [
  { id: 'A', z: -7.2, facing: 1 as const, liquidCooled: false, label: 'A 排 · 风冷' },
  { id: 'B', z: -3.6, facing: -1 as const, liquidCooled: true, label: 'B 排 · 液冷' },
  { id: 'C', z: 3.6, facing: 1 as const, liquidCooled: true, label: 'C 排 · 液冷' },
  { id: 'D', z: 7.2, facing: -1 as const, liquidCooled: false, label: 'D 排 · 风冷' },
] as const;

export const RACK_X = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];
export const RACKS_PER_ROW = 6;
export const NPUS_PER_RACK = 16;
export const NPU_TFLOPS = 1024;

export const COLD_AISLES = [
  { id: 'AB', z: -5.4, rows: ['A', 'B'] as const },
  { id: 'CD', z: 5.4, rows: ['C', 'D'] as const },
];

export const RACK_DEFINITIONS: RackDefinition[] = ROWS.flatMap((row) =>
  RACK_X.map((x, slot) => ({
    id: `${row.id}${String(slot + 1).padStart(2, '0')}`,
    row: row.id,
    slot,
    liquidCooled: row.liquidCooled,
    x,
    z: row.z,
    facing: row.facing,
  })),
);

export const CAMPUS = {
  name: 'NEXUS · 华东智算中心',
  code: 'AIDC-CAMPUS-01',
  location: '中国 · 长三角 · 临港算力园区',
  pvRatedKw: 760,
  pvAreaM2: 4200,
  bessCapacityKwh: 1200,
  bessPowerKw: 360,
  dieselRatedKw: 2 * 1000,
  transformerKva: 1600,
  gridCapacityKw: 1250,
};

export const RACK_BY_ID = new Map(RACK_DEFINITIONS.map((rack) => [rack.id, rack]));

export const TASK_TEMPLATES = [
  {
    name: 'LLM-70B · 长序列预训练',
    type: 'training' as const,
    cards: 64,
    durationSec: 10_800,
    tokensPerCardSec: 96,
    priority: 8,
    accent: '#32d6ff',
  },
  {
    name: '多模态-MoE · 指令微调',
    type: 'training' as const,
    cards: 32,
    durationSec: 5_400,
    tokensPerCardSec: 128,
    priority: 7,
    accent: '#8b7bff',
  },
  {
    name: 'DeepSeek-R1 · 实时推理',
    type: 'inference' as const,
    cards: 32,
    durationSec: 2_400,
    tokensPerCardSec: 520,
    priority: 9,
    accent: '#b8ff5a',
  },
  {
    name: 'Qwen3-72B · Agent 服务',
    type: 'inference' as const,
    cards: 16,
    durationSec: 1_800,
    tokensPerCardSec: 680,
    priority: 8,
    accent: '#ffd166',
  },
  {
    name: 'Embedding-4B · 向量化',
    type: 'inference' as const,
    cards: 8,
    durationSec: 1_500,
    tokensPerCardSec: 1_250,
    priority: 6,
    accent: '#54e6b1',
  },
];

export const DESIGN = {
  rackOverheadKw: 1.7,
  npuPeakKw: 1.25,
  networkFixedKw: 12,
  networkVariableKw: 8,
  liquidHeatShare: 0.54,
};
