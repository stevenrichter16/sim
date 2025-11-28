import { fieldConfig } from './config.js';
import { EmotionFields } from './emotionConstants.js';

const FIELD_VALUE_UNIT_RANGE = Object.freeze([0, 1]);

function getFieldConfigEntry(fieldKey){
  return fieldConfig[fieldKey] ?? {};
}

function buildFieldSpec(fieldKey, metadataOverrides = {}){
  const fieldConfigEntry = getFieldConfigEntry(fieldKey);
  return Object.freeze({
    key: fieldKey,
    range: metadataOverrides.range ?? FIELD_VALUE_UNIT_RANGE,
    kind: metadataOverrides.kind ?? 'general',
    description: metadataOverrides.description ?? '',
    baseDeposit: fieldConfigEntry.baseDeposit ?? 0,
    diffusionRate: fieldConfigEntry.diffusionRate,
    halfLifeTurns: fieldConfigEntry.halfLifeTurns,
    derived: Boolean(metadataOverrides.derived),
    inputs: metadataOverrides.inputs,
  });
}

export const FIELD_REGISTRY = Object.freeze({
  [EmotionFields.Help]: buildFieldSpec(EmotionFields.Help, {
    kind: 'signal',
    description: 'Assistance beacon to rally nearby allies.',
  }),
  [EmotionFields.Route]: buildFieldSpec(EmotionFields.Route, {
    kind: 'navigation',
    description: 'Breadcrumb path for routine movement.',
  }),
  [EmotionFields.Panic]: buildFieldSpec(EmotionFields.Panic, {
    kind: 'threat',
    description: 'Fear/danger signal that fuels tension.',
  }),
  [EmotionFields.Escape]: buildFieldSpec(EmotionFields.Escape, {
    kind: 'navigation',
    description: 'Urgent pathing hint toward perceived exits.',
  }),
  [EmotionFields.Aggro]: buildFieldSpec(EmotionFields.Aggro, {
    kind: 'threat',
    description: 'Hostility markers emitted by combat.',
  }),
  [EmotionFields.Curiosity]: buildFieldSpec(EmotionFields.Curiosity, {
    kind: 'interest',
    description: 'Exploration pull toward unknown or interesting tiles.',
  }),
  [EmotionFields.Awe]: buildFieldSpec(EmotionFields.Awe, {
    kind: 'interest',
    description: 'Wonder that buffers fear suppression and rewards exploration.',
  }),
  [EmotionFields.Noise]: buildFieldSpec(EmotionFields.Noise, {
    kind: 'signal',
    description: 'Audible disturbance propagated by movement or events.',
  }),
  [EmotionFields.Blood]: buildFieldSpec(EmotionFields.Blood, {
    kind: 'marker',
    description: 'Violence residue that sustains tension.',
  }),
  [EmotionFields.Discovery]: buildFieldSpec(EmotionFields.Discovery, {
    kind: 'marker',
    description: 'Points of interest tagged by recent discoveries.',
  }),
  [EmotionFields.Safe]: buildFieldSpec(EmotionFields.Safe, {
    kind: 'comfort',
    description: 'Comfort/relief signal that counteracts threat.',
    calmTensionBoost: getFieldConfigEntry(EmotionFields.Safe).calmTensionBoost,
    calmAmplitudeDrop: getFieldConfigEntry(EmotionFields.Safe).calmAmplitudeDrop,
  }),
  [EmotionFields.Door]: buildFieldSpec(EmotionFields.Door, {
    kind: 'structure',
    description: 'Static affordance hint for door-adjacent tiles.',
  }),
  [EmotionFields.Visited]: buildFieldSpec(EmotionFields.Visited, {
    kind: 'memory',
    description: 'Exploration memory indicating how often a tile was traversed.',
  }),
  [EmotionFields.ComputedTension]: buildFieldSpec(EmotionFields.ComputedTension, {
    kind: 'derived',
    description: 'Blend of panic, comfort, and aggro for agent pressure.',
    derived: true,
    inputs: [EmotionFields.Panic, EmotionFields.Safe, EmotionFields.Aggro],
  }),
});

export function getFieldSpec(fieldKey){
  return FIELD_REGISTRY[fieldKey];
}

export function getFieldDepositBase(fieldKey){
  return getFieldSpec(fieldKey)?.baseDeposit ?? 0;
}

export function isDerivedField(fieldKey){
  return Boolean(getFieldSpec(fieldKey)?.derived);
}

export function listRegisteredFields(){
  return Object.values(FIELD_REGISTRY);
}
