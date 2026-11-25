// A Roman merchant ship of the Laurons 2 type (the wreck of Anse des Laurons, near Marseille,
// late 2nd to 3rd century AD), as sailed by the University of Trier's full-size reconstruction
// "Bissula": just under 16 m long, a little over 5 m in beam, about 100 m² of square sail on a
// single mast, steered by two oars on the quarters; up to 30 t of cargo. The game's ship for
// Delos, our own simplified model (no plans copied: the shape is generic).
//   node scripts/generate-boat.mjs scripts/boats/laurons.mjs src/assets/models/laurons.glb
//
// s = metres aft of the bow, y = metres above the waterline, z = metres to port.

export default {
  name: 'laurons',
  length: 15.8,
  beam: 5.1,
  mass: 20000, // kg: the hull and its gear with about half a cargo

  hull: {
    // A full, round hull; the stem rises in a curve, the stern higher still (where the
    // sternpost curls up in a goose's neck on Roman ships).
    sheer: { mid: 1.7, lowAt: 0.5, bowRise: 1.0, sternRise: 1.5 },
    stemReach: 2.4,
    drag: 0.05,
    maxBeamAt: 0.5,
    planFullness: 0.62,
    bilge: 0.42,
    widestAt: 0.85,
    tumblehome: 0.02,
    planking: 0.05,
    floor: 1.25, // the deck (cargo in the hold below)
    thwarts: [],
    keel: { from: 1.8, depth: 0.15 },
    paint: { bottomTop: 0.06, stripe: 0.04, wale: 0.25 },
    colors: {
      bottom: '#2d2622', // pitch
      topsides: '#8a6a48', // oiled timber
      stripe: '#a3342a', // a red band
      wale: '#4a3424',
      interior: '#7e6044',
      floor: '#6d5238',
      spar: '#5b4128',
      sail: '#e3d7bd', // linen
    },
  },

  // One mast a little forward of amidships.
  masts: [{ id: 'main', s: 6.4, foot: 0.4, top: 12.6, rakeDeg: 0, radius: 0.16 }],

  // The sternpost curling up and forward in a swan's neck (cheniscus), and a short boom over the
  // bow for the foresail's stay (no foresail here).
  spars: [
    { name: 'Cheniscus', from: [15.75, 3.0, 0], to: [16.05, 3.9, 0], radius: 0.14 },
    { name: 'Cheniscus_2', from: [16.05, 3.9, 0], to: [15.85, 4.7, 0], radius: 0.12 },
    { name: 'Cheniscus_3', from: [15.85, 4.7, 0], to: [15.35, 5.0, 0], radius: 0.1 },
    { name: 'Cheniscus_4', from: [15.35, 5.0, 0], to: [15.1, 4.7, 0], radius: 0.08 },
  ],

  // The square sail, 11 m on the yard and 9 m deep (about 100 m²).
  sails: [
    {
      id: 'main',
      type: 'square',
      mast: 'main',
      sailName: 'Vela',
      yardName: 'Verga',
      yardRadius: 0.14,
      s: 6.2,
      head: 11.9,
      foot: 2.9,
      width: 11,
      footWidth: 11.2,
      belly: 0.6,
    },
  ],

  // Two steering oars, one on each quarter: their blades below the water, the looms sloping up
  // and forward to the deck, with a short tiller each pointing inboard.
  rudder: {
    z: 1.75,
    thickness: 0.09,
    pin: { s: 14.7, rake: -0.42 },
    blade: [
      [15.5, -1.15],
      [15.6, -0.35],
      [15.0, 0.25],
      [13.75, 1.9],
      [13.45, 2.35],
    ],
    tiller: { from: [13.4, 2.4, 0], to: [13.3, 2.45, -0.9], radius: 0.05 },
  },
};
