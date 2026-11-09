import { Composition } from 'remotion';
import { HelloZeca, helloZecaSchema } from './HelloZeca';

const defaults = { channelName: 'Radar Neon', characterName: 'Zeca Neon' };

export function Root() {
  return (
    <>
      <Composition
        id="HelloZeca"
        component={HelloZeca}
        schema={helloZecaSchema}
        defaultProps={defaults}
        durationInFrames={90}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="HelloZecaVertical"
        component={HelloZeca}
        schema={helloZecaSchema}
        defaultProps={defaults}
        durationInFrames={90}
        fps={30}
        width={720}
        height={1280}
      />
    </>
  );
}
