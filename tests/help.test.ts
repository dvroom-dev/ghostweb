import { expect, test } from "bun:test";

test("prints help without starting server", async () => {
  const proc = Bun.spawn(["bun", "run", "index.ts", "--", "--help"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout ?? null).text();
  const stderr = await new Response(proc.stderr ?? null).text();

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Usage: ghostweb");
  expect(stderr.trim().length).toBe(0);
});
