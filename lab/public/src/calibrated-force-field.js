// Gas-phase local force fields for two neutral, fully connected topologies.
// Energy in eV, distance in nm, angles in radians. The generic dissociation
// energy sets the Morse well depth. Only equilibrium and small oscillations
// are fitted, not dissociation thresholds or chemistry in liquid water.
import { ATOMIC_ELEMENTS } from './atomic-elements.js';

// Fit sources: Huber & Herzberg (NIST WebBook, H2), Császár et al. (2005,
// doi:10.1063/1.1924506, H2O geometry), and NIST CCCBDB experimental
// H2O harmonic bands (https://cccbdb.nist.gov/exp2x.asp?casno=7732185).
const C_CM_FS = 2.99792458e-5;
const U_NM2_FS2_IN_EV = 1.66053906660e-27 * 1e12 / 1.602176634e-19;
const spectralToMassWeightedK = cm1 => U_NM2_FS2_IN_EV * (2 * Math.PI * C_CM_FS * cm1) ** 2;

const h = ATOMIC_ELEMENTS.H.massU;
const o = ATOMIC_ELEMENTS.O.massU;
const h2K = (h / 2) * spectralToMassWeightedK(4401.213);

// Wilson's mass metric for symmetric stretch q=(r1+r2)/sqrt(2), asymmetric
// stretch (r1-r2)/sqrt(2) and bend theta at the equilibrium geometry.
// The potential has two independent curvatures. Fit the uncoupled asymmetric
// stretch (3943 cm^-1), then the bending eigenvalue of the symmetric 2x2 block
// (1649 cm^-1). Its remaining stretch frequency is an independent prediction.
const waterR = .095777;
const waterAngleDeg = 104.48;
const waterAngle = waterAngleDeg * Math.PI / 180;
const cos0 = Math.cos(waterAngle);
const sin0 = Math.sin(waterAngle);
const gSym = 1 / h + (1 + cos0) / o;
const gAsym = 1 / h + (1 - cos0) / o;
const gBend = 2 * gAsym / (waterR * waterR);
const gCross = -Math.SQRT2 * sin0 / (o * waterR);
const waterK = spectralToMassWeightedK(3943) / gAsym;
const bendEigenvalue = spectralToMassWeightedK(1649);
const remainder = gSym * waterK - bendEigenvalue;
const bendK = bendEigenvalue * remainder / (gBend * remainder - waterK * gCross * gCross);

export const CALIBRATED_MOLECULES = Object.freeze({
  H2: Object.freeze({ rEqNm: .074144, stretchEvPerNm2: h2K, fitHarmonicCm1: 4401.213 }),
  H2O: Object.freeze({ rEqNm: waterR, angleEqDeg: waterAngleDeg, stretchEvPerNm2: waterK,
    bendEvPerRad2: bendK, fitBendHarmonicCm1: 1649, fitAntisymmetricHarmonicCm1: 3943 })
});

export function calibratedBondLaw(formula, distanceNm, baseEnergyEv) {
  const { rEqNm, stretchEvPerNm2 } = CALIBRATED_MOLECULES[formula];
  const alpha = Math.sqrt(stretchEvPerNm2 / (2 * baseEnergyEv));
  const exponentialMinusOne = Math.expm1(-alpha * (distanceNm - rEqNm));
  return [
    baseEnergyEv * (exponentialMinusOne ** 2 - 1),
    -2 * baseEnergyEv * alpha * (exponentialMinusOne + 1) * exponentialMinusOne
  ];
}

export function waterBend(u, v) {
  // Softening 1e-9 nm only regularizes the undefined direction at coincident
  // points. The derivative below uses the identical softened norm.
  const ru = Math.hypot(...u, 1e-9), rv = Math.hypot(...v, 1e-9);
  const unitU = u.map(value => value / ru), unitV = v.map(value => value / rv);
  const cosine = unitU.reduce((value, x, i) => value + x * unitV[i], 0);
  const displacement = cosine - cos0;
  const gradient = bendK * displacement / (sin0 * sin0);
  return {
    energyEv: .5 * gradient * displacement,
    forceH1: unitV.map((x, i) => -gradient * (x - cosine * unitU[i]) / ru),
    forceH2: unitU.map((x, i) => -gradient * (x - cosine * unitV[i]) / rv)
  };
}
