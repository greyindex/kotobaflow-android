const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const androidRoot = path.join(root, "android");
const gradleWrapper = path.join(
  androidRoot,
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);

const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.platform === "win32" && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk")
    : "",
  process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Android", "sdk")
    : "",
  process.platform === "linux" ? path.join(os.homedir(), "Android", "Sdk") : "",
].filter(Boolean);

const sdkRoot = sdkCandidates.find((candidate) => fs.existsSync(candidate));
if (!sdkRoot) {
  throw new Error(
    "Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT before building the APK.",
  );
}
if (!fs.existsSync(gradleWrapper))
  throw new Error(`Gradle wrapper not found: ${gradleWrapper}`);

const gradleTasks = process.argv.slice(2);
if (!gradleTasks.length) gradleTasks.push("assembleDebug");

// The incremental APK packager updates the previous APK in place, and assets
// removed since then leave unused space inside it (59.7 MiB after the example
// audio was pruned). Removing the previous output makes it package afresh.
for (const task of gradleTasks) {
  const variant = /^assemble(Debug|Release)$/.exec(task);
  if (variant)
    fs.rmSync(
      path.join(
        androidRoot,
        "app",
        "build",
        "outputs",
        "apk",
        variant[1].toLowerCase(),
      ),
      { recursive: true, force: true },
    );
}

console.log(`Using Android SDK: ${sdkRoot}`);
const result = spawnSync(gradleWrapper, gradleTasks, {
  cwd: androidRoot,
  env: {
    ...process.env,
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
