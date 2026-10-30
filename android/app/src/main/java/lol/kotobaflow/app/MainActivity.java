package lol.kotobaflow.app;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.AssetFileDescriptor;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "KotobaFlow";
    private static final String NATIVE_THEME_REFRESH_SCRIPT =
        "(function(){if(window.__KOTOBAFLOW_APPLY_NATIVE_THEME__)window.__KOTOBAFLOW_APPLY_NATIVE_THEME__();})();";
    private static final String EXPORT_DIRECTORY = "exports";
    private static final long EXPORT_RETENTION_MS = 60L * 60L * 1000L;
    /** The splash stays at most this long if the page never reports (DF-16). */
    private static final long LAUNCH_COVER_MAX_MS = 8000L;
    private static final long LAUNCH_COVER_FADE_MS = 200L;
    private long launchStartedAt;
    private View launchCover;
    private DisplayManager displayManager;
    private boolean displayListenerRegistered;
    private WebView frameRateWebView;
    private float lastRequestedWebViewRate = Float.NaN;
    private Integer statusBarColor;
    private Integer navigationBarColor;
    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override
        public void onDisplayAdded(int displayId) {}

        @Override
        public void onDisplayRemoved(int displayId) {}

        @Override
        public void onDisplayChanged(int displayId) {
            Display display = getWindowDisplay();
            if (display != null && display.getDisplayId() == displayId) {
                applyHighRefreshRate();
            }
        }
    };

    private void applyAppTheme() {
        getApplication().setTheme(R.style.AppTheme_NoActionBar);
        setTheme(R.style.AppTheme_NoActionBar);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        launchStartedAt = SystemClock.uptimeMillis();
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM);
        registerPlugin(OfflineArchivePlugin.class);
        super.onCreate(savedInstanceState);
        applyScreenOrientation();
        applyHighRefreshRate();
    }

    /**
     * Phones run the reading shell, whose pages are laid out upright, so a
     * phone-sized screen stays in portrait. Tablets keep the web layout and
     * turn freely. Until this runs the manifest's "locked" holds the current
     * rotation. Checked again whenever the screen changes size, as when a
     * foldable opens or closes.
     */
    private void applyScreenOrientation() {
        int orientation = isTabletScreen()
            ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;
        if (getRequestedOrientation() != orientation) setRequestedOrientation(orientation);
    }

    /** The whole screen, as the page measures it with window.screen. */
    @SuppressWarnings("deprecation")
    private boolean isTabletScreen() {
        int width;
        int height;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Rect bounds = getWindowManager().getMaximumWindowMetrics().getBounds();
            width = bounds.width();
            height = bounds.height();
        } else {
            DisplayMetrics real = new DisplayMetrics();
            getWindowManager().getDefaultDisplay().getRealMetrics(real);
            width = real.widthPixels;
            height = real.heightPixels;
        }
        return NativeShellPolicy.isTabletScreen(width, height, getResources().getDisplayMetrics().density);
    }

    @Override
    public void setContentView(int layoutResID) {
        applyAppTheme();
        super.setContentView(layoutResID);
        WebView webView = findViewById(com.getcapacitor.android.R.id.webview);
        if (webView != null) {
            webView.addJavascriptInterface(new NativeThemeBridge(getApplicationContext()), "KotobaFlowNativeTheme");
            webView.addJavascriptInterface(new NativeShellBridge(), "KotobaFlowNative");
            applyWebViewFrameRate(webView, requestedRefreshRate());
        }
        showLaunchCover();
    }

    /**
     * DF-16: the splash (launch_cover, the window's own launch picture) stays
     * over the page until the page reports its first screen drawn, then fades
     * onto the page's matching launch cover. It takes taps meanwhile, and
     * leaves after LAUNCH_COVER_MAX_MS even if the page never reports.
     */
    private void showLaunchCover() {
        if (launchCover != null) return;
        View cover = new View(this);
        cover.setBackgroundResource(R.drawable.launch_cover);
        cover.setClickable(true);
        cover.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        // Over the content, the page's own box, so its logo sits where the
        // page's cover draws it (the decor view runs under the system bars).
        ViewGroup content = findViewById(android.R.id.content);
        if (content == null) return;
        content.addView(cover,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        launchCover = cover;
        cover.postDelayed(this::releaseLaunchCover, LAUNCH_COVER_MAX_MS);
    }

    private void releaseLaunchCover() {
        View cover = launchCover;
        if (cover == null) return;
        launchCover = null;
        cover.setClickable(false);
        Runnable remove = () -> {
            if (cover.getParent() instanceof ViewGroup) ((ViewGroup) cover.getParent()).removeView(cover);
        };
        if (reducedMotion()) remove.run();
        else cover.animate().alpha(0f).setDuration(LAUNCH_COVER_FADE_MS).withEndAction(remove);
    }

    /** Android's "remove animations" (animator duration scale 0). */
    private boolean reducedMotion() {
        return Settings.Global.getFloat(getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f;
    }

    /**
     * Capacitor's BridgeActivity applies its library theme before setContentView.
     * Reapply the app-owned DayNight theme there so the WebView is inflated with
     * the current system appearance.
     */
    @Override
    protected void load() {
        applyAppTheme();
        super.load();
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !OfflineUrlPolicy.isLocal(request.getUrl().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !OfflineUrlPolicy.isLocal(url);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (OfflineUrlPolicy.isLocal(request.getUrl().toString())) {
                    WebResourceResponse range = rangeResponse(request);
                    return range != null ? range : super.shouldInterceptRequest(view, request);
                }
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Offline only",
                    Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        applyWebViewBackground();
        applyHighRefreshRate();
    }

    /**
     * Before the page paints, show the web's default 简洁 look: white, or
     * #0f0f0f at night, matching the splash.
     */
    private void applyWebViewBackground() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        webView.setBackgroundColor(nightMode == Configuration.UI_MODE_NIGHT_YES ? 0xFF0F0F0F : 0xFFFFFFFF);
    }

    /**
     * Serve a Range request for an uncompressed packaged asset (all audio is
     * stored uncompressed) so that it ends with the range; see
     * LocalRangePolicy. Compressed or missing assets, requests without a
     * single satisfiable range and requests without a range stay with
     * Capacitor.
     */
    private WebResourceResponse rangeResponse(WebResourceRequest request) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) return null;
        String header = null;
        for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) {
            if ("range".equalsIgnoreCase(entry.getKey())) {
                header = entry.getValue();
                break;
            }
        }
        if (header == null) return null;
        String asset = LocalRangePolicy.assetPath(request.getUrl().getPath());
        if (asset == null) return null;
        AssetFileDescriptor descriptor;
        try {
            descriptor = getAssets().openFd(asset);
        } catch (IOException error) {
            return null;
        }
        long total = descriptor.getLength();
        long[] range = LocalRangePolicy.parse(header, total);
        try {
            if (range == null || range[0] == LocalRangePolicy.UNSATISFIABLE) {
                descriptor.close();
                return null;
            }
            Map<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Cache-Control", "no-cache");
            headers.put("Content-Range", "bytes " + range[0] + "-" + range[1] + "/" + total);
            return new WebResourceResponse(LocalRangePolicy.mimeType(asset), null, 206, "Partial Content",
                headers, LocalRangePolicy.untilRangeEnd(descriptor.createInputStream(), range));
        } catch (IOException error) {
            Log.w(TAG, "Range response failed for " + asset, error);
            try {
                descriptor.close();
            } catch (IOException ignored) {
                // Already failing; Capacitor answers instead.
            }
            return null;
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        registerDisplayListener();
        applyHighRefreshRate();
    }

    @Override
    public void onStop() {
        unregisterDisplayListener();
        super.onStop();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyHighRefreshRate();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        applyAppTheme();
        super.onConfigurationChanged(newConfig);
        applyScreenOrientation();
        applyHighRefreshRate();
        // Capacitor's SystemBars resets the icon style to the system theme on
        // every configuration change; the page may use a different palette.
        applySystemBars();
        applyWebViewBackground();
        refreshNativeTheme();
    }

    /**
     * Request the highest supported 120/144/160 Hz-compatible mode without
     * taking control away from Android's power, thermal, or user policy.
     *
     * <p>The selected mode always has the current physical resolution. An exact
     * mode id makes the request effective on vendor builds that ignore the
     * refresh-rate-only hint. Android may still override the preference for
     * battery saver, thermal limits, multi-window, or user policy.</p>
     */
    private void applyHighRefreshRate() {
        Window window = getWindow();
        if (window == null) return;

        Display display = getWindowDisplay();
        if (display == null || !display.isValid()) return;

        Display.Mode currentMode = display.getMode();
        HighRefreshRatePolicy.ModeCandidate preferredMode = choosePreferredMode(display, currentMode);
        int preferredModeId = preferredMode != null ? preferredMode.modeId : 0;
        float preferredRate = preferredMode != null ? preferredMode.refreshRate : 0f;

        WindowManager.LayoutParams attributes = window.getAttributes();
        boolean changed =
            attributes.preferredDisplayModeId != preferredModeId ||
            Float.compare(attributes.preferredRefreshRate, 0f) != 0;
        attributes.preferredDisplayModeId = preferredModeId;
        // Android ignores preferredRefreshRate when an exact mode id is set.
        attributes.preferredRefreshRate = 0f;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            attributes.setFrameRateBoostOnTouchEnabled(true);
        }
        if (changed) window.setAttributes(attributes);

        WebView webView = findViewById(com.getcapacitor.android.R.id.webview);
        if (webView != null) applyWebViewFrameRate(webView, preferredRate);

        Log.i(
            TAG,
            "Display refresh policy: currentMode=" + formatMode(currentMode) +
                " supported=" + formatModes(display.getSupportedModes()) +
                " requestedMode=" + preferredModeId + "@" + formatRate(preferredRate) + "Hz" +
                " touchBoost=" + (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM)
        );
    }

    private static HighRefreshRatePolicy.ModeCandidate choosePreferredMode(
        Display display,
        Display.Mode currentMode
    ) {
        if (currentMode == null) return null;
        Display.Mode[] modes = display.getSupportedModes();
        if (modes == null || modes.length == 0) return null;
        HighRefreshRatePolicy.ModeCandidate[] candidates =
            new HighRefreshRatePolicy.ModeCandidate[modes.length];
        for (int index = 0; index < modes.length; index++) {
            Display.Mode mode = modes[index];
            candidates[index] = new HighRefreshRatePolicy.ModeCandidate(
                mode.getModeId(),
                mode.getPhysicalWidth(),
                mode.getPhysicalHeight(),
                mode.getRefreshRate()
            );
        }
        return HighRefreshRatePolicy.choosePreferredMode(
            candidates,
            currentMode.getPhysicalWidth(),
            currentMode.getPhysicalHeight()
        );
    }

    private float requestedRefreshRate() {
        Display display = getWindowDisplay();
        if (display == null || !display.isValid()) return 0f;
        HighRefreshRatePolicy.ModeCandidate mode = choosePreferredMode(display, display.getMode());
        return mode != null ? mode.refreshRate : 0f;
    }

    private void applyWebViewFrameRate(WebView webView, float preferredRate) {
        if (
            frameRateWebView == webView &&
            Float.compare(lastRequestedWebViewRate, preferredRate) == 0
        ) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
            webView.setRequestedFrameRate(
                preferredRate > 0f
                    ? preferredRate
                    : android.view.View.REQUESTED_FRAME_RATE_CATEGORY_NO_PREFERENCE
            );
        }
        frameRateWebView = webView;
        lastRequestedWebViewRate = preferredRate;
    }

    private void registerDisplayListener() {
        if (displayListenerRegistered) return;
        if (displayManager == null) {
            displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        }
        if (displayManager == null) return;
        displayManager.registerDisplayListener(displayListener, null);
        displayListenerRegistered = true;
    }

    private void unregisterDisplayListener() {
        if (!displayListenerRegistered || displayManager == null) return;
        displayManager.unregisterDisplayListener(displayListener);
        displayListenerRegistered = false;
    }

    private Display getWindowDisplay() {
        Display display = getWindow().getDecorView().getDisplay();
        if (display != null) return display;
        return getWindowManager().getDefaultDisplay();
    }

    private static String formatRate(float rate) {
        return rate > 0f ? String.format(java.util.Locale.US, "%.2f", rate) : "none";
    }

    private static String formatMode(Display.Mode mode) {
        if (mode == null) return "none";
        return mode.getModeId() + "(" + mode.getPhysicalWidth() + "x" +
            mode.getPhysicalHeight() + "@" + formatRate(mode.getRefreshRate()) + "Hz)";
    }

    private static String formatModes(Display.Mode[] modes) {
        if (modes == null || modes.length == 0) return "none";
        StringBuilder result = new StringBuilder();
        for (Display.Mode mode : modes) {
            if (result.length() > 0) result.append(",");
            result.append(formatMode(mode));
        }
        return result.toString();
    }

    private void refreshNativeTheme() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(NATIVE_THEME_REFRESH_SCRIPT, null));
    }

    /**
     * Paint the system bars with the page chrome. On Android 15+ the app is
     * edge-to-edge and the page already draws under the bars, so only the
     * icon style changes; earlier versions also take the bar colours.
     */
    @SuppressWarnings("deprecation")
    private void applySystemBars() {
        if (statusBarColor == null || navigationBarColor == null) return;
        Window window = getWindow();
        if (window == null) return;
        boolean darkStatusIcons = NativeShellPolicy.prefersDarkIcons(statusBarColor);
        boolean darkNavigationIcons = NativeShellPolicy.prefersDarkIcons(navigationBarColor);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(darkStatusIcons);
        controller.setAppearanceLightNavigationBars(darkNavigationIcons);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            window.setStatusBarColor(statusBarColor);
            // Dark navigation icons arrived in Android 8; before that a light
            // bar would hide the white buttons.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O || !darkNavigationIcons) {
                window.setNavigationBarColor(navigationBarColor);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }
    }

    private void performHaptic(String kind) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        int feedback;
        if ("confirm".equals(kind)) {
            feedback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? HapticFeedbackConstants.CONFIRM
                : HapticFeedbackConstants.VIRTUAL_KEY;
        } else if ("reject".equals(kind)) {
            feedback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? HapticFeedbackConstants.REJECT
                : HapticFeedbackConstants.LONG_PRESS;
        } else {
            feedback = HapticFeedbackConstants.CLOCK_TICK;
        }
        // Honours the system touch-feedback setting.
        webView.performHapticFeedback(feedback);
    }

    private void setKeepScreenOn(boolean keepOn) {
        Window window = getWindow();
        if (window == null) return;
        if (keepOn) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** Write an export into the app cache, dropping earlier exports past an hour. */
    private File writeExport(String name, String content) throws IOException {
        File directory = new File(getCacheDir(), EXPORT_DIRECTORY);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("No export directory");
        File[] previous = directory.listFiles();
        long cutoff = System.currentTimeMillis() - EXPORT_RETENTION_MS;
        if (previous != null) {
            for (File file : previous) {
                if (file.lastModified() < cutoff && !file.delete()) {
                    Log.w(TAG, "Could not remove old export " + file.getName());
                }
            }
        }
        File file = new File(directory, name);
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(content.getBytes(StandardCharsets.UTF_8));
        }
        return file;
    }

    private void notifyFileResult(String result) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String script =
            "(function(){if(window.__KOTOBAFLOW_NATIVE_FILE_RESULT__)window.__KOTOBAFLOW_NATIVE_FILE_RESULT__(\"" +
            result +
            "\");})();";
        WebView webView = getBridge().getWebView();
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    /**
     * Phone integrations for the web shell: system bar colours, haptics,
     * keeping the screen on during playback, and handing exports to the
     * share sheet (saving goes through OfflineArchivePlugin). Calls arrive
     * on a binder thread.
     */
    public final class NativeShellBridge {

        @JavascriptInterface
        public void setSystemBars(String statusColor, String navigationColor) {
            Integer status = NativeShellPolicy.parseOpaqueColor(statusColor);
            Integer navigation = NativeShellPolicy.parseOpaqueColor(navigationColor);
            if (status == null || navigation == null) return;
            runOnUiThread(() -> {
                statusBarColor = status;
                navigationBarColor = navigation;
                applySystemBars();
            });
        }

        /** The first screen is drawn: lift the splash; returns ms since launch. */
        @JavascriptInterface
        public long launchReady() {
            runOnUiThread(MainActivity.this::releaseLaunchCover);
            return SystemClock.uptimeMillis() - launchStartedAt;
        }

        @JavascriptInterface
        public boolean reducedMotion() {
            return MainActivity.this.reducedMotion();
        }

        @JavascriptInterface
        public void haptic(String kind) {
            runOnUiThread(() -> performHaptic(kind));
        }

        @JavascriptInterface
        public void keepScreenOn(boolean keepOn) {
            runOnUiThread(() -> setKeepScreenOn(keepOn));
        }

        @JavascriptInterface
        public boolean shareText(String name, String mimeType, String content) {
            if (content == null) return false;
            String type = NativeShellPolicy.safeMimeType(mimeType);
            String fileName = NativeShellPolicy.safeExportName(name, type);
            Uri uri;
            try {
                File file = writeExport(fileName, content);
                uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
            } catch (IOException | IllegalArgumentException error) {
                Log.w(TAG, "Preparing export failed", error);
                return false;
            }
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType(type)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_TITLE, fileName)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri(fileName, uri));
            Intent chooser = Intent.createChooser(send, fileName);
            runOnUiThread(() -> {
                try {
                    startActivity(chooser);
                } catch (ActivityNotFoundException error) {
                    notifyFileResult("unavailable");
                }
            });
            return true;
        }
    }

    public static final class NativeThemeBridge {

        private final Context context;

        NativeThemeBridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public boolean isDark() {
            int nightMode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return nightMode == Configuration.UI_MODE_NIGHT_YES;
        }
    }
}
