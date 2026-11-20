import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = await mkdtemp(join(tmpdir(), "xenora-postgres-"));
const pg = new EmbeddedPostgres({
  databaseDir: join(root, "data"),
  user: "postgres",
  password: "local-test",
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: [
    "-c",
    "listen_addresses=",
    "-c",
    "unix_socket_directories=" + root,
  ],
  onLog: () => {},
  onError: (msg) => {
    if (/FATAL|PANIC/.test(msg)) console.error(msg);
  },
});
const clients = [];
export async function main(check) {
  try {
    await pg.initialise();
    await pg.start();
    const connect = async () => {
      const c = pg.getPgClient("postgres", root);
      await c.connect();
      clients.push(c);
      return c;
    };
    const admin = await connect();
    console.log((await admin.query("select version() as v")).rows[0].v);
    await admin.query(
      "create role anon; create role authenticated; create role service_role bypassrls;",
    );
    const lab = new URL("../../", import.meta.url);
    const schema = async (name) =>
      admin.query(await readFile(new URL(name, lab), "utf8"));
    await schema("schema-supabase.sql");
    await admin.query(
      "insert into xenora_private.gateway_secret(token_hash) values(sha256(convert_to(repeat('a',64),'UTF8')))",
    );
    await check({ admin, connect, schema });
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()));
    await pg.stop();
    await rm(root, { recursive: true, force: true });
  }
}
