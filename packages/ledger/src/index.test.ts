import { describe, expect, it } from 'vitest';
import { LEDGER_PACKAGE } from './index';

describe('@contave/ledger', () => {
  it('expone el identificador del paquete', () => {
    expect(LEDGER_PACKAGE).toBe('@contave/ledger');
  });
});
