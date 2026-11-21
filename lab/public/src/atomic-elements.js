export const ATOMIC_SOURCES = Object.freeze({
  mass: 'https://physics.nist.gov/cgi-bin/Compositions/stand_alone.pl',
  radius: 'https://doi.org/10.1039/B801115J',
  quarks: 'https://alice.web.cern.ch/physics-primer',
  bonds: 'https://openstax.org/books/chemistry-2e/pages/7-5-strengths-of-ionic-and-covalent-bonds'
});

// The isotope masses are for neutral atoms (NIST). The selected covalent radii
// come from Cordero et al., Table 2, using the sp3 reference for carbon.
function element(symbol, name, atomicNumber, massNumber, massU, covalentRadiusPm, valenceElectrons, maxValence) {
  const neutrons = massNumber - atomicNumber;
  return Object.freeze({
    symbol, name, atomicNumber, massNumber, massU, covalentRadiusPm, valenceElectrons, maxValence,
    protons: atomicNumber, neutrons, electrons: atomicNumber,
    // Net valence-quark counts in this nucleus, including all its nucleons.
    upQuarks: 2 * atomicNumber + neutrons,
    downQuarks: atomicNumber + 2 * neutrons,
    // Geometric reference sphere. A packing or sample volume must be measured separately.
    volumePm3: 4 * Math.PI / 3 * covalentRadiusPm ** 3
  });
}

// The last column limits the sum of incident bond orders in the neutral model.
// P(III) and divalent S are supported. Charged and hypervalent bonding need a different model.
export const ATOMIC_ELEMENTS = Object.freeze({
  H: element('H', 'Hidrogênio', 1, 1, 1.00782503223, 31, 1, 1),
  C: element('C', 'Carbono', 6, 12, 12, 76, 4, 4),
  N: element('N', 'Nitrogênio', 7, 14, 14.00307400443, 71, 5, 3),
  O: element('O', 'Oxigênio', 8, 16, 15.99491461957, 66, 6, 2),
  P: element('P', 'Fósforo', 15, 31, 30.97376199842, 107, 5, 3),
  S: element('S', 'Enxofre', 16, 32, 31.9720711744, 105, 6, 2)
});

export const ATOMIC_SYMBOLS = Object.freeze(Object.keys(ATOMIC_ELEMENTS));

// OpenStax Chemistry 2e, table 7.2. Mean gas-phase bond dissociation energies in
// kJ/mol, ordered single, double, triple. Each value is the TOTAL for that order.
// S–O and S–N single bonds have no entry in this table. Their absence excludes
// them from this simulation. C≡O would need a charged Lewis description.
const bondEnergies = {
  HH: [436],
  CH: [415], HN: [390], HO: [464], HP: [320], HS: [340],
  CC: [345, 611, 837], CN: [290, 615, 891], CO: [350, 741], CP: [265], CS: [260],
  NN: [160, 418, 946], NO: [200], NP: [210],
  OO: [140, 498], OP: [350],
  PP: [215], PS: [230], SS: [215]
};

// Exact SI elementary charge (J/eV) and Avogadro constant (mol^-1).
const kjPerMolPerEv = 1.602176634e-19 * 6.02214076e23 / 1000;

function energiesFor(a, b) {
  if (!Object.hasOwn(ATOMIC_ELEMENTS, a) || !Object.hasOwn(ATOMIC_ELEMENTS, b)) return undefined;
  return bondEnergies[a < b ? a + b : b + a];
}

export function maxBondOrder(a, b) {
  return energiesFor(a, b)?.length ?? 0;
}

// Zero indicates a pair or order outside the supported table.
export function bondEnergyKJMol(a, b, order = 1) {
  if (!Number.isInteger(order) || order < 1) return 0;
  return energiesFor(a, b)?.[order - 1] ?? 0;
}

export function bondEnergyEv(a, b, order = 1) {
  return bondEnergyKJMol(a, b, order) / kjPerMolPerEv;
}
