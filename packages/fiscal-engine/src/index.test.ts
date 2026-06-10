import { describe, expect, it } from 'vitest';
import { FISCAL_ENGINE_PACKAGE } from './index';

describe('@contave/fiscal-engine', () => {
  it('expone el identificador del paquete', () => {
    expect(FISCAL_ENGINE_PACKAGE).toBe('@contave/fiscal-engine');
  });
});
