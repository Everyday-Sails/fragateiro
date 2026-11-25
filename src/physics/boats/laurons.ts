import type { BoatSpec } from '../types';

// A Roman merchant ship of the Laurons 2 type (the wreck of Anse des Laurons, near Marseille),
// sized as the University of Trier's full-size reconstruction "Bissula": just under 16 m long,
// a little over 5 m in beam, about 100 m² of square sail on one mast, two steering oars on the
// quarters, up to 30 t of cargo. Our own simplified model (scripts/boats/laurons.mjs); the
// areas and centres below come from it, the rest are estimates (the Trier project measures
// these ships' real performance: tune with `npm run polar` when its figures are published).

const mass = 20000; // kg, with about half a cargo
const lwl = 14.6;

export const LAURONS: BoatSpec = {
  id: 'laurons',
  name: 'Navis oneraria',
  description: 'A Roman merchant ship: a full, round hull, one big square sail and two steering oars on the quarters.',
  home: 'delos',
  era: 'ancient',
  length: 15.8,
  beam: 5.1,
  draft: 0.91,
  mass,
  gm: 1.3, // a beamy hull with its cargo low in the hold
  rollPeriod: 4.5,
  hull: {
    waterlineLength: lwl,
    wettedArea: 2.6 * Math.sqrt((mass / 1025) * lwl),
    cf: 0.005,
    waveCoef: 0.045, // a full hull makes waves
    lateralArea: 13.1,
    lateralCentre: -0.7,
    liftSlope: 2.4,
    stallDeg: 22,
    windageArea: 12, // high bow and stern
  },
  // Two oars of about 0.9 m² each; the one to leeward bites best: counted as 1.4 m².
  rudder: { area: 1.4, x: -7, liftSlope: 3, stallDeg: 25, maxAngleDeg: 35 },
  sails: [
    // A square sail turns about the mast; its yard cannot be braced closer than about 35°.
    { id: 'main', name: 'Square sail', group: 'main', area: 100, pivot: [1.7, 0], ceDistance: 0, ceHeight: 7.4, minAngle: 35, maxAngle: 90, efficiency: 0.75 },
  ],
  modes: [{ id: 'sailing', name: 'Sailing', description: 'Square sail set.', sails: ['main'] }],
};
