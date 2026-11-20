//! Finite-volume isothermal reaction-diffusion teaching model.
//! Concentrations: mol/m³, time: seconds, grid length: meters.

#[derive(Clone, Debug)]
pub struct Reaction {
    /// Signed stoichiometric coefficients (products positive).
    pub stoich: Vec<f64>,
    /// Exponents used for mass-action kinetics.
    pub orders: Vec<f64>,
    pub rate_constant: f64,
}

#[derive(Clone, Debug)]
pub struct Grid {
    pub dims: [usize; 3],
    pub dx: f64,
    pub species: usize,
    pub concentrations: Vec<f64>,
}

impl Grid {
    pub fn new(dims: [usize; 3], dx: f64, species: usize) -> Self {
        assert!(dims.iter().all(|&n| n > 0) && dx.is_finite() && dx > 0.0 && species > 0);
        Self {
            dims,
            dx,
            species,
            concentrations: vec![0.0; dims.iter().product::<usize>() * species],
        }
    }

    pub fn index(&self, x: usize, y: usize, z: usize, s: usize) -> usize {
        assert!(x < self.dims[0] && y < self.dims[1] && z < self.dims[2] && s < self.species);
        (((z * self.dims[1] + y) * self.dims[0] + x) * self.species) + s
    }

    pub fn total_moles(&self, s: usize) -> f64 {
        assert!(s < self.species);
        self.concentrations
            .chunks_exact(self.species)
            .map(|c| c[s])
            .sum::<f64>() * self.dx.powi(3)
    }

    /// Explicit 6-neighbor diffusion; no flux across the domain boundary.
    pub fn diffuse(&mut self, diffusion: &[f64], dt: f64) {
        assert_eq!(diffusion.len(), self.species);
        assert!(dt.is_finite() && dt > 0.0);
        assert!(diffusion.iter().all(|d| d.is_finite() && *d >= 0.0));

        let active = self.dims.iter().filter(|&&n| n > 1).count();
        let dmax = diffusion.iter().copied().fold(0.0, f64::max);
        assert!(
            active == 0 || dt * dmax * (2 * active) as f64 / self.dx.powi(2) <= 1.0,
            "diffusion time step violates positivity bound"
        );

        let old = self.concentrations.clone();
        let [nx, ny, nz] = self.dims;
        for z in 0..nz {
            for y in 0..ny {
                for x in 0..nx {
                    for (s, &d) in diffusion.iter().enumerate() {
                        let i = self.index(x, y, z, s);
                        let mut delta = 0.0;
                        if x > 0 { delta += old[self.index(x - 1, y, z, s)] - old[i]; }
                        if x + 1 < nx { delta += old[self.index(x + 1, y, z, s)] - old[i]; }
                        if y > 0 { delta += old[self.index(x, y - 1, z, s)] - old[i]; }
                        if y + 1 < ny { delta += old[self.index(x, y + 1, z, s)] - old[i]; }
                        if z > 0 { delta += old[self.index(x, y, z - 1, s)] - old[i]; }
                        if z + 1 < nz { delta += old[self.index(x, y, z + 1, s)] - old[i]; }
                        self.concentrations[i] = old[i] + dt * d * delta / self.dx.powi(2);
                    }
                }
            }
        }
    }

    /// Explicit Euler for toy mass-action kinetics; rejects negative states.
    pub fn react(&mut self, reactions: &[Reaction], dt: f64) {
        assert!(dt.is_finite() && dt > 0.0);
        for r in reactions {
            assert_eq!(r.stoich.len(), self.species);
            assert_eq!(r.orders.len(), self.species);
            assert!(r.rate_constant.is_finite() && r.rate_constant >= 0.0);
            assert!(r.stoich.iter().all(|v| v.is_finite()));
            assert!(r.orders.iter().all(|v| v.is_finite() && *v >= 0.0));
        }
        for cell in self.concentrations.chunks_exact_mut(self.species) {
            let mut change = vec![0.0; self.species];
            for r in reactions {
                let rate = r.orders.iter().enumerate().fold(r.rate_constant, |acc, (i, order)| {
                    acc * cell[i].powf(*order)
                });
                for (i, coeff) in r.stoich.iter().enumerate() {
                    change[i] += coeff * rate * dt;
                }
            }
            for i in 0..self.species {
                let next = cell[i] + change[i];
                assert!(next.is_finite() && next >= -1e-12, "reaction step too large or invalid");
                cell[i] = next.max(0.0);
            }
        }
    }

    /// Inject an external molar quantity into one spatial cell.
    pub fn inject_moles(&mut self, xyz: [usize; 3], species: usize, moles: f64) {
        assert!(moles.is_finite() && moles >= 0.0);
        let i = self.index(xyz[0], xyz[1], xyz[2], species);
        self.concentrations[i] += moles / self.dx.powi(3);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diffusion_conserves_moles_and_nonnegative() {
        let mut g = Grid::new([8, 8, 4], 1.0, 1);
        g.inject_moles([4, 4, 2], 0, 10.0);
        for _ in 0..100 { g.diffuse(&[0.1], 0.5); }
        assert!((g.total_moles(0) - 10.0).abs() < 1e-9);
        assert!(g.concentrations.iter().all(|&c| c >= 0.0));
    }

    #[test]
    fn reaction_conserves_atoms_in_balanced_network() {
        let mut g = Grid::new([1, 1, 1], 1.0, 3);
        g.concentrations = vec![2.0, 3.0, 0.0];
        let r = Reaction {
            stoich: vec![-1.0, -1.0, 1.0],
            orders: vec![1.0, 1.0, 0.0],
            rate_constant: 0.1,
        };
        let a_before = g.total_moles(0) + g.total_moles(2);
        let b_before = g.total_moles(1) + g.total_moles(2);
        for _ in 0..100 { g.react(&[r.clone()], 0.01); }
        assert!((g.total_moles(0) + g.total_moles(2) - a_before).abs() < 1e-10);
        assert!((g.total_moles(1) + g.total_moles(2) - b_before).abs() < 1e-10);
    }

    #[test]
    #[should_panic(expected = "diffusion time step")]
    fn rejects_unstable_diffusion_step() {
        let mut g = Grid::new([4, 4, 4], 1.0, 1);
        g.diffuse(&[1.0], 1.0);
    }

    #[test]
    fn source_accounting() {
        let mut g = Grid::new([2, 2, 2], 0.5, 1);
        g.inject_moles([0, 0, 0], 0, 2.5);
        assert!((g.total_moles(0) - 2.5).abs() < 1e-12);
    }
}
