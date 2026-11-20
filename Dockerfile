FROM rust:1-bookworm AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY crates ./crates
RUN cargo build --release
FROM debian:bookworm-slim
RUN useradd -r -u 10001 xenora
COPY --from=builder /app/target/release/xenora-genesis /usr/local/bin/xenora-genesis
USER xenora
ENTRYPOINT ["/usr/local/bin/xenora-genesis"]
