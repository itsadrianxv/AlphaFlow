import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  err,
  ExecutionError,
  FileError,
  ok,
  type ExecutionEnv,
  type FileInfo,
  type Result,
} from "@earendil-works/pi-agent-core";

function normalizePath(input: string, cwd: string) {
  return path.resolve(path.isAbsolute(input) ? input : path.join(cwd, input));
}

function isInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function toEnvPath(inputPath: string) {
  return inputPath.replace(/\\/g, "/");
}

function toFileInfo(filePath: string, stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mtimeMs: number }): FileInfo {
  const kind = stats.isSymbolicLink()
    ? "symlink"
    : stats.isDirectory()
      ? "directory"
      : "file";

  return {
    name: path.basename(filePath),
    path: toEnvPath(filePath),
    kind,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function mapFileError(error: unknown, filePath: string) {
  const nodeError = error as NodeJS.ErrnoException;
  if (nodeError.code === "ENOENT") {
    return new FileError("not_found", `Path not found: ${filePath}`, filePath);
  }
  if (nodeError.code === "EACCES" || nodeError.code === "EPERM") {
    return new FileError(
      "permission_denied",
      `Permission denied: ${filePath}`,
      filePath,
    );
  }
  if (nodeError.code === "ENOTDIR") {
    return new FileError("not_directory", `Not a directory: ${filePath}`, filePath);
  }
  if (nodeError.code === "EISDIR") {
    return new FileError("is_directory", `Is a directory: ${filePath}`, filePath);
  }

  return new FileError(
    "unknown",
    nodeError.message || `File operation failed: ${filePath}`,
    filePath,
  );
}

export class RestrictedExecutionEnv implements ExecutionEnv {
  readonly cwd: string;
  private readonly readRoots: string[];
  private readonly writeRoots: string[];

  constructor(options: {
    cwd: string;
    readRoots: string[];
    writeRoots?: string[];
  }) {
    this.cwd = path.resolve(options.cwd);
    this.readRoots = options.readRoots.map((root) => path.resolve(root));
    this.writeRoots = (options.writeRoots ?? []).map((root) =>
      path.resolve(root),
    );
  }

  async absolutePath(inputPath: string): Promise<Result<string, FileError>> {
    const absolute = normalizePath(inputPath, this.cwd);
    return ok(absolute);
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return ok(path.resolve(path.join(...parts)));
  }

  async readTextFile(
    inputPath: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>> {
    const check = this.resolveReadablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    if (abortSignal?.aborted) {
      return err(new FileError("aborted", "Read aborted", check.value));
    }

    try {
      return ok(await fs.readFile(check.value, "utf8"));
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async readTextLines(
    inputPath: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>> {
    const content = await this.readTextFile(inputPath, options?.abortSignal);
    if (!content.ok) {
      return content;
    }

    const lines = content.value.split(/\r?\n/);
    return ok(
      typeof options?.maxLines === "number"
        ? lines.slice(0, options.maxLines)
        : lines,
    );
  }

  async readBinaryFile(
    inputPath: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<Uint8Array, FileError>> {
    const check = this.resolveReadablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    if (abortSignal?.aborted) {
      return err(new FileError("aborted", "Read aborted", check.value));
    }

    try {
      return ok(await fs.readFile(check.value));
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async writeFile(
    inputPath: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>> {
    const check = this.resolveWritablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    if (abortSignal?.aborted) {
      return err(new FileError("aborted", "Write aborted", check.value));
    }

    try {
      await fs.mkdir(path.dirname(check.value), { recursive: true });
      await fs.writeFile(check.value, content);
      return ok(undefined);
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async appendFile(
    inputPath: string,
    content: string | Uint8Array,
  ): Promise<Result<void, FileError>> {
    const check = this.resolveWritablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    try {
      await fs.mkdir(path.dirname(check.value), { recursive: true });
      await fs.appendFile(check.value, content);
      return ok(undefined);
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async fileInfo(inputPath: string): Promise<Result<FileInfo, FileError>> {
    const check = this.resolveReadablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    try {
      const stats = await fs.lstat(check.value);
      return ok(toFileInfo(check.value, stats));
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async listDir(
    inputPath: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<FileInfo[], FileError>> {
    const check = this.resolveReadablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    if (abortSignal?.aborted) {
      return err(new FileError("aborted", "List aborted", check.value));
    }

    try {
      const entries = await fs.readdir(check.value);
      const infos = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(check.value, entry);
          const stats = await fs.lstat(entryPath);
          return toFileInfo(entryPath, stats);
        }),
      );
      return ok(infos);
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async canonicalPath(inputPath: string): Promise<Result<string, FileError>> {
    const check = this.resolveReadablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    try {
      return ok(await fs.realpath(check.value));
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async exists(inputPath: string): Promise<Result<boolean, FileError>> {
    const absolute = normalizePath(inputPath, this.cwd);
    if (!this.canRead(absolute) && !this.canWrite(absolute)) {
      return err(
        new FileError(
          "permission_denied",
          `Path is outside allowed roots: ${absolute}`,
          absolute,
        ),
      );
    }

    try {
      await fs.access(absolute);
      return ok(true);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return ok(false);
      }
      return err(mapFileError(error, absolute));
    }
  }

  async createDir(
    inputPath: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>> {
    const check = this.resolveWritablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    if (options?.abortSignal?.aborted) {
      return err(new FileError("aborted", "Create directory aborted", check.value));
    }

    try {
      await fs.mkdir(check.value, { recursive: options?.recursive ?? true });
      return ok(undefined);
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async remove(
    inputPath: string,
    options?: { recursive?: boolean; force?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>> {
    const check = this.resolveWritablePath(inputPath);
    if (!check.ok) {
      return check;
    }

    if (options?.abortSignal?.aborted) {
      return err(new FileError("aborted", "Remove aborted", check.value));
    }

    try {
      await fs.rm(check.value, {
        recursive: options?.recursive ?? false,
        force: options?.force ?? false,
      });
      return ok(undefined);
    } catch (error) {
      return err(mapFileError(error, check.value));
    }
  }

  async createTempDir(prefix = "tmp-"): Promise<Result<string, FileError>> {
    const root = this.writeRoots[0] ?? os.tmpdir();
    const target = path.join(root, prefix);
    try {
      const tempDir = await fs.mkdtemp(target);
      return ok(tempDir);
    } catch (error) {
      return err(mapFileError(error, target));
    }
  }

  async createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>> {
    const root = this.writeRoots[0] ?? os.tmpdir();
    const filePath = path.join(
      root,
      `${options?.prefix ?? ""}${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}${options?.suffix ?? ""}`,
    );
    return this.writeFile(filePath, "", options?.abortSignal).then((result) =>
      result.ok ? ok(filePath) : result,
    );
  }

  async exec(): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
    return err(
      new ExecutionError(
        "shell_unavailable",
        "agent-runtime 默认禁止执行任意 shell 命令",
      ),
    );
  }

  async cleanup(): Promise<void> {
    const tempRoot = path.resolve(os.tmpdir(), "alphaflow-agent-runtime");
    if (isInside(this.cwd, tempRoot)) {
      await fs.rm(this.cwd, { recursive: true, force: true });
    }
  }

  private resolveReadablePath(inputPath: string): Result<string, FileError> {
    const absolute = normalizePath(inputPath, this.cwd);
    if (!this.canRead(absolute)) {
      return err(
        new FileError(
          "permission_denied",
          `Path is outside readable roots: ${absolute}`,
          absolute,
        ),
      );
    }

    return ok(absolute);
  }

  private resolveWritablePath(inputPath: string): Result<string, FileError> {
    const absolute = normalizePath(inputPath, this.cwd);
    if (!this.canWrite(absolute)) {
      return err(
        new FileError(
          "permission_denied",
          `Path is outside writable roots: ${absolute}`,
          absolute,
        ),
      );
    }

    return ok(absolute);
  }

  private canRead(absolute: string) {
    return this.readRoots.some((root) => isInside(absolute, root));
  }

  private canWrite(absolute: string) {
    return this.writeRoots.some((root) => isInside(absolute, root));
  }
}
