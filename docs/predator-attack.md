# Predator attack loop (draft)

Lightweight adjacent attack for Mode.PREDATOR agents:

- **Targeting:** check 4-neighbors for hostile agents (negative faction affinity). Attack only one adjacent target per tick.
- **Cooldown:** one swing every 2 ticks (`attackCooldown` gate). Always consumes the cooldown, hit or miss.
- **Hit check:** fixed 70% hit chance.
- **On hit:** apply a wound stack to the victim (up to 2). Each hit bumps tension/amplitude, emits combat emotions (aggro/blood/noise/panic) at the target tile, and staggers the victim briefly.
- **Wounds:** first wound adds a short stagger; second wound downs the target (cannot act). Downed agents keep their tile and continue contributing panic/blood through the combat emission.
- **Reactions:** predators don’t move on the same tick they attack; wounded victims slow/stop via stagger/downed flags.

Tunable constants:

- `PREDATOR_ATTACK_COOLDOWN = 2`
- `PREDATOR_HIT_CHANCE = 0.7`
- `PREDATOR_STAGGER_TICKS = 2`
- `PREDATOR_DOWNED_WOUNDS = 2`
