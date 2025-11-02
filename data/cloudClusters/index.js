export const CLOUD_CLUSTER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'dermal-harvest-loop',
    name: 'Dermal Harvest Loop',
    description: 'Harvests dermal, blood, and visceral stock to print baseline recruits.',
    metadata: { tier: 'starter' },
    objects: [
      {
        id: 'miner-dermal',
        kind: 'miner',
        label: 'Dermal Surgeon',
        description: 'Harvests skin patches from dermal anchors.',
        metadata: { resource: 'skin_patch' },
        ports: [
          {
            id: 'out-dermal',
            direction: 'output',
            label: 'Skin Patch Output',
            itemKeys: ['skin_patch'],
          },
        ],
      },
      {
        id: 'miner-blood',
        kind: 'miner',
        label: 'Bloodwell Surgeon',
        description: 'Draws stabilised blood vials.',
        metadata: { resource: 'blood_vial' },
        ports: [
          {
            id: 'out-blood',
            direction: 'output',
            label: 'Blood Vial Output',
            itemKeys: ['blood_vial'],
          },
        ],
      },
      {
        id: 'miner-organ',
        kind: 'miner',
        label: 'Organ Bloom Surgeon',
        description: 'Harvests organ mass for vat feeds.',
        metadata: { resource: 'organ_mass' },
        ports: [
          {
            id: 'out-organ',
            direction: 'output',
            label: 'Organ Mass Output',
            itemKeys: ['organ_mass'],
          },
        ],
      },
      {
        id: 'vat-body-system',
        kind: 'smelter',
        label: 'Body System Vat',
        description: 'Bioforge that seals multi-organ capsules.',
        metadata: { recipeKey: 'body_system' },
        ports: [
          {
            id: 'in-body',
            direction: 'input',
            label: 'Bioforge Intake',
            itemKeys: ['skin_patch', 'blood_vial', 'organ_mass'],
          },
          {
            id: 'out-body',
            direction: 'output',
            label: 'Body System Output',
            itemKeys: ['body_system'],
          },
        ],
      },
      {
        id: 'constructor-omni',
        kind: 'constructor',
        label: 'Omni Constructor',
        description: 'Configurable fab that assembles recruits or specialist constructs.',
        metadata: {
          blueprintKey: 'human_shell',
          blueprintKeys: ['human_shell', 'caretaker_drone', 'emissary_avatar'],
        },
        ports: [
          {
            id: 'in-body',
            direction: 'input',
            label: 'Body System Intake',
            itemKeys: ['body_system'],
          },
          {
            id: 'in-neural',
            direction: 'input',
            label: 'Neural Weave Intake',
            itemKeys: ['neural_weave'],
          },
          {
            id: 'in-frame',
            direction: 'input',
            label: 'Skeletal Frame Intake',
            itemKeys: ['skeletal_frame'],
          },
          {
            id: 'in-gland',
            direction: 'input',
            label: 'Glandular Network Intake',
            itemKeys: ['glandular_network'],
          },
          {
            id: 'out-construct',
            direction: 'output',
            label: 'Construct Output',
            itemKeys: ['human_shell', 'caretaker_drone', 'emissary_avatar'],
          },
        ],
      },
      {
        id: 'storage-cradle',
        kind: 'storage',
        label: 'Cradle Vault',
        description: 'Buffers completed constructs awaiting deployment.',
        ports: [
          {
            id: 'in-storage',
            direction: 'input',
            label: 'Constructor Intake',
            itemKeys: ['human_shell'],
          },
          {
            id: 'out-storage',
            direction: 'output',
            label: 'Vault Output',
            itemKeys: ['human_shell'],
          },
        ],
      },
    ],
    links: [
      {
        id: 'dermal-to-body',
        source: { objectId: 'miner-dermal', portId: 'out-dermal' },
        target: { objectId: 'vat-body-system', portId: 'in-body' },
      },
      {
        id: 'blood-to-body',
        source: { objectId: 'miner-blood', portId: 'out-blood' },
        target: { objectId: 'vat-body-system', portId: 'in-body' },
      },
      {
        id: 'organ-to-body',
        source: { objectId: 'miner-organ', portId: 'out-organ' },
        target: { objectId: 'vat-body-system', portId: 'in-body' },
      },
      {
        id: 'body-to-shell',
        source: { objectId: 'vat-body-system', portId: 'out-body' },
        target: { objectId: 'constructor-omni', portId: 'in-body' },
      },
      {
        id: 'shell-to-storage',
        source: { objectId: 'constructor-omni', portId: 'out-construct' },
        target: { objectId: 'storage-cradle', portId: 'in-storage' },
      },
    ],
  }),
  Object.freeze({
    id: 'neural-support-chain',
    name: 'Neural Support Chain',
    description: 'Produces neural weave and assembles caretaker drones.',
    metadata: { tier: 'advanced' },
    objects: [
      {
        id: 'miner-nerve',
        kind: 'miner',
        label: 'Synapse Surgeon',
        description: 'Harvests nerve threads for weave fabrication.',
        metadata: { resource: 'nerve_thread' },
        ports: [
          {
            id: 'out-nerve',
            direction: 'output',
            label: 'Nerve Thread Output',
            itemKeys: ['nerve_thread'],
          },
        ],
      },
      {
        id: 'miner-blood-aux',
        kind: 'miner',
        label: 'Serum Surgeon',
        description: 'Provides supplemental blood serum for neural looms.',
        metadata: { resource: 'blood_vial' },
        ports: [
          {
            id: 'out-blood-aux',
            direction: 'output',
            label: 'Blood Vial Output',
            itemKeys: ['blood_vial'],
          },
        ],
      },
      {
        id: 'miner-bone-aux',
        kind: 'miner',
        label: 'Osteo Surgeon',
        description: 'Harvests bone fragments for drone frames.',
        metadata: { resource: 'bone_fragment' },
        ports: [
          {
            id: 'out-bone-aux',
            direction: 'output',
            label: 'Bone Fragment Output',
            itemKeys: ['bone_fragment'],
          },
        ],
      },
      {
        id: 'vat-neural',
        kind: 'smelter',
        label: 'Neural Weave Loom',
        description: 'Spins neural weave from nerve thread and serum.',
        metadata: { recipeKey: 'neural_weave' },
        ports: [
          {
            id: 'in-neural',
            direction: 'input',
            label: 'Loom Intake',
            itemKeys: ['nerve_thread', 'blood_vial'],
          },
          {
            id: 'out-neural',
            direction: 'output',
            label: 'Neural Weave Output',
            itemKeys: ['neural_weave'],
          },
        ],
      },
      {
        id: 'vat-frame',
        kind: 'smelter',
        label: 'Frame Press',
        description: 'Compresses bone fragments into skeletal frames.',
        metadata: { recipeKey: 'skeletal_frame' },
        ports: [
          {
            id: 'in-frame',
            direction: 'input',
            label: 'Frame Intake',
            itemKeys: ['bone_fragment', 'skin_patch'],
          },
          {
            id: 'out-frame',
            direction: 'output',
            label: 'Frame Output',
            itemKeys: ['skeletal_frame'],
          },
        ],
      },
      {
        id: 'miner-dermal-aux',
        kind: 'miner',
        label: 'Dermal Support Surgeon',
        description: 'Supplies dermal binding for skeletal frames.',
        metadata: { resource: 'skin_patch' },
        ports: [
          {
            id: 'out-dermal-aux',
            direction: 'output',
            label: 'Skin Patch Output',
            itemKeys: ['skin_patch'],
          },
        ],
      },
      {
        id: 'constructor-omni-2',
        kind: 'constructor',
        label: 'Omni Constructor',
        description: 'Reconfigurable printer for caretaker drones and other constructs.',
        metadata: {
          blueprintKey: 'caretaker_drone',
          blueprintKeys: ['human_shell', 'caretaker_drone', 'emissary_avatar'],
        },
        ports: [
          {
            id: 'in-body',
            direction: 'input',
            label: 'Body System Intake',
            itemKeys: ['body_system'],
          },
          {
            id: 'in-neural',
            direction: 'input',
            label: 'Neural Weave Intake',
            itemKeys: ['neural_weave'],
          },
          {
            id: 'in-frame',
            direction: 'input',
            label: 'Skeletal Frame Intake',
            itemKeys: ['skeletal_frame'],
          },
          {
            id: 'in-gland',
            direction: 'input',
            label: 'Glandular Network Intake',
            itemKeys: ['glandular_network'],
          },
          {
            id: 'out-construct',
            direction: 'output',
            label: 'Construct Output',
            itemKeys: ['human_shell', 'caretaker_drone', 'emissary_avatar'],
          },
        ],
      },
      {
        id: 'storage-ward',
        kind: 'storage',
        label: 'Caretaker Ward',
        description: 'Staging bay for newly printed caretaker drones.',
        ports: [
          {
            id: 'in-ward',
            direction: 'input',
            label: 'Ward Intake',
            itemKeys: ['caretaker_drone'],
          },
          {
            id: 'out-ward',
            direction: 'output',
            label: 'Ward Output',
            itemKeys: ['caretaker_drone'],
          },
        ],
      },
    ],
    links: [
      {
        id: 'nerve-to-neural',
        source: { objectId: 'miner-nerve', portId: 'out-nerve' },
        target: { objectId: 'vat-neural', portId: 'in-neural' },
      },
      {
        id: 'blood-to-neural',
        source: { objectId: 'miner-blood-aux', portId: 'out-blood-aux' },
        target: { objectId: 'vat-neural', portId: 'in-neural' },
      },
      {
        id: 'dermal-to-frame',
        source: { objectId: 'miner-dermal-aux', portId: 'out-dermal-aux' },
        target: { objectId: 'vat-frame', portId: 'in-frame' },
      },
      {
        id: 'bone-to-frame',
        source: { objectId: 'miner-bone-aux', portId: 'out-bone-aux' },
        target: { objectId: 'vat-frame', portId: 'in-frame' },
      },
      {
        id: 'neural-to-caretaker',
        source: { objectId: 'vat-neural', portId: 'out-neural' },
        target: { objectId: 'constructor-omni-2', portId: 'in-neural' },
      },
      {
        id: 'frame-to-caretaker',
        source: { objectId: 'vat-frame', portId: 'out-frame' },
        target: { objectId: 'constructor-omni-2', portId: 'in-frame' },
      },
      {
        id: 'caretaker-to-ward',
        source: { objectId: 'constructor-omni-2', portId: 'out-construct' },
        target: { objectId: 'storage-ward', portId: 'in-ward' },
      },
    ],
  }),
]);

export default CLOUD_CLUSTER_PRESETS;
