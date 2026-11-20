import assert from 'node:assert/strict';
import test from 'node:test';
import { ATOMIC_ELEMENTS, ATOMIC_SYMBOLS, maxBondOrder, bondEnergyKJMol, bondEnergyEv }
  from '../public/src/atomic-elements.js';

test('neutral isotope inventory conserves nuclei, valence quark counts and electrons', () => {
  assert.deepEqual(ATOMIC_SYMBOLS, ['H', 'C', 'N', 'O', 'P', 'S']);
  const elements = Object.values(ATOMIC_ELEMENTS);
  assert.deepEqual(elements.map(e => e.massNumber), [1, 12, 14, 16, 31, 32]);
  assert.deepEqual(elements.map(e => e.maxValence), [1, 4, 3, 2, 3, 2]);
  assert.deepEqual(elements.map(e => e.covalentRadiusPm), [31, 76, 71, 66, 107, 105]);
  for (const e of elements) {
    assert.equal(e.protons, e.atomicNumber);
    assert.equal(e.electrons, e.protons);
    assert.equal(e.neutrons + e.protons, e.massNumber);
    assert.equal(e.upQuarks + e.downQuarks, 3 * e.massNumber);
    assert.equal(2 * e.upQuarks - e.downQuarks, 3 * e.protons);
    assert.equal(e.volumePm3, (4 * Math.PI / 3) * e.covalentRadiusPm ** 3);
    assert.ok(Object.isFrozen(e));
  }
  const waterMassU = 2 * ATOMIC_ELEMENTS.H.massU + ATOMIC_ELEMENTS.O.massU;
  assert.ok(Math.abs(waterMassU - 18.01056468403) < 1e-10);
});

test('bond energy is the symmetric total for a specified order in kJ/mol or eV per bond', () => {
  assert.equal(bondEnergyKJMol('O', 'H'), 464);
  assert.equal(bondEnergyKJMol('N', 'N', 3), 946);
  assert.ok(Math.abs(bondEnergyEv('H', 'H') - 436 / 96.48533212331) < 1e-11);
  assert.equal(maxBondOrder('O', 'C'), 2);
  let pairs = 0;
  for (const [i, a] of ATOMIC_SYMBOLS.entries()) {
    for (const b of ATOMIC_SYMBOLS.slice(i)) {
      const maxOrder = maxBondOrder(a, b);
      if (maxOrder > 0) pairs++;
      assert.equal(maxOrder, maxBondOrder(b, a));
      assert.ok(maxOrder <= Math.min(ATOMIC_ELEMENTS[a].maxValence, ATOMIC_ELEMENTS[b].maxValence));
      for (let order = 1; order <= maxOrder; order++) {
        const energy = bondEnergyEv(a, b, order);
        assert.ok(energy > bondEnergyEv(a, b, order - 1));
        assert.equal(energy, bondEnergyEv(b, a, order));
      }
      assert.equal(bondEnergyEv(a, b, maxOrder + 1), 0);
    }
  }
  assert.equal(pairs, 19);
  assert.equal(bondEnergyEv('N', 'S'), 0);
  assert.equal(bondEnergyEv('S', 'O'), 0);
  assert.equal(maxBondOrder('unlisted', 'C'), 0);
});
