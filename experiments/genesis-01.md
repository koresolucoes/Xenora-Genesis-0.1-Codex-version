# Genesis-01 — Isothermal reaction-diffusion baseline

Purpose: verify conserved quantities and reproducibility of numerical toy kinetics before introducing abiogenesis hypotheses.

- Grid: 32×32×16, 1 m cubes
- Species: A, B, C; reaction: A+B→C; k=0.005
- Explicit source: 0.01 mol A + 0.01 mol B per step at [16,16,0]
- Diffusion coefficients: A=0.1, B=0.1, C=0.05 m²/s
- dt=0.25 s; steps=200; zero-flux boundaries
- Observable output: CSV every 10 steps

Acceptance: all concentrations finite and nonnegative; A+C and B+C totals reflect precisely cumulative external additions up to numerical tolerance; CI builds and tests. This is not a scientifically calibrated prebiotic chemistry result.
