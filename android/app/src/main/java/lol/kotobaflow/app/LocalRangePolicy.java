package lol.kotobaflow.app;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Byte ranges of packaged assets. WebView treats the stream of an intercepted
 * response as the whole resource: it takes its size from available(), skips
 * to the start of the requested range itself and then reads to the end of the
 * stream, whatever the Content-Length says. Capacitor's answer therefore runs
 * from the start of the range to the end of the file, so an example clip read
 * from a 5 MB pack arrives with the rest of the pack. The app hands WebView
 * the whole asset and ends the stream where the range ends.
 */
final class LocalRangePolicy {
    /**
     * Marks a range that starts past the end of the asset. WebView fails such
     * a request itself, whatever the answer, so it stays with Capacitor.
     */
    static final long UNSATISFIABLE = -2L;

    private static final Pattern SINGLE_RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    private LocalRangePolicy() {}

    /**
     * Inclusive {start, end} of a single "bytes=" range within {@code total}
     * bytes; {@code {UNSATISFIABLE, UNSATISFIABLE}} when it starts past the
     * end; null when the header is ignored and the whole asset is returned
     * (malformed, multiple ranges, or no header).
     */
    static long[] parse(String header, long total) {
        if (header == null || total < 0) return null;
        Matcher match = SINGLE_RANGE.matcher(header.trim().toLowerCase(Locale.ROOT));
        if (!match.matches()) return null;
        String first = match.group(1);
        String last = match.group(2);
        try {
            if (first.isEmpty()) {
                if (last.isEmpty()) return null;
                long suffix = Long.parseLong(last);
                if (suffix == 0 || total == 0) return unsatisfiable();
                return new long[] {Math.max(0L, total - suffix), total - 1};
            }
            long start = Long.parseLong(first);
            if (start >= total) return unsatisfiable();
            long end = last.isEmpty() ? total - 1 : Long.parseLong(last);
            if (end < start) return null;
            return new long[] {start, Math.min(end, total - 1)};
        } catch (NumberFormatException error) {
            return null;
        }
    }

    private static long[] unsatisfiable() {
        return new long[] {UNSATISFIABLE, UNSATISFIABLE};
    }

    /** The asset under public/ for a decoded local URL path, or null when unsafe. */
    static String assetPath(String urlPath) {
        if (urlPath == null || urlPath.length() < 2 || urlPath.charAt(0) != '/') return null;
        if (urlPath.indexOf('\\') >= 0 || urlPath.indexOf('\0') >= 0) return null;
        for (String part : urlPath.substring(1).split("/", -1)) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) return null;
        }
        return "public" + urlPath;
    }

    static String mimeType(String path) {
        String name = path == null ? "" : path.toLowerCase(Locale.ROOT);
        if (name.endsWith(".ogg") || name.endsWith(".oga")) return "audio/ogg";
        if (name.endsWith(".mp3")) return "audio/mpeg";
        if (name.endsWith(".m4a")) return "audio/mp4";
        if (name.endsWith(".wav")) return "audio/wav";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    /**
     * The whole asset from byte 0, ending after the last byte of the inclusive
     * {@code range}. WebView skips to the start of the range on its own.
     */
    static InputStream untilRangeEnd(InputStream whole, long[] range) {
        return new RangeEndStream(whole, range[1] + 1);
    }

    private static final class RangeEndStream extends FilterInputStream {
        private long remaining;

        RangeEndStream(InputStream stream, long length) {
            super(stream);
            remaining = length;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int value = super.read();
            if (value >= 0) remaining--;
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (remaining <= 0) return -1;
            int read = super.read(buffer, offset, (int) Math.min(length, remaining));
            if (read > 0) remaining -= read;
            return read;
        }

        @Override
        public long skip(long count) throws IOException {
            long skipped = super.skip(Math.min(count, remaining));
            if (skipped > 0) remaining -= skipped;
            return skipped;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), remaining);
        }

        @Override
        public boolean markSupported() {
            return false;
        }
    }
}
