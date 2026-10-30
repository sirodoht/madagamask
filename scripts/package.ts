import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
await mkdir("artifacts", { recursive: true });
const checksums: string[] = [];
for (const browser of ["chrome", "firefox"]) {
  const directory = resolve("dist", browser);
  const files = (await readdir(directory)).sort();
  // Fixed modes, mtimes, order, and no extra ZIP attributes make archives repeatable.
  for (const file of files) {
    await chmod(resolve(directory, file), 0o644);
    await utimes(resolve(directory, file), 315532800, 315532800);
  }
  const name = `madagamask-${version}-${browser}${browser === "firefox" ? "-untested" : ""}.zip`;
  const archive = resolve("artifacts", name);
  await rm(archive, { force: true });
  execFileSync("zip", ["-X", "-q", archive, ...files], {
    cwd: directory,
    env: { ...process.env, TZ: "UTC" },
  });
  const hash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  checksums.push(`${hash}  ${name}`);
  console.log(name);
}
await writeFile("artifacts/SHA256SUMS", `${checksums.join("\n")}\n`);
