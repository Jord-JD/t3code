import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  LinuxGlibcCompatibilityError,
  unsupportedGlibcVersions,
  validateLinuxGlibc,
} from "./linux-glibc.ts";

const elf = (versions: string[]) =>
  new TextEncoder().encode(`\x7fELF${versions.map((v) => `GLIBC_${v}\0`).join("")}`);

it("accepts the release baseline and older symbol versions", () => {
  assert.deepEqual(unsupportedGlibcVersions(elf(["2.2.5", "2.9", "2.17", "2.39"])), []);
});

it("detects newer requirements without confusing version numbers or non-ELF files", () => {
  assert.deepEqual(unsupportedGlibcVersions(elf(["2.42", "2.42", "2.40", "3.0"])), [
    "2.40",
    "2.42",
    "3.0",
  ]);
  assert.deepEqual(unsupportedGlibcVersions(new TextEncoder().encode("GLIBC_2.42\0")), []);
});

it.effect("rejects an incompatible addon inside the unpacked payload", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const addons = path.join(root, "resources", "app.asar.unpacked", "node_modules", "node-pty");
    yield* fs.makeDirectory(addons, { recursive: true });
    const addon = path.join(addons, "pty.node");
    yield* fs.writeFile(addon, elf(["2.42"]));
    const error = yield* validateLinuxGlibc(root).pipe(Effect.flip);
    assert.instanceOf(error, LinuxGlibcCompatibilityError);
    if (Schema.is(LinuxGlibcCompatibilityError)(error)) assert.equal(error.path, addon);
    yield* fs.writeFile(addon, elf(["2.39"]));
    yield* validateLinuxGlibc(root);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
