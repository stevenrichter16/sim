import { describe, it, expect } from 'vitest';
import { lex } from '../src/script/lexer.js';
import { parseTokens } from '../src/script/parser.js';
import { compileProgram } from '../src/script/compiler.js';
import { createScenarioRuntime } from '../src/script/runtime.js';

describe('Script pipeline walkthrough', () => {
  it('lexes, parses, compiles, and executes a sample script', () => {
    const source = `
      let counter = 0;

      fn onInit(seed) {
        counter = seed;
        call log(counter);
      }

      fn onTick(frame, dt) {
        counter = counter + 1;
        call log(counter);
      }
    `;

    const { tokens, diagnostics: lexDiagnostics } = lex(source);
    expect(lexDiagnostics).toEqual([]);
    expect(tokens.length).toBeGreaterThan(0);

    const { ast, diagnostics: parseDiagnostics } = parseTokens(tokens);
    expect(parseDiagnostics).toEqual([]);
    expect(ast.type).toBe('Program');

    const compiled = compileProgram(ast);
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.entryPoints.onInit).toBeDefined();
    expect(compiled.entryPoints.onTick).toBeDefined();

    const logs = [];
    const runtime = createScenarioRuntime({
      compiled,
      natives: {
        log: ({ args }) => {
          logs.push(args[0]);
          return { ok: true, value: null };
        },
      },
    });

    const initResult = runtime.runInit(7);
    expect(initResult.status).toBe('ok');
    const tickResult = runtime.tick(0, 0.16);
    expect(tickResult.status).toBe('ok');

    expect(logs).toEqual([7, 8]);
  });
});
