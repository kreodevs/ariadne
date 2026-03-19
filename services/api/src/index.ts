import express from "express";
import { graphRouter } from "./routes/graph.js";
import { openApiSpec } from "./openapi.js";
import { closeFalkor } from "./falkor.js";
import { closeCache } from "./cache.js";

const app = express();
const port = parseInt(process.env.PORT ?? "3000", 10);

app.use(express.json());

app.get("/openapi.json", (_req, res) => {
  res.json(openApiSpec);
});

app.use("/graph", graphRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const server = app.listen(port, () => {
  console.log(`FalkorSpecs API (OpenAPI 3.1) listening on port ${port}`);
});

process.on("SIGTERM", () => {
  server.close(() =>
    Promise.all([closeFalkor(), closeCache()]).then(() => process.exit(0))
  );
});
