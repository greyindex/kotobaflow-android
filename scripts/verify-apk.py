"""Read-only verification of the built APK against the offline web receipt."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile


def main():
    if not __debug__:
        raise RuntimeError("APK verification must run without Python optimization")
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, default=root / "android/app/build/outputs/apk/debug/app-debug.apk")
    parser.add_argument("--release", action="store_true",
                        help="verify the current release APK (signed, or unsigned without a keystore)")
    parser.add_argument("--report", type=Path, default=root / "artifacts/apk-verification.json")
    args = parser.parse_args()
    if args.release:
        # Gradle names the release output after its signing state; its metadata
        # names the file the last assembleRelease wrote.
        outputs = root / "android/app/build/outputs/apk/release"
        metadata = json.loads((outputs / "output-metadata.json").read_text(encoding="utf-8"))
        args.apk = outputs / metadata["elements"][0]["outputFile"]
    apk = args.apk.resolve(strict=True)
    receipt = json.loads((root / "artifacts/mobile-web-manifest.json").read_text(encoding="utf-8"))
    expected = receipt["files"]
    # The edition prepare-web.js packaged names the version suffix (build.gradle).
    edition = receipt.get("edition", "local")
    version_name = {"local": "0.4.2-offline", "public": "0.4.2-public"}[edition]
    if edition == "public":
        withheld = [f for f in expected if "xinbian" in f.lower()]
        assert not withheld, f"Public edition receipt lists withheld files: {withheld[:10]}"
    # Both editions carry the whole classics library (DF-23): the catalog, each
    # work's index and parts, and the narrations, nothing else from its folder.
    classics = receipt["counts"]["classics"]
    assert classics == {"works": 6, "parts": 152, "narrations": 2}, f"Classics library incomplete: {classics}"
    classic_files = [f for f in expected if f.startswith("data/classics_v1/")]
    assert len(classic_files) == 1 + classics["works"] + classics["parts"] + classics["narrations"],         f"Unexpected classics files: {len(classic_files)}"
    total = 0
    with zipfile.ZipFile(apk) as bundle:
        native_assets = {item.filename for item in bundle.infolist()
                         if item.filename.startswith("assets/") and not item.filename.startswith("assets/public/")
                         and not item.is_dir()}
        # Release builds also carry AGP's ART baseline profile.
        dexopt = {"assets/dexopt/baseline.prof", "assets/dexopt/baseline.profm"} if args.release else set()
        assert native_assets == {"assets/capacitor.config.json", "assets/capacitor.plugins.json",
                                 "assets/native-bridge.js"} | dexopt, f"Unexpected native assets: {sorted(native_assets)}"
        public = {item.filename.removeprefix("assets/public/"): item for item in bundle.infolist()
                  if item.filename.startswith("assets/public/") and not item.is_dir()}
        missing = set(expected) - set(public)
        extra = set(public) - set(expected)
        assert not missing, f"APK missing offline resources: {sorted(missing)[:10]}"
        assert extra <= {"cordova.js", "cordova_plugins.js"}, f"Unexpected APK web assets: {sorted(extra)}"
        for relative, entry in expected.items():
            assert not PurePosixPath(relative).is_absolute() and ".." not in PurePosixPath(relative).parts
            item = public[relative]
            assert item.file_size == entry["bytes"], f"APK resource size changed: {relative}"
            body = bundle.read(item)
            assert hashlib.sha256(body).hexdigest() == entry["sha256"], f"APK resource hash changed: {relative}"
            native = root / "android/app/src/main/assets/public" / relative
            assert hashlib.sha256(native.read_bytes()).hexdigest() == entry["sha256"], f"Stale Android assets: {relative}"
            total += len(body)
        for relative in extra:
            assert bundle.read(public[relative]) == b"", f"Unexpected Cordova injection: {relative}"
        # MainActivity answers audio byte ranges from AssetManager.openFd(), which
        # needs the entry stored uncompressed (aapt's default for these types).
        stored_audio = 0
        for relative, item in public.items():
            if PurePosixPath(relative).suffix.lower() in {".ogg", ".mp3", ".m4a"}:
                assert item.compress_type == zipfile.ZIP_STORED, f"Compressed audio cannot seek: {relative}"
                stored_audio += 1
        narrations = [f for f in classic_files if PurePosixPath(f).suffix.lower() in {".mp3", ".ogg", ".m4a"}]
        assert len(narrations) == classics["narrations"] and all(
            public[f].compress_type == zipfile.ZIP_STORED for f in narrations), "Classics narrations must stay uncompressed"
        config = json.loads(bundle.read("assets/capacitor.config.json"))
        assert config["appId"] == "lol.kotobaflow.app"
        assert config["android"]["loggingBehavior"] == "none", "Archive contents could reach native logs"
        assert not config.get("server", {}).get("url"), "APK is configured for a remote development server"

    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or
               Path(os.environ["LOCALAPPDATA"]) / "Android/Sdk")
    aapts = sorted((sdk / "build-tools").glob("*/aapt.exe"),
                   key=lambda p: tuple(int(n) for n in p.parent.name.split(".") if n.isdigit()))
    assert aapts, "Android SDK aapt is required to verify the final APK permissions"
    permissions = subprocess.check_output([str(aapts[-1]), "dump", "permissions", str(apk)], encoding="utf-8")
    badging = subprocess.check_output([str(aapts[-1]), "dump", "badging", str(apk)], encoding="utf-8")
    assert "android.permission.INTERNET" not in permissions, "Final APK has networking permission"
    assert "name='lol.kotobaflow.app'" in badging
    assert "versionCode='3'" in badging and f"versionName='{version_name}'" in badging
    # Who signed it: the debug key, a release key, or nobody yet (assembleRelease
    # without android/keystore.properties).
    apksigner = aapts[-1].parent / "apksigner.bat"
    signed = subprocess.run([str(apksigner), "verify", "--print-certs", str(apk)],
                            capture_output=True, encoding="utf-8")
    signer = None
    if signed.returncode == 0:
        # "V2 Signer: certificate DN: …" (older apksigner: "Signer #1 certificate DN: …").
        dn = re.search(r"certificate DN: (.+)", signed.stdout)
        digest = re.search(r"certificate SHA-256 digest: ([0-9a-f]{64})", signed.stdout)
        assert dn and digest, f"Unreadable signer: {signed.stdout[:300]}"
        signer = {"dn": dn.group(1).strip(), "sha256": digest.group(1),
                  "debugKey": "CN=Android Debug" in dn.group(1)}
    source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root / "web-source-backup", text=True).strip()
    with apk.open("rb") as stream:
        apk_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    result = {"passed": True, "apk": str(apk), "bytes": apk.stat().st_size,
              "sha256": apk_hash, "edition": edition, "versionName": version_name, "signer": signer,
              "webSourceCommit": source_commit, "verifiedWebFiles": len(expected), "webBytes": total,
              "storedAudio": stored_audio,
              "generatedCordovaStubs": sorted(extra), "nativeAssets": sorted(native_assets),
              "permissions": permissions.splitlines(),
              "package": badging.splitlines()[0], "counts": receipt["counts"]}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
