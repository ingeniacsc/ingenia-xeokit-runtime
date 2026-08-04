import path from "node:path";
import { fileURLToPath } from "node:url";

function requireBaseUrl(environment = process.env) {
  const raw = environment.VIEWER_BASE_URL ?? "";
  const url = new URL(raw);
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("VIEWER_BASE_URL must use HTTPS or loopback HTTP");
  }
  return url;
}

async function fetchRequired(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl), { redirect: "error" });
  if (response.status !== 200) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response;
}

export async function verifyRunningImage(environment = process.env) {
  const baseUrl = requireBaseUrl(environment);
  const indexResponse = await fetchRequired(baseUrl, "/");
  const headers = indexResponse.headers;
  const csp = headers.get("content-security-policy") ?? "";
  if (!csp.includes("frame-ancestors https://ingenia.vn")) {
    throw new Error("Reviewed frame-ancestors policy is missing");
  }
  if (headers.get("referrer-policy") !== "no-referrer") {
    throw new Error("Referrer-Policy must be no-referrer");
  }
  if (headers.get("x-content-type-options") !== "nosniff") {
    throw new Error("X-Content-Type-Options must be nosniff");
  }
  if (!(headers.get("permissions-policy") ?? "").includes("camera=()")) {
    throw new Error("Permissions-Policy is missing the reviewed camera restriction");
  }
  const sourceHeader = headers.get("link") ?? "";
  if (!sourceHeader.includes('rel="source"')) {
    throw new Error("HTTP Corresponding Source link is missing");
  }

  const index = await indexResponse.text();
  const sourceResponse = await fetchRequired(baseUrl, "/source.json");
  const source = await sourceResponse.json();
  if (!/^[0-9a-f]{40}$/.test(source.revision ?? "")) {
    throw new Error("source.json revision is not a full Git commit");
  }
  if (source.revision === "0".repeat(40) && environment.ALLOW_CANDIDATE_REVISION !== "true") {
    throw new Error("All-zero revision cannot pass release verification");
  }
  const expectedSource =
    `https://github.com/ingeniacsc/ingenia-xeokit-runtime/tree/${source.revision}`;
  if (source.source !== expectedSource) {
    throw new Error("source.json does not bind the exact public source revision");
  }
  if (!index.includes(source.source)) {
    throw new Error("In-product Corresponding Source link does not match source.json");
  }

  for (const pathname of [
    "/legal/LICENSE",
    "/legal/NOTICE",
    "/legal/THIRD_PARTY_NOTICES",
    "/legal/sbom.spdx.json",
  ]) {
    const response = await fetchRequired(baseUrl, pathname);
    if (!(await response.text()).trim()) throw new Error(`${pathname} is empty`);
  }
  return { source, headers: Object.fromEntries(headers.entries()) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyRunningImage()
    .then(({ source }) => console.log(JSON.stringify({ status: "ok", source })))
    .catch((error) => {
      console.error(`Running image verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}
