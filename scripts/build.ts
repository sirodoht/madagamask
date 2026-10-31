import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";

const development = process.argv.includes("--development");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));

// Preserve full notices for the installed runtime dependency tree, including
// dependencies currently removed by tree shaking or not yet imported.
let notices = "Madagamask runtime dependency notices\n\n";
const runtimePaths = new Set<string>();
function collectDependencies(
  parent: string,
  dependencies: Record<string, string>,
) {
  for (const name of Object.keys(dependencies)) {
    let base = parent;
    let path = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    while (!lock.packages[path] && base) {
      const index = base.lastIndexOf("/node_modules/");
      base = index < 0 ? "" : base.slice(0, index);
      path = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    }
    if (!lock.packages[path]) throw new Error(`Missing dependency: ${name}`);
    if (runtimePaths.has(path)) continue;
    runtimePaths.add(path);
    collectDependencies(path, lock.packages[path].dependencies ?? {});
  }
}
collectDependencies("", pkg.dependencies);
for (const path of [...runtimePaths].sort()) {
  const info = lock.packages[path];
  const dependency = JSON.parse(
    await readFile(join(path, "package.json"), "utf8"),
  );
  const licenses = (await readdir(path))
    .filter((name) => /^(licen[cs]e|notice)(\.|$|-)/i.test(name))
    .sort();
  if (licenses.length === 0) throw new Error(`Missing license for ${path}`);
  notices += `--- ${dependency.name}@${info.version} (${dependency.license}) ---\n\n`;
  for (const license of licenses)
    notices += `${await readFile(join(path, license), "utf8")}\n\n`;
}

for (const browser of ["chrome", "firefox"] as const) {
  const outdir = join("dist", browser);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const manifest = JSON.parse(
    await readFile(`manifests/${browser}.json`, "utf8"),
  );
  if (manifest.version !== pkg.version)
    throw new Error(`Version mismatch in ${browser} manifest`);
  await writeFile(
    join(outdir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await copyFile("src/ui/popup.html", join(outdir, "popup.html"));
  await copyFile("LICENSE", join(outdir, "LICENSE"));
  await copyFile("data/phishing.json.gz", join(outdir, "phishing.json.gz"));
  await copyFile("data/phishing-meta.json", join(outdir, "phishing-meta.json"));
  await copyFile(
    "licenses/phishdestroy.txt",
    join(outdir, "PHISHING_LICENSE.txt"),
  );
  await writeFile(join(outdir, "THIRD_PARTY_NOTICES.txt"), notices);
  if (browser === "firefox") {
    await writeFile(
      join(outdir, "VALIDATION.txt"),
      "Firefox package is unsigned. Runtime and UI checks use temporary add-on installs.\n",
    );
  }
  const result = await build({
    entryPoints: [
      { out: "background", in: "src/browser/background.ts" },
      { out: "content", in: "src/browser/content.ts" },
      { out: "provider", in: "src/browser/provider.ts" },
      { out: "popup", in: "src/ui/popup.ts" },
      { out: "popup", in: "src/ui/popup.css" },
    ],
    outdir,
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2023",
    minify: !development,
    sourcemap: development ? "linked" : false,
    legalComments: "eof",
    define: { BROWSER_TARGET: JSON.stringify(browser) },
    metafile: true,
    logLevel: "info",
  });
  const qr = await build({
    entryPoints: ["src/ui/qr.ts"],
    outfile: join(outdir, "qr.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2023",
    minify: !development,
    sourcemap: development ? "linked" : false,
    legalComments: "eof",
    metafile: true,
    logLevel: "info",
  });
  Object.assign(result.metafile.inputs, qr.metafile.inputs);
  Object.assign(result.metafile.outputs, qr.metafile.outputs);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    `artifacts/${browser}-build.json`,
    `${JSON.stringify(result.metafile, null, 2)}\n`,
  );
}
