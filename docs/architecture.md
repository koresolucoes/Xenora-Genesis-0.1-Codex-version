# ADR-001 — Simulation-first cloud architecture

Status: Proposed (2026-11-20).

## Scientific baseline

The first stage is a Rust deterministic **toy** finite-volume reaction-diffusion solver, not a chemistry-validated abiogenesis experiment. Grid 32×32×16, spacing 1 m, zero-flux boundaries, mol/m³ concentrations, no advection, fixed isothermal coefficients. A+B→C uses mass-action with explicit Euler; each step injects 0.01 mol of A and B into one source cell. Expected conserved totals are A+C and B+C **after including external inputs**.

Diffusion positivity limit: `dt * D_max * 2 * active_dimensions / dx² <= 1`. Reaction stability is checked against negative concentrations; large time steps fail fast rather than silently inventing mass. Future chemistry must verify elemental composition and charge, support energy budgets and stable integrators.

## Cloud plan

Deploy the scientific engine as a dedicated container with no public ingress only **after CI passes**. Add versioned checkpoints, object storage and PostgreSQL run metadata before running long-lived experiments. An authenticated Axum API will queue commands and stream read-only telemetry; React/Three.js will visualize spatial fields. UI and AI cannot edit internal physical state except through versioned experiment commands.

No cloud infrastructure has been provisioned or paid for. Decisions and rollout tracked in GitHub issues #1–#6.
