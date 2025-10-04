import { Mode } from './constants.js';

const Tags = Object.freeze({
  STATE_FIRE: 'state.fire',
  STATE_FOAM: 'state.foam',
  STATE_AGENT: 'state.agent',
  BIO_STRESSED: 'bio.stressed',
  ELEMENT_OXYGEN: 'element.oxygen',
  ELEMENT_WATER: 'element.water',
  ELEMENT_ACID: 'element.acid',
  ELEMENT_BASE: 'element.base',
  BEHAVIOR_COMBUSTING: 'behavior.combusting',
  BEHAVIOR_EXTINGUISHING: 'behavior.extinguishing',
  BEHAVIOR_COOLING: 'behavior.cooling',
  BEHAVIOR_HEALING: 'behavior.healing',
  BEHAVIOR_CORROSIVE: 'behavior.corrosive',
  BEHAVIOR_OXIDIZER: 'behavior.oxidizer',
  BEHAVIOR_REACTIVE: 'behavior.reactive',
  VOLATILITY_HIGH: 'volatility.high',
  VOLATILITY_INERT: 'volatility.inert',
  ENV_O2_RICH: 'env.o2.rich',
  ENV_O2_POOR: 'env.o2.poor',
  ENV_HEAT_HIGH: 'env.heat.high',
  ENV_HEAT_LOW: 'env.heat.low',
  PHASE_SYNC: 'phase.sync',
  PHASE_OFFBEAT: 'phase.offbeat'
});

const CardLibrary = Object.freeze({
  combustive: Object.freeze({
    tags: [Tags.STATE_FIRE, Tags.BEHAVIOR_COMBUSTING, Tags.VOLATILITY_HIGH],
    emission: { heat: 1.0, o2: -0.45 },
    coupling: { gain: 0.3, phaseBias: 0.12 },
    response: {
      amplitude: { self: 0.35 },
      tension: { self: -0.1 },
      heat: { self: 8.0, neighbor: 1.0 }
    },
    permeability: { heat: 0.15, o2: 0.05 }
  }),
  volatileHigh: Object.freeze({
    tags: [Tags.VOLATILITY_HIGH],
    emission: { heat: 0.28 },
    coupling: { gain: 0.18 },
    response: {
      amplitude: { self: 0.15, neighbor: 0.1 }
    }
  }),
  oxidizer: Object.freeze({
    tags: [Tags.BEHAVIOR_OXIDIZER, Tags.ELEMENT_OXYGEN],
    emission: { heat: 0.05, o2: 0.55 },
    coupling: { gain: 0.12 },
    response: {
      amplitude: { neighbor: 0.22 },
      tension: { neighbor: 0.05 }
    },
    permeability: { o2: 0.25 }
  }),
  extinguisher: Object.freeze({
    tags: [Tags.BEHAVIOR_EXTINGUISHING, Tags.ELEMENT_WATER],
    emission: { heat: -0.55, o2: 0.18 },
    coupling: { gain: -0.22, damping: 0.05 },
    response: {
      amplitude: { self: -0.3, neighbor: -0.45 },
      tension: { self: 0.14, neighbor: 0.08 },
      heat: { neighbor: -1.4 }
    },
    permeability: { heat: -0.3 }
  }),
  cooling: Object.freeze({
    tags: [Tags.BEHAVIOR_COOLING, Tags.ENV_HEAT_LOW],
    emission: { heat: -0.4 },
    coupling: { gain: -0.1, damping: 0.04 },
    response: {
      heat: { self: -2.2, neighbor: -0.9 },
      tension: { self: 0.12 }
    }
  }),
  foam: Object.freeze({
    tags: [Tags.STATE_FOAM],
    emission: { heat: -0.65, o2: 0.1 },
    coupling: { gain: -0.38, damping: 0.08 },
    response: {
      amplitude: { self: -0.32, neighbor: -0.4 },
      tension: { self: 0.18 },
      heat: { neighbor: -1.2 }
    },
    permeability: { heat: -0.45, o2: -0.3 }
  }),
  reactive: Object.freeze({
    tags: [Tags.BEHAVIOR_REACTIVE],
    response: {
      amplitude: { self: 0.08, neighbor: 0.06 },
      tension: { neighbor: -0.05 }
    }
  }),
  corrosive: Object.freeze({
    tags: [Tags.BEHAVIOR_CORROSIVE, Tags.ELEMENT_ACID],
    emission: { heat: 0.25 },
    response: {
      tension: { neighbor: -0.12 },
      heat: { neighbor: 3.0 }
    }
  }),
  basic: Object.freeze({
    tags: [Tags.ELEMENT_BASE],
    response: {
      tension: { self: 0.06, neighbor: 0.04 }
    }
  }),
  soothing: Object.freeze({
    tags: [Tags.BEHAVIOR_HEALING, Tags.STATE_AGENT],
    coupling: { damping: 0.03 },
    response: {
      amplitude: { self: -0.18, neighbor: -0.1 },
      tension: { self: 0.22, neighbor: 0.24 },
      heat: { self: -0.6 }
    }
  }),
  stressed: Object.freeze({
    tags: [Tags.BIO_STRESSED, Tags.STATE_AGENT],
    emission: { heat: 0.1 },
    coupling: { gain: 0.08, damping: -0.02 },
    response: {
      amplitude: { self: 0.22 },
      tension: { self: -0.24 }
    }
  })
});

const ModeCards = Object.freeze({
  [Mode.FIRE]: ['combustive', 'volatileHigh'],
  [Mode.OXYGEN]: ['oxidizer'],
  [Mode.WATER]: ['extinguisher', 'cooling'],
  [Mode.ICE]: ['cooling', 'foam'],
  [Mode.CRYOFOAM]: ['foam', 'cooling'],
  [Mode.ACID]: ['reactive', 'corrosive'],
  [Mode.BASE]: ['reactive', 'basic'],
  [Mode.CLF3]: ['combustive', 'reactive', 'volatileHigh'],
  [Mode.CALM]: ['soothing'],
  [Mode.PANIC]: ['reactive', 'volatileHigh', 'stressed'],
  [Mode.MEDIC]: ['soothing', 'cooling']
});

const DerivedTagObservers = Object.freeze({
  [Tags.ENV_O2_RICH]: Object.freeze({ field: 'o2', type: 'threshold', comparator: '>', value: 0.24, smoothing: 0.85 }),
  [Tags.ENV_O2_POOR]: Object.freeze({ field: 'o2', type: 'threshold', comparator: '<', value: 0.16, smoothing: 0.85 }),
  [Tags.ENV_HEAT_HIGH]: Object.freeze({ field: 'heat', type: 'threshold', comparator: '>', value: 0.72, smoothing: 0.85 }),
  [Tags.ENV_HEAT_LOW]: Object.freeze({ field: 'heat', type: 'threshold', comparator: '<', value: 0.18, smoothing: 0.85 }),
  [Tags.PHASE_SYNC]: Object.freeze({ field: 'phase', type: 'variance', neighborhood: 2, value: 0.15 }),
  [Tags.PHASE_OFFBEAT]: Object.freeze({ field: 'phase', type: 'variance', neighborhood: 2, value: 0.35 })
});

const TagContributions = Object.freeze({
  emission: Object.freeze({
    heat: Object.freeze({
      [Tags.ENV_HEAT_HIGH]: 0.18,
      [Tags.ENV_HEAT_LOW]: -0.18
    }),
    o2: Object.freeze({
      [Tags.ENV_O2_RICH]: 0.12,
      [Tags.ENV_O2_POOR]: -0.12
    })
  }),
  coupling: Object.freeze({
    gain: Object.freeze({
      [Tags.PHASE_SYNC]: 0.2,
      [Tags.PHASE_OFFBEAT]: -0.25
    }),
    damping: Object.freeze({
      [Tags.PHASE_SYNC]: -0.02,
      [Tags.PHASE_OFFBEAT]: 0.04
    })
  }),
  response: Object.freeze({
    tension: Object.freeze({
      self: Object.freeze({ [Tags.ENV_O2_POOR]: -0.08, [Tags.ENV_O2_RICH]: 0.05 }),
      neighbor: Object.freeze({ [Tags.BEHAVIOR_HEALING]: 0.16 })
    }),
    amplitude: Object.freeze({
      self: Object.freeze({ [Tags.BIO_STRESSED]: 0.12 })
    })
  }),
  permeability: Object.freeze({
    heat: Object.freeze({ [Tags.ENV_HEAT_LOW]: -0.1, [Tags.ENV_HEAT_HIGH]: 0.05 }),
    o2: Object.freeze({ [Tags.ENV_O2_RICH]: 0.05, [Tags.ENV_O2_POOR]: -0.05 })
  })
});

function createAccumulator() {
  return {
    tagWeights: new Map(),
    emission: { heat: 0, o2: 0 },
    coupling: { gain: 0, phaseBias: 0, damping: 0 },
    response: {
      amplitude: { self: 0, neighbor: 0 },
      tension: { self: 0, neighbor: 0 },
      heat: { self: 0, neighbor: 0 }
    },
    permeability: { heat: 0, o2: 0 }
  };
}

function applyCard(acc, card, weight) {
  const w = weight ?? 1;
  for (const tag of card.tags || []) {
    const prev = acc.tagWeights.get(tag) || 0;
    acc.tagWeights.set(tag, prev + w);
  }
  if (card.emission) {
    if (card.emission.heat !== undefined) acc.emission.heat += card.emission.heat * w;
    if (card.emission.o2 !== undefined) acc.emission.o2 += card.emission.o2 * w;
  }
  if (card.coupling) {
    if (card.coupling.gain !== undefined) acc.coupling.gain += card.coupling.gain * w;
    if (card.coupling.phaseBias !== undefined) acc.coupling.phaseBias += card.coupling.phaseBias * w;
    if (card.coupling.damping !== undefined) acc.coupling.damping += card.coupling.damping * w;
  }
  if (card.response) {
    if (card.response.amplitude) {
      if (card.response.amplitude.self !== undefined) acc.response.amplitude.self += card.response.amplitude.self * w;
      if (card.response.amplitude.neighbor !== undefined) acc.response.amplitude.neighbor += card.response.amplitude.neighbor * w;
    }
    if (card.response.tension) {
      if (card.response.tension.self !== undefined) acc.response.tension.self += card.response.tension.self * w;
      if (card.response.tension.neighbor !== undefined) acc.response.tension.neighbor += card.response.tension.neighbor * w;
    }
    if (card.response.heat) {
      if (card.response.heat.self !== undefined) acc.response.heat.self += card.response.heat.self * w;
      if (card.response.heat.neighbor !== undefined) acc.response.heat.neighbor += card.response.heat.neighbor * w;
    }
  }
  if (card.permeability) {
    if (card.permeability.heat !== undefined) acc.permeability.heat += card.permeability.heat * w;
    if (card.permeability.o2 !== undefined) acc.permeability.o2 += card.permeability.o2 * w;
  }
}

function applyTagContribution(acc, tag, weight) {
  const w = weight ?? 1;
  const heatEmission = TagContributions.emission.heat[tag];
  if (heatEmission !== undefined) acc.emission.heat += heatEmission * w;
  const o2Emission = TagContributions.emission.o2[tag];
  if (o2Emission !== undefined) acc.emission.o2 += o2Emission * w;
  const gain = TagContributions.coupling.gain[tag];
  if (gain !== undefined) acc.coupling.gain += gain * w;
  const damping = TagContributions.coupling.damping[tag];
  if (damping !== undefined) acc.coupling.damping += damping * w;
  const tensionSelf = TagContributions.response.tension.self[tag];
  if (tensionSelf !== undefined) acc.response.tension.self += tensionSelf * w;
  const tensionNeighbor = TagContributions.response.tension.neighbor[tag];
  if (tensionNeighbor !== undefined) acc.response.tension.neighbor += tensionNeighbor * w;
  const amplitudeSelf = TagContributions.response.amplitude?.self?.[tag];
  if (amplitudeSelf !== undefined) acc.response.amplitude.self += amplitudeSelf * w;
  const permeabilityHeat = TagContributions.permeability.heat[tag];
  if (permeabilityHeat !== undefined) acc.permeability.heat += permeabilityHeat * w;
  const permeabilityO2 = TagContributions.permeability.o2[tag];
  if (permeabilityO2 !== undefined) acc.permeability.o2 += permeabilityO2 * w;
}

function finaliseAccumulator(acc) {
  return Object.freeze({
    tags: Object.freeze(Object.fromEntries(acc.tagWeights)),
    emission: Object.freeze({ ...acc.emission }),
    coupling: Object.freeze({ ...acc.coupling }),
    response: Object.freeze({
      amplitude: Object.freeze({ ...acc.response.amplitude }),
      tension: Object.freeze({ ...acc.response.tension }),
      heat: Object.freeze({ ...acc.response.heat })
    }),
    permeability: Object.freeze({ ...acc.permeability })
  });
}

function cardById(id) {
  const card = CardLibrary[id];
  if (!card) throw new Error(`Unknown tag card: ${id}`);
  return card;
}

function applyCardSet(acc, cardIds, weights) {
  for (const id of cardIds) {
    const card = cardById(id);
    applyCard(acc, card, weights?.[id]);
  }
}

function applyExtraTags(acc, extraTags) {
  if (!extraTags) return;
  for (const [tag, weight] of Object.entries(extraTags)) {
    const prev = acc.tagWeights.get(tag) || 0;
    acc.tagWeights.set(tag, prev + (weight ?? 1));
    applyTagContribution(acc, tag, weight);
  }
}

export function cardsForMode(mode) {
  return ModeCards[mode] ? [...ModeCards[mode]] : [];
}

export function evaluateCards(cardIds, { weights, extraTags } = {}) {
  const acc = createAccumulator();
  applyCardSet(acc, cardIds, weights);
  applyExtraTags(acc, extraTags);
  return finaliseAccumulator(acc);
}

export function evaluateMode(mode, options) {
  return evaluateCards(cardsForMode(mode), options);
}

export { Tags, CardLibrary, ModeCards, DerivedTagObservers };
