import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { test } from "node:test";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
for (const browser of ["chrome", "firefox"]) {
  test(`${browser} package has local assets, restrictive permissions, and required notices`, async () => {
    const directory = `dist/${browser}`;
    const manifest = JSON.parse(
      await readFile(`${directory}/manifest.json`, "utf8"),
    );
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, pkg.version);
    assert.deepEqual(manifest.permissions, ["storage"]);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.web_accessible_resources, undefined);
    assert.equal(manifest.externally_connectable, undefined);
    const assets = [
      manifest.action.default_popup,
      ...manifest.content_scripts.flatMap(
        (script: { js: string[] }) => script.js,
      ),
    ];
    if (browser === "chrome") {
      assert.equal(manifest.background.scripts, undefined);
      assets.push(manifest.background.service_worker);
    } else {
      assert.equal(manifest.background.service_worker, undefined);
      assets.push(...manifest.background.scripts);
      assert.match(
        await readFile(`${directory}/VALIDATION.txt`, "utf8"),
        /untested/,
      );
    }
    const html = await readFile(`${directory}/popup.html`, "utf8");
    assets.push(
      ...[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]),
    );
    assets.push("LICENSE", "THIRD_PARTY_NOTICES.txt");
    for (const asset of assets) {
      assert.match(asset, /^[a-zA-Z0-9_.-]+$/);
      assert.ok((await stat(`${directory}/${asset}`)).size > 0, asset);
    }
    const files = await readdir(directory);
    assert.equal(
      files.some((file) => file.endsWith(".map") || file.endsWith(".ts")),
      false,
    );
    assert.match(
      await readFile(`${directory}/THIRD_PARTY_NOTICES.txt`, "utf8"),
      /viem@2\.57\.13/,
    );
    assert.match(
      manifest.content_security_policy.extension_pages,
      /default-src 'none'/,
    );
    for (const script of html.matchAll(
      /<script\b[^>]*>([\s\S]*?)<\/script>/g,
    )) {
      assert.equal(script[1]?.trim(), "", "Inline scripts are forbidden");
    }
  });
}
