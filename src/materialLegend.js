import { Mode } from './constants.js';

export const GLOBAL_EFFECTS = [
  {
    attribute: 'Heat',
    conditions: [
      { op: '>=', value: 0.75, effect: 'Agents lose tension (heat stress)' },
      { op: '<=', value: 0.35, effect: 'Agents slowly regain tension' },
    ],
  },
  {
    attribute: 'Amplitude',
    conditions: [
      { op: '>=', value: 0.8, effect: 'Agents risk panic (when tension is low)' },
    ],
  },
];

export const materialLegend = {
  [Mode.WATER]: {
    label: 'Water',
    color: '#6ec6ff',
    attributes: {
      heat: [
        { op: '<=', value: 0.15, effect: 'Freeze → becomes Ice' },
        { op: '>=', value: 0.20, effect: 'Thaw → becomes Water' },
      ],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Fire', effect: 'Dampens amplitude, applies small heat splash' },
    ],
  },
  [Mode.ICE]: {
    label: 'Ice',
    color: '#b9e8ff',
    attributes: {
      heat: [
        { op: '>=', value: 0.20, effect: 'Melt → becomes Water' },
      ],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [],
  },
  [Mode.FIRE]: {
    label: 'Fire',
    color: '#ff6a00',
    attributes: {
      heat: [],
      amplitude: [
        { op: '<=', value: 0.2, effect: 'Flame extinguishes' },
      ],
      tension: [],
      phase: [
        { op: '≈', value: 'variable', effect: 'Hue in render pulsing via phase' },
      ],
    },
    interactions: [
      { target: 'Oxygen', effect: 'Couples to grow amplitude & heat' },
      { target: 'Water', effect: 'Phase shift & amplitude loss' },
    ],
  },
  [Mode.CRYOFOAM]: {
    label: 'Cryofoam',
    color: '#d7f3ff',
    attributes: {
      heat: [
        { op: '>=', value: 0.65, effect: 'Integrity drops faster (thaws)' },
      ],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Acid', effect: 'Dissolves foam quickly' },
      { target: 'Base', effect: 'Solidifies to Ice' },
    ],
  },
  [Mode.ACID]: {
    label: 'Acid',
    color: '#9bff8a',
    attributes: {
      heat: [],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Base', effect: 'Neutralizes tension & heats tile' },
      { target: 'Cryofoam', effect: 'Erodes foam lifespan' },
    ],
  },
  [Mode.BASE]: {
    label: 'Base',
    color: '#ffaf87',
    attributes: {
      heat: [],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Acid', effect: 'Neutralization reaction (heat spike)' },
      { target: 'Cryofoam', effect: 'Sets foam into permanent ice' },
    ],
  },
  [Mode.CLF3]: {
    label: 'ClF₃',
    color: '#7eed75',
    attributes: {
      heat: [
        { op: '>=', value: 0.65, effect: 'Integrity loss; canister compromise' },
      ],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Any', effect: 'Propagates fire & consumes oxygen' },
    ],
  },
  [Mode.OXYGEN]: {
    label: 'Oxygen',
    color: '#7bdcff',
    attributes: {
      heat: [],
      amplitude: [
        { op: '>=', value: 1.0, effect: 'Saturated field (supports combustion)' },
      ],
      tension: [],
      phase: [],
    },
    interactions: [],
  },
  [Mode.CALM]: {
    label: 'Calm',
    color: '#ffd166',
    attributes: {
      amplitude: [
        { op: '>=', value: 0.8, effect: 'May flip to Panic when tension ≤ 0.4' },
      ],
      tension: [
        { op: '<=', value: 0.4, effect: 'Low resilience (pairs with high amplitude)' },
      ],
      heat: [],
      phase: [],
    },
    interactions: [],
  },
  [Mode.PANIC]: {
    label: 'Panic',
    color: '#ef476f',
    attributes: {
      amplitude: [
        { op: '<=', value: 0.4, effect: 'Settles back to CALM' },
      ],
      tension: [],
      heat: [],
      phase: [],
    },
    interactions: [],
  },
  [Mode.FACTORY_NODE]: {
    label: 'Ore Node',
    color: '#6b4a2d',
    attributes: {
      heat: [],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Miner', effect: 'Feeds miners with steady iron ore output' },
    ],
  },
  [Mode.FACTORY_MINER]: {
    label: 'Miner',
    color: '#424b5f',
    attributes: {
      heat: [],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Conveyor', effect: 'Drops iron ore items onto connected belts' },
    ],
  },
  [Mode.FACTORY_BELT]: {
    label: 'Conveyor',
    color: '#212939',
    attributes: {
      heat: [],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Smelter', effect: 'Delivers items into smelter or constructor inputs' },
    ],
  },
  [Mode.FACTORY_SMELTER]: {
    label: 'Smelter',
    color: '#52342a',
    attributes: {
      heat: [],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Conveyor', effect: 'Outputs iron ingots when supplied with ore' },
    ],
  },
  [Mode.FACTORY_CONSTRUCTOR]: {
    label: 'Constructor',
    color: '#333b68',
    attributes: {
      heat: [],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Storage', effect: 'Sends crafted plates forward once available' },
    ],
  },
  [Mode.FACTORY_STORAGE]: {
    label: 'Storage Crate',
    color: '#6c512b',
    attributes: {
      heat: [],
      amplitude: [],
      tension: [],
      phase: [],
    },
    interactions: [
      { target: 'Conveyor', effect: 'Collects final products for scoring' },
    ],
  },
};

export function getMaterialLegend(mode){
  return materialLegend[mode] || null;
}
