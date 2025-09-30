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
  },
};
