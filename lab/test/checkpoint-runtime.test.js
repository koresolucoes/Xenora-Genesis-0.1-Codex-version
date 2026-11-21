import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const workerd = wranglerRequire("workerd");

test("workerd saves and reads checkpoints and refuses an upstream redirect", async t => {
  const dir = await mkdtemp(join(tmpdir(), "xenora-checkpoints-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await build({
    entryPoints: [fileURLToPath(new URL("../worker.js", import.meta.url))],
    bundle: true, format: "esm", platform: "browser", target: "es2022",
    outfile: join(dir, "app.mjs")
  });
  await copyFile(new URL("./fixtures/checkpoint-rpc.mjs", import.meta.url), join(dir, "test.mjs"));
  const config = `using Workerd = import "/workerd/workerd.capnp";
    const config :Workerd.Config = (services = [
      (name = "app", worker = (
        compatibilityDate = "${workerd.compatibilityDate}", globalOutbound = "checks",
        modules = [(name = "app.mjs", esModule = embed "app.mjs")],
        bindings = [(name = "SUPABASE_URL", text = "https://rpc.invalid"),
          (name = "SUPABASE_PUBLISHABLE_KEY", text = "test-publishable"),
          (name = "XENORA_GATEWAY_TOKEN", text = "${"a".repeat(64)}")])),
      (name = "checks", worker = (
        compatibilityDate = "${workerd.compatibilityDate}",
        modules = [(name = "test.mjs", esModule = embed "test.mjs")],
        bindings = [(name = "APP", service = "app")]))
    ]);`;
  const path = join(dir, "test.capnp");
  await writeFile(path, config);
  await run(workerd.default, ["test", path], { timeout: 15000 });
});
