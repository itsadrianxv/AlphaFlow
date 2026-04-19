import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

function createSandbox(options?: {
  includeDeployMain?: boolean;
  includeCompose?: boolean;
  includeEnv?: boolean;
}) {
  const root = mkdtempSync(path.join(tmpdir(), "deploy-main-test-"));
  const deployDir = path.join(root, "deploy");
  const deployPythonDir = path.join(deployDir, "python");
  const deployMainRoot = path.join(root, ".worktrees", "deploy-main");
  const deployMainDeployDir = path.join(deployMainRoot, "deploy");
  const deployMainPythonDir = path.join(deployMainDeployDir, "python");
  const binDir = path.join(root, "bin");
  const dockerLog = path.join(root, "docker.log");

  mkdirSync(deployDir, { recursive: true });
  mkdirSync(deployPythonDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const repoScript = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "deploy",
    "deploy-main.ps1",
  );
  expect(existsSync(repoScript)).toBe(true);
  copyFileSync(repoScript, path.join(deployDir, "deploy-main.ps1"));

  if (options?.includeDeployMain ?? true) {
    mkdirSync(deployMainDeployDir, { recursive: true });
    mkdirSync(deployMainPythonDir, { recursive: true });
  }

  if (
    (options?.includeDeployMain ?? true) &&
    (options?.includeCompose ?? true)
  ) {
    writeFileSync(
      path.join(deployMainDeployDir, "docker-compose.yml"),
      "services:\n  web:\n    image: alpine:3.20\n",
      "utf8",
    );
    writeFileSync(
      path.join(deployMainPythonDir, "Dockerfile.voice-base"),
      "FROM python:3.11-slim\n",
      "utf8",
    );
  }

  if (options?.includeEnv ?? true) {
    writeFileSync(
      path.join(deployMainRoot, ".env"),
      "AUTH_SECRET=test-secret\nNEXTAUTH_URL=http://localhost:3000\n",
      "utf8",
    );
  }

  writeFileSync(
    path.join(binDir, "docker.cmd"),
    '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-docker.ps1" %*\r\n',
    "utf8",
  );
  writeFileSync(
    path.join(binDir, "fake-docker.ps1"),
    [
      "$log = $env:DOCKER_LOG",
      'Add-Content -Path $log -Value ($args -join " ")',
      '$joined = $args -join " "',
      'if ($joined -match "^build " -and $joined -match "python-voice-base") {',
      '  Write-Output "python-voice-base built"',
      "  exit 0",
      "}",
      'if ($joined -match "^image inspect " -and $joined -match "python-voice-base") {',
      '  Write-Output "sha256:voicebase"',
      "  exit 0",
      "}",
      'if ($joined -match "(^| )compose " -and $joined -match " config") {',
      '  Write-Output "services:"',
      '  Write-Output "  web:"',
      "  exit 0",
      "}",
      'if ($joined -match "(^| )compose " -and $joined -match " up -d") {',
      '  [Console]::Error.WriteLine("Image stock-screening-boost-web Building")',
      "  exit 0",
      "}",
      'if ($joined -match "(^| )compose " -and $joined -match " ps --services --status running") {',
      "  $serviceArgs = @()",
      '  $psIndex = [Array]::IndexOf($args, "ps")',
      "  if ($psIndex -ge 0 -and ($psIndex + 4) -lt $args.Length) {",
      "    $serviceArgs = $args[($psIndex + 4)..($args.Length - 1)]",
      "  }",
      "  foreach ($service in $serviceArgs) {",
      "    Write-Output $service",
      "  }",
      "  exit 0",
      "}",
      'if ($joined -match "(^| )compose " -and $joined -match " exec -T") {',
      '  Write-Output "AUTH_SECRET=test-secret"',
      '  Write-Output "NEXTAUTH_URL=http://localhost:3000"',
      "  exit 0",
      "}",
      'Write-Error "Unexpected docker invocation: $joined"',
      "exit 1",
      "",
    ].join("\r\n"),
    "utf8",
  );

  return { root, binDir, dockerLog };
}

function runDeployScript(root: string, binDir: string, extraArgs: string[]) {
  return spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "deploy", "deploy-main.ps1"),
      ...extraArgs,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEX_DEPLOY_MAIN_REPO_ROOT: root,
        DOCKER_LOG: path.join(root, "docker.log"),
        PATH: `${binDir};${process.env.PATH ?? ""}`,
      },
    },
  );
}

const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

describe("deploy-main.ps1", () => {
  it("fails fast when deploy-main worktree is missing", () => {
    const { root, binDir } = createSandbox({
      includeDeployMain: false,
      includeCompose: false,
      includeEnv: false,
    });
    sandboxes.push(root);

    const result = runDeployScript(root, binDir, ["-Services", "web"]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      ".worktrees/deploy-main",
    );
  });

  it("fails fast when the deploy-main env file is missing", () => {
    const { root, binDir } = createSandbox({ includeEnv: false });
    sandboxes.push(root);

    const result = runDeployScript(root, binDir, ["-Services", "web"]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      ".worktrees/deploy-main/.env",
    );
  });

  it("uses the deploy-main compose paths and validates required env vars", () => {
    const { root, binDir, dockerLog } = createSandbox();
    sandboxes.push(root);

    const result = runDeployScript(root, binDir, [
      "-Services",
      "web",
      "-RequiredEnv",
      "AUTH_SECRET,NEXTAUTH_URL",
    ]);

    expect(result.status).toBe(0);

    const log = readFileSync(dockerLog, "utf8");
    expect(log).toContain(
      path.join(
        root,
        ".worktrees",
        "deploy-main",
        "deploy",
        "docker-compose.yml",
      ),
    );
    expect(log).toContain(path.join(root, ".worktrees", "deploy-main", ".env"));
    expect(log).toContain(
      path.join(root, ".worktrees", "deploy-main", "deploy"),
    );
    expect(log).toContain("up -d --build web");
    expect(log).toContain("exec -T web");
  }, 15_000);

  it("accepts comma-separated services even when required env validation is omitted", () => {
    const { root, binDir, dockerLog } = createSandbox();
    sandboxes.push(root);

    const result = runDeployScript(root, binDir, [
      "-Services",
      "postgres,redis",
    ]);

    expect(result.status).toBe(0);

    const log = readFileSync(dockerLog, "utf8");
    expect(log).toContain("up -d --build postgres redis");
    expect(log).toContain("ps --services --status running postgres redis");
  });

  it("builds the python voice base image before starting python-service", () => {
    const { root, binDir, dockerLog } = createSandbox();
    sandboxes.push(root);

    const result = runDeployScript(root, binDir, [
      "-Services",
      "python-service",
    ]);

    expect(result.status).toBe(0);

    const log = readFileSync(dockerLog, "utf8");
    const baseBuildIndex = log.indexOf("build -f");
    const composeUpIndex = log.indexOf("compose --project-directory");

    expect(log).toContain("python-voice-base");
    expect(log).toContain(
      path.join("deploy", "python", "Dockerfile.voice-base"),
    );
    expect(log).toContain("up -d --build python-service");
    expect(baseBuildIndex).toBeGreaterThanOrEqual(0);
    expect(composeUpIndex).toBeGreaterThan(baseBuildIndex);
  }, 15_000);
});
