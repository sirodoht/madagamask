import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const server = createServer(async (request, response) => {
  const file =
    request.url === "/"
      ? "index.html"
      : request.url === "/app.js"
        ? "app.js"
        : undefined;
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader(
    "Content-Type",
    file.endsWith("js") ? "text/javascript" : "text/html",
  );
  response.end(await readFile(`test-dapp/${file}`));
});
server.listen(4173, "127.0.0.1", () =>
  console.log("Test dapp: http://127.0.0.1:4173"),
);
