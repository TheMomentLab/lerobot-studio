#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SNAPSHOT_PATH = path.join(ROOT, "contracts", "openapi.snapshot.json");
const SOURCE_URL = process.env.LESTUDIO_OPENAPI_URL || "http://127.0.0.1:8000/openapi.json";
const UPDATE_MODE = process.argv.includes("--update");

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchOpenApi(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`failed to fetch ${url} (${res.status})`);
  }
  return await res.text();
}

async function readSnapshot() {
  try {
    return await readFile(SNAPSHOT_PATH, "utf-8");
  } catch {
    return null;
  }
}

async function writeSnapshot(content) {
  await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await writeFile(SNAPSHOT_PATH, content, "utf-8");
}

async function main() {
  const remote = await fetchOpenApi(SOURCE_URL);
  if (UPDATE_MODE) {
    await writeSnapshot(remote);
    process.stdout.write(`updated snapshot: ${SNAPSHOT_PATH}\n`);
    return;
  }

  const snapshot = await readSnapshot();
  if (snapshot === null) {
    throw new Error(`snapshot missing: ${SNAPSHOT_PATH}. run: npm run contract:update`);
  }

  const remoteDigest = digest(remote);
  const localDigest = digest(snapshot);
  if (remoteDigest !== localDigest) {
    throw new Error(
      `OpenAPI contract drift detected. local=${localDigest.slice(0, 12)} remote=${remoteDigest.slice(0, 12)}. run: npm run contract:update`,
    );
  }

  process.stdout.write(`openapi contract ok (${remoteDigest.slice(0, 12)})\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
