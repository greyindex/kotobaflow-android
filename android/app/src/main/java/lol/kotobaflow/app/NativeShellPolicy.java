package lol.kotobaflow.app;

import java.util.Locale;

/**
 * Pure rules behind the web-facing native shell bridge, kept free of Android
 * types so they can be unit tested on the JVM.
 */
final class NativeShellPolicy {

    static final String DEFAULT_EXPORT_NAME = "kotobaflow-export.json";
    static final int MAX_EXPORT_NAME_LENGTH = 96;
    /** Shortest screen side, in dp, from which a device counts as a tablet. */
    static final int TABLET_SHORTEST_SIDE_DP = 600;

    private NativeShellPolicy() {}

    /**
     * Tablets run the web layout and turn freely; phones run the reading
     * shell, which is laid out for upright pages. The line is the one
     * mobile-platform.js draws for the page: the screen's shorter side in dp.
     * A screen that cannot be measured counts as a phone there too.
     */
    static boolean isTabletScreen(int widthPx, int heightPx, float density) {
        if (widthPx <= 0 || heightPx <= 0 || !(density > 0f)) return false;
        return Math.min(widthPx, heightPx) / density >= TABLET_SHORTEST_SIDE_DP;
    }

    /**
     * Parse a page colour sent as {@code #rrggbb}. Returns an opaque ARGB int,
     * or {@code null} for anything else so a malformed call changes nothing.
     */
    static Integer parseOpaqueColor(String value) {
        if (value == null) return null;
        String color = value.trim();
        if (!color.matches("#[0-9a-fA-F]{6}")) return null;
        return 0xFF000000 | Integer.parseInt(color.substring(1), 16);
    }

    /** True when dark system-bar icons are the readable choice on this colour. */
    static boolean prefersDarkIcons(int argb) {
        double red = channel((argb >> 16) & 0xFF);
        double green = channel((argb >> 8) & 0xFF);
        double blue = channel(argb & 0xFF);
        double luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        // Contrast against black beats contrast against white above ~0.179.
        return luminance > 0.179;
    }

    private static double channel(int value) {
        double c = value / 255.0;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    /**
     * Reduce a page-supplied download name to one safe file name: no path
     * parts, no characters that shared storage providers reject, and a
     * {@code .json} extension for JSON exports.
     */
    static String safeExportName(String requested, String mimeType) {
        String name = requested == null ? "" : requested;
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) name = name.substring(slash + 1);
        name = name.replaceAll("[\\x00-\\x1f\"*:<>?|]", "-").trim();
        while (name.startsWith(".")) name = name.substring(1);
        if (name.isEmpty()) name = DEFAULT_EXPORT_NAME;
        boolean json = mimeType != null && mimeType.toLowerCase(Locale.ROOT).startsWith("application/json");
        if (json && !name.toLowerCase(Locale.ROOT).endsWith(".json")) name = name + ".json";
        if (name.length() > MAX_EXPORT_NAME_LENGTH) {
            int dot = name.lastIndexOf('.');
            String extension = dot > 0 && name.length() - dot <= 8 ? name.substring(dot) : "";
            name = name.substring(0, MAX_EXPORT_NAME_LENGTH - extension.length()) + extension;
        }
        return name;
    }

    /** Only plain text payloads are exported through the bridge. */
    static String safeMimeType(String mimeType) {
        if (mimeType == null) return "application/json";
        String type = mimeType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        if (type.equals("application/json") || type.equals("text/plain") || type.equals("text/csv")) return type;
        return "application/json";
    }
}
