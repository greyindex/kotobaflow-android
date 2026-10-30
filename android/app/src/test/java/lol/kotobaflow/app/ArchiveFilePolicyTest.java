package lol.kotobaflow.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;

public class ArchiveFilePolicyTest {
    @Test public void unicodeArchiveRoundTripPreservesBytes() throws Exception {
        String archive = "{\"name\":\"日本語·学习记录\"}";
        byte[] bytes = archive.getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(bytes, ArchiveFilePolicy.readBounded(new ByteArrayInputStream(bytes)));
        assertEquals(archive, ArchiveFilePolicy.decode(bytes));
    }

    @Test public void sizeLimitIsInclusiveAndReadsAreBounded() throws Exception {
        byte[] maximum = new byte[ArchiveFilePolicy.MAX_BYTES];
        assertEquals(maximum.length, ArchiveFilePolicy.readBounded(new ByteArrayInputStream(maximum)).length);
        assertThrows(IOException.class, () -> ArchiveFilePolicy.readBounded(new ByteArrayInputStream(new byte[maximum.length + 1])));
        assertThrows(IOException.class, () -> ArchiveFilePolicy.readBounded(new ByteArrayInputStream(new byte[0])));
    }

    @Test public void invalidUtf8IsNotSilentlyReplaced() {
        assertThrows(CharacterCodingException.class, () -> ArchiveFilePolicy.decode(new byte[] { (byte) 0xC3, 0x28 }));
    }

    @Test public void outputNameCannotEscapeThePickerSuggestedFilename() {
        assertEquals("kotobaflow-progress.json", ArchiveFilePolicy.safeName("../../secret.json"));
        assertEquals("kotobaflow-progress.json", ArchiveFilePolicy.safeName(null));
        assertEquals("kotobaflow-2026-10-11.json", ArchiveFilePolicy.safeName("kotobaflow-2026-10-11.json"));
    }
}
