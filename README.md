# Xenora Genesis 0.1

Experimental extraterrestrial prebiotic reaction–diffusion simulator in Rust. **This is not a validated abiogenesis model.**

## Laboratório interativo

O [Xenora · Lagoa](lab/README.md) simula organismos digitais em uma lagoa 2D com regras próprias de movimento, alimentação e reprodução. Para abrir no navegador, execute `python3 -m http.server 8000 --bind 127.0.0.1 --directory lab/public` na raiz do repositório e acesse `http://localhost:8000`. O laboratório usa seu próprio motor JavaScript, independente do experimento Rust descrito abaixo.

## Local execution

```bash
cargo test --workspace
cargo run --release -p xenora-simulation-core > results.csv
# Docker alternative
docker compose run --build --rm genesis > results.csv
```

The CSV reports total moles of A, B and C and conserved atom-equivalent totals (A+C and B+C). The hydrothermal source injects **0.01 mol each of A and B per step** so this is an *open system*. Mass changes must match integrated external inputs.

## Initial model

- 32×32×16 cubic cells, `dx=1 m`, zero-flux boundaries.
- Explicit finite-volume, six-neighbor diffusion, no advection.
- Isothermal toy mass-action reaction `A+B→C` and sequential splitting.
- `dt=0.25 s` for 200 steps.
- Four unit tests; GitHub Actions runs fmt, clippy, tests and simulation.

**Limitations:** no realistic hydrothermal thermodynamics, validated chemical networks, protocells, abiogenesis, cloud checkpoints, API, WebGL or dedicated running worker yet. Reaction stoichiometry is manually configured and not chemically validated. Runs are not guaranteed bitwise-identical across platforms.

## Project tracking

- [GEN-001: baseline engine](../../issues/1)
- [GEN-002: chemistry and thermodynamics](../../issues/2)
- [GEN-003: cloud worker and persistence](../../issues/3)
- [GEN-004: API and observability](../../issues/4)
- [GEN-005: 3D laboratory](../../issues/5)
- [GEN-006: autocatalysis](../../issues/6)

See `docs/architecture.md` for the engineering and numerical contract. CI has not yet been independently confirmed green.
