import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

// Linux releases are built on Ubuntu 24.04. Local builds must not silently
// raise that runtime requirement by compiling native addons on a newer host.
export const LINUX_GLIBC_BASELINE = "2.39";

export function unsupportedGlibcVersions(bytes: Uint8Array): string[] {
  if (bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    return [];
  }
  const versions = new Set(
    Array.from(
      new TextDecoder("latin1").decode(bytes).matchAll(/GLIBC_(\d+\.\d+(?:\.\d+)?)\0/g),
      (match) => match[1]!,
    ),
  );
  const baseline = LINUX_GLIBC_BASELINE.split(".").map(Number);
  return [...versions]
    .filter((version) => {
      const parts = version.split(".").map(Number);
      for (let i = 0; i < Math.max(parts.length, baseline.length); i++) {
        const difference = (parts[i] ?? 0) - (baseline[i] ?? 0);
        if (difference !== 0) return difference > 0;
      }
      return false;
    })
    .sort();
}

export class LinuxGlibcCompatibilityError extends Schema.TaggedError<LinuxGlibcCompatibilityError>()(
  "LinuxGlibcCompatibilityError",
  { path: Schema.String, versions: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `${this.path} requires glibc ${this.versions.join(", ")}, newer than the Linux release baseline ${LINUX_GLIBC_BASELINE}. Rebuild the Linux artifact on Ubuntu 24.04 or a compatible older build environment.`;
  }
}

export const validateLinuxGlibc = Effect.fn("validateLinuxGlibc")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const name of yield* fs.readDirectory(directory)) {
      const entry = path.join(directory, name);
      const stat = yield* fs.stat(entry);
      if (stat.type === "Directory") {
        pending.push(entry);
      } else if (
        stat.type === "File" &&
        (name.endsWith(".node") || /\.so(?:\.|$)/.test(name) || (stat.mode & 0o111) !== 0)
      ) {
        const versions = unsupportedGlibcVersions(yield* fs.readFile(entry));
        if (versions.length > 0) {
          return yield* new LinuxGlibcCompatibilityError({ path: entry, versions });
        }
      }
    }
  }
});
