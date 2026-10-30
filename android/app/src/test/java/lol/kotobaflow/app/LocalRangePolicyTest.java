package lol.kotobaflow.app;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import org.junit.Test;
import static org.junit.Assert.*;

public class LocalRangePolicyTest {
    /**
     * What WebView does with the stream of an intercepted response: its size
     * is available(), the request's range is applied against that size by
     * skipping to the first byte, and the rest of the stream is the body.
     */
    private static byte[] readLikeWebView(InputStream stream, String header) throws IOException {
        long[] bounds = LocalRangePolicy.parse(header, stream.available());
        long toSkip = bounds[0];
        while (toSkip > 0) {
            long skipped = stream.skip(toSkip);
            assertTrue("skip past the stream", skipped > 0);
            toSkip -= skipped;
        }
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        byte[] buffer = new byte[64];
        for (int read; (read = stream.read(buffer, 0, buffer.length)) >= 0; ) body.write(buffer, 0, read);
        return body.toByteArray();
    }

    @Test public void webViewReadsExactlyTheRangeFromTheWholeAsset() throws IOException {
        byte[] asset = new byte[1000];
        for (int i = 0; i < asset.length; i++) asset[i] = (byte) i;
        for (String header : new String[] {
            "bytes=100-199", "bytes=0-3", "bytes=0-", "bytes=990-", "bytes=-5", "bytes=500-5000", "bytes=999-999"
        }) {
            long[] range = LocalRangePolicy.parse(header, asset.length);
            InputStream stream = LocalRangePolicy.untilRangeEnd(new ByteArrayInputStream(asset), range);
            byte[] expected = Arrays.copyOfRange(asset, (int) range[0], (int) range[1] + 1);
            assertArrayEquals(header, expected, readLikeWebView(stream, header));
        }
    }

    @Test public void singleRangesMapToInclusiveOffsets() {
        assertArrayEquals(new long[] {0, 99}, LocalRangePolicy.parse("bytes=0-", 100));
        assertArrayEquals(new long[] {10, 19}, LocalRangePolicy.parse("bytes=10-19", 100));
        assertArrayEquals(new long[] {90, 99}, LocalRangePolicy.parse("bytes=90-500", 100));
        assertArrayEquals(new long[] {80, 99}, LocalRangePolicy.parse("bytes=-20", 100));
        assertArrayEquals(new long[] {0, 99}, LocalRangePolicy.parse("bytes=-500", 100));
        assertArrayEquals(new long[] {5, 5}, LocalRangePolicy.parse(" Bytes=5-5 ", 100));
    }

    @Test public void rangesPastTheEndAreUnsatisfiable() {
        long[] past = new long[] {LocalRangePolicy.UNSATISFIABLE, LocalRangePolicy.UNSATISFIABLE};
        assertArrayEquals(past, LocalRangePolicy.parse("bytes=100-", 100));
        assertArrayEquals(past, LocalRangePolicy.parse("bytes=150-200", 100));
        assertArrayEquals(past, LocalRangePolicy.parse("bytes=-0", 100));
        assertArrayEquals(past, LocalRangePolicy.parse("bytes=0-", 0));
    }

    @Test public void otherHeadersReturnTheWholeAsset() {
        for (String header : new String[] {
            null, "", "bytes=", "bytes=-", "bytes=9-3", "bytes=0-1,4-5", "items=0-5",
            "bytes=a-b", "bytes=--5", "bytes=99999999999999999999-"
        }) assertNull(header, LocalRangePolicy.parse(header, 100));
    }

    @Test public void onlyPlainPackagedPathsBecomeAssets() {
        assertEquals("public/data/example_audio_v1/packs/a.ogg",
            LocalRangePolicy.assetPath("/data/example_audio_v1/packs/a.ogg"));
        assertEquals("public/index.html", LocalRangePolicy.assetPath("/index.html"));
        for (String path : new String[] {
            null, "", "/", "data/a.ogg", "/data//a.ogg", "/data/../a.ogg", "/./a.ogg",
            "/data/a.ogg/", "/data\\a.ogg", "/a\0.ogg"
        }) assertNull(path, LocalRangePolicy.assetPath(path));
    }

    @Test public void mediaKeepsItsType() {
        assertEquals("audio/ogg", LocalRangePolicy.mimeType("public/x/AUDIO.OGG"));
        assertEquals("audio/mpeg", LocalRangePolicy.mimeType("public/classics/audio.mp3"));
        assertEquals("application/json", LocalRangePolicy.mimeType("public/index.json"));
        assertEquals("application/octet-stream", LocalRangePolicy.mimeType("public/blob"));
    }
}
