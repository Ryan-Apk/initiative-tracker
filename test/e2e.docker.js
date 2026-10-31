import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const IMAGE = "initiative-tracker:local";
const CONTAINER = "initiative-tracker-e2e";

test("docker image builds and serves the app over HTTP", async () => {
  execSync(`docker rm -f ${CONTAINER} >/dev/null 2>&1 || true`, { stdio: "ignore" });

  execSync(
    `docker run -d --rm --name ${CONTAINER} -p 3000:3000 \
      -e DM_PASSWORD=test-password \
      -e PUBLIC_ORIGIN=http://127.0.0.1:3000 \
      -e PORT=3000 \
      -e HOST=0.0.0.0 \
      -e TRUST_PROXY=1 \
      -e DATABASE_PATH=/data/initiative.sqlite \
      -v initiative-tracker-e2e-data:/data \
      ${IMAGE}`,
    { stdio: "inherit" },
  );

  try {
    let healthy = false;
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch("http://127.0.0.1:3000/api/health");
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        // retry until container is ready
      }
      await sleep(1000);
    }

    assert.equal(healthy, true, "Container did not become healthy in time");

    const rootResponse = await fetch("http://127.0.0.1:3000/");
    assert.equal(rootResponse.status, 200);

    const html = await rootResponse.text();
    assert.match(html, /Rivergate|initiative|tracker/i, "Expected the app HTML to be served");
  } finally {
    execSync(`docker rm -f ${CONTAINER} >/dev/null 2>&1 || true`, { stdio: "ignore" });
  }
});
