use std::io::{self, Write};
use xenora_core::{Grid, Reaction};

fn main() -> io::Result<()> {
    let mut grid = Grid::new([32, 32, 16], 1.0, 3);
    // Isothermal toy model, not a calibrated abiogenesis reaction.
    let reaction = Reaction {
        stoich: vec![-1.0, -1.0, 1.0],
        orders: vec![1.0, 1.0, 0.0],
        rate_constant: 0.005,
    };
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    writeln!(out, "step,time_s,A_mol,B_mol,C_mol,A_atoms_mol,B_atoms_mol")?;
    for step in 0..=200 {
        if step % 10 == 0 {
            let a = grid.total_moles(0);
            let b = grid.total_moles(1);
            let c = grid.total_moles(2);
            writeln!(
                out,
                "{step},{:.3},{a:.9},{b:.9},{c:.9},{:.9},{:.9}",
                step as f64 * 0.25,
                a + c,
                b + c
            )?;
        }
        if step == 200 { break; }
        grid.inject_moles([16, 16, 0], 0, 0.01);
        grid.inject_moles([16, 16, 0], 1, 0.01);
        grid.diffuse(&[0.1, 0.1, 0.05], 0.25);
        grid.react(&[reaction.clone()], 0.25);
    }
    out.flush()
}
