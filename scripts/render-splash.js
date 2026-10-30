// Renders the Android splash images from mobile-assets/logo.svg on the web's
// default 简洁 page colours (UI-ART-25): white by day, #0f0f0f at night, so
// launch flows into the first page without a colour change. Also renders the
// bare logo (drawable-nodpi/launch_logo.png) that launch_cover.xml draws at
// 64 dp on every screen (DF-16).
// Run: node scripts/render-splash.js
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  path.join(__dirname, "..", "web-source-backup", "node_modules", "playwright"),
);

const root = path.resolve(__dirname, "..");
const res = path.join(root, "android/app/src/main/res");
const BACKGROUND = { day: "#ffffff", night: "#0f0f0f" };
// [width, height, logo edge] per density folder, as first generated.
const SIZES = {
  drawable: [320, 480, 64],
  "drawable-port-ldpi": [240, 320, 48],
  "drawable-port-mdpi": [320, 480, 64],
  "drawable-port-hdpi": [480, 800, 96],
  "drawable-port-xhdpi": [720, 1280, 144],
  "drawable-port-xxhdpi": [960, 1600, 192],
  "drawable-port-xxxhdpi": [1280, 1920, 256],
  "drawable-land-ldpi": [320, 240, 64],
  "drawable-land-mdpi": [480, 320, 96],
  "drawable-land-hdpi": [800, 480, 160],
  "drawable-land-xhdpi": [1280, 720, 256],
  "drawable-land-xxhdpi": [1600, 960, 320],
  "drawable-land-xxxhdpi": [1920, 1280, 384],
};

function nightFolder(folder) {
  if (folder === "drawable") return "drawable-night";
  return folder.replace(/^drawable-(port|land)-/, "drawable-$1-night-");
}

async function main() {
  const logo = fs.readFileSync(path.join(root, "mobile-assets/logo.svg"));
  const source = "data:image/svg+xml;base64," + logo.toString("base64");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const jobs = [];
    for (const [folder, size] of Object.entries(SIZES)) {
      jobs.push([folder, size, BACKGROUND.day]);
      // The night default folder has always held the small landscape image.
      jobs.push([
        nightFolder(folder),
        folder === "drawable" ? SIZES["drawable-land-ldpi"] : size,
        BACKGROUND.night,
      ]);
    }
    for (const [folder, [width, height, edge], background] of jobs) {
      const target = path.join(res, folder, "splash.png");
      if (!fs.existsSync(target)) throw new Error(`Missing splash: ${target}`);
      await page.setViewportSize({ width, height });
      await page.setContent(
        `<body style="margin:0;height:100vh;display:grid;place-items:center;background:${background}">` +
          `<img src="${source}" width="${edge}" height="${edge}" alt=""></body>`,
      );
      await page.locator("img").evaluate((img) => img.decode());
      await page.screenshot({ path: target, type: "png" });
      console.log(`${folder}/splash.png ${width}x${height} on ${background}`);
    }
    const logoTarget = path.join(res, "drawable-nodpi", "launch_logo.png");
    fs.mkdirSync(path.dirname(logoTarget), { recursive: true });
    await page.setViewportSize({ width: 256, height: 256 });
    await page.setContent(
      `<body style="margin:0;background:transparent">` +
        `<img src="${source}" width="256" height="256" alt="" style="display:block"></body>`,
    );
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({
      path: logoTarget,
      type: "png",
      omitBackground: true,
    });
    console.log("drawable-nodpi/launch_logo.png 256x256");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
