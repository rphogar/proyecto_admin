import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE } from './index';

describe('@contave/shared', () => {
  it('expone el identificador del paquete', () => {
    expect(SHARED_PACKAGE).toBe('@contave/shared');
  });
});
