import { describe, expect, it } from 'vitest';
import { helloZecaSchema } from '../src/remotion/HelloZeca';

describe('HelloZeca', () => {
  it('valida as props da composição', () => {
    expect(
      helloZecaSchema.parse({ channelName: 'Radar Neon', characterName: 'Zeca Neon' }),
    ).toBeTruthy();
    expect(() => helloZecaSchema.parse({ channelName: 1 })).toThrow();
  });
});
