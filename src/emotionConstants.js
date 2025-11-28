export const EmotionFields = Object.freeze({
  Help: 'Help',
  Route: 'Route',
  Panic: 'Panic',
  Safe: 'Safe',
  Escape: 'Escape',
  Door: 'Door',
  Visited: 'Visited',
  Aggro: 'Aggro',
  Curiosity: 'Curiosity',
  Awe: 'Awe',
  Noise: 'Noise',
  Blood: 'Blood',
  Discovery: 'Discovery',
  ComputedTension: 'ComputedTension',
});

export const FieldCoupling = Object.freeze({
  AggroWeight: 0.5,            // β parameter for computed tension
  SuppressionStrength: 0.7,    // How much fear suppresses curiosity
  AweRelief: 0.5,              // Awe softens fear-driven suppression
  AweExplorationBoost: 0.25,   // Awe nudges exploration when fear is low
  HighFearThreshold: 0.6,      // Threshold above which fear suppresses curiosity strongly
  CalmFearThreshold: 0.35,     // Threshold below which awe can gently amplify curiosity
  AweCalmThreshold: 0.3,       // Minimum awe before curiosity lift applies
});
