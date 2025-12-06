export const thresholds = {
  freezePoint: 0.15,
  meltPoint: 0.20,
  socialStress: {
    trigger: 0.05,
    tensionMultiplier: 0.15,
  },
  oxygen: {
    lowAmplitudeThreshold: 0.17,
    lowTensionThreshold: 0.15,
    highTensionThreshold: 0.19,
    lowAmplitudeRise: 0.01,
    lowTensionDrop: 0.02,
    highTensionRecovery: 0.01,
  },
  heat: {
    highThreshold: 0.75,
    lowThreshold: 0.35,
    highTensionDrop: 0.03,
    lowTensionRecovery: 0.005,
  },
  panic: {
    amplitudeHigh: 0.8,
    amplitudeLow: 0.4,
    tensionLow: 0.4,
  },
  cryofoam: {
    heatCap: 0.18,
  },
};

export const roles = {
  medic: {
    auraRadius: 3,
    auraTensionBoost: 0.01,
    auraAmplitudeDrop: 0.02,
    burstTensionBoost: 0.1,
    burstAmplitudeDrop: 0.05,
    burstCooldown: 12,
    burstTriggerTension: 0.4,
    stressResistance: {
      heat: true,
      social: true,
      oxygen: false,
    },
    searchRadius: 32,
    scanInterval: 6,
    repathInterval: 12,
    maxAssignmentsPerTarget: 1,
  },
};

export const fieldConfig = {
  Help:    { diffusionRate: 0.12, halfLifeTurns: 6,   baseDeposit: 0.10 },
  Route:   { diffusionRate: 0.10, halfLifeTurns: 30,  baseDeposit: 0.04 },
  Panic:   { diffusionRate: 0.10, halfLifeTurns: 8,   baseDeposit: 0.05 },
  Safe:    {
    diffusionRate: 0.09,
    halfLifeTurns: 25,
    baseDeposit: 0.02,
    calmTensionBoost: 0.005,
    calmAmplitudeDrop: 0.005,
  },
  Escape:  { diffusionRate: 0.11, halfLifeTurns: 10,  baseDeposit: 0.04 },
  Door:    { diffusionRate: 0.10, halfLifeTurns: 15 },
  Visited: { diffusionRate: 0.06,    halfLifeTurns: 120, baseDeposit: 0.08 },
  Sound:   { diffusionRate: 0.28, halfLifeTurns: 15,  baseDeposit: 0.10 },

  // Emotion/psychology fields
  Aggro:     { diffusionRate: 0.08, halfLifeTurns: 20,  baseDeposit: 0.15 },  // Hostility - slower decay
  Curiosity: { diffusionRate: 0.11, halfLifeTurns: 40,  baseDeposit: 0.08 },  // Exploration - long persistence
  Awe:       { diffusionRate: 0.12, halfLifeTurns: 35,  baseDeposit: 0.12 },  // Wonder - spreads fast
  Noise:     { diffusionRate: 0.28, halfLifeTurns: 5,   baseDeposit: 0.20 },  // Sound - fast diffusion, short life
  Blood:     { diffusionRate: 0.00004, halfLifeTurns: 5000020, baseDeposit: 5.25 },  // Combat aftermath - very long-lasting
  Discovery: { diffusionRate: 0.11, halfLifeTurns: 40, baseDeposit: 0.08 },  // Points of interest - match curiosity profile
};

export function decayMultiplierFromHalfLife(tHalf, dt = 1){
  return Math.pow(0.5, dt / Math.max(1e-6, tHalf));
}
