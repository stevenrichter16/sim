export const OPCODES = Object.freeze({
  CONSTANT: 0x01,
  NULL: 0x02,
  TRUE: 0x03,
  FALSE: 0x04,
  POP: 0x05,
  DUP: 0x06,
  GLOBAL_GET: 0x07,
  GLOBAL_SET: 0x08,
  ADD: 0x10,
  SUB: 0x11,
  MUL: 0x12,
  DIV: 0x13,
  NEGATE: 0x14,
  NOT: 0x15,
  LT: 0x20,
  LTE: 0x21,
  GT: 0x22,
  GTE: 0x23,
  EQ: 0x24,
  NEQ: 0x25,
  JUMP: 0x30,
  JUMP_IF_FALSE: 0x31,
  CALL_NATIVE: 0x40,
  RETURN: 0x50,
  HALT: 0xff,
});

export function encodeUint16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

export function decodeUint16(high, low) {
  return ((high & 0xff) << 8) | (low & 0xff);
}
