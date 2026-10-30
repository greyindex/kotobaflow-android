package lol.kotobaflow.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class NativeShellPolicyTest {

    @Test
    public void parsesOnlyOpaqueHexColours() {
        assertEquals(Integer.valueOf(0xFFF3EFE7), NativeShellPolicy.parseOpaqueColor("#f3efe7"));
        assertEquals(Integer.valueOf(0xFF1B1A17), NativeShellPolicy.parseOpaqueColor(" #1B1A17 "));
        assertNull(NativeShellPolicy.parseOpaqueColor(null));
        assertNull(NativeShellPolicy.parseOpaqueColor("rgb(1, 2, 3)"));
        assertNull(NativeShellPolicy.parseOpaqueColor("#fff"));
        assertNull(NativeShellPolicy.parseOpaqueColor("#80f3efe7"));
    }

    @Test
    public void tellsTabletsFromPhonesByTheShorterSide() {
        // 1080 x 2400 at 420 dpi is 411 dp across: a phone, either way up.
        assertFalse(NativeShellPolicy.isTabletScreen(1080, 2400, 2.625f));
        assertFalse(NativeShellPolicy.isTabletScreen(2400, 1080, 2.625f));
        // 1200 x 1920 at 320 dpi is exactly 600 dp: the first tablet size.
        assertTrue(NativeShellPolicy.isTabletScreen(1200, 1920, 2f));
        assertTrue(NativeShellPolicy.isTabletScreen(2560, 1600, 2f));
        // 1198 px is 599 dp: still a phone.
        assertFalse(NativeShellPolicy.isTabletScreen(1198, 1920, 2f));
        assertFalse(NativeShellPolicy.isTabletScreen(0, 1920, 2f));
        assertFalse(NativeShellPolicy.isTabletScreen(1200, 1920, 0f));
        assertFalse(NativeShellPolicy.isTabletScreen(1200, 1920, Float.NaN));
    }

    @Test
    public void choosesIconsByBackgroundLuminance() {
        assertTrue(NativeShellPolicy.prefersDarkIcons(0xFFF3EFE7));
        assertTrue(NativeShellPolicy.prefersDarkIcons(0xFFFFFFFF));
        assertFalse(NativeShellPolicy.prefersDarkIcons(0xFF1B1A17));
        assertFalse(NativeShellPolicy.prefersDarkIcons(0xFF000000));
        assertFalse(NativeShellPolicy.prefersDarkIcons(0xFF3A4A6B));
    }

    @Test
    public void keepsExportNamesInsideOneSafeFile() {
        assertEquals(
            "kotobaflow-progress-2026-10-02T05-51-00-000Z.json",
            NativeShellPolicy.safeExportName("kotobaflow-progress-2026-10-02T05-51-00-000Z.json", "application/json")
        );
        assertEquals("passwd.json", NativeShellPolicy.safeExportName("../../etc/passwd", "application/json"));
        assertEquals("a-b.json", NativeShellPolicy.safeExportName("C:\\x\\a:b", "application/json"));
        assertEquals("hidden.json", NativeShellPolicy.safeExportName("..hidden", "application/json; charset=utf-8"));
        assertEquals(NativeShellPolicy.DEFAULT_EXPORT_NAME, NativeShellPolicy.safeExportName("", "application/json"));
        assertEquals("notes.txt", NativeShellPolicy.safeExportName("notes.txt", "text/plain"));

        String longName = NativeShellPolicy.safeExportName(new String(new char[200]).replace('\0', 'x') + ".json", "application/json");
        assertEquals(NativeShellPolicy.MAX_EXPORT_NAME_LENGTH, longName.length());
        assertTrue(longName.endsWith(".json"));
    }

    @Test
    public void restrictsExportTypesToText() {
        assertEquals("application/json", NativeShellPolicy.safeMimeType("application/json;charset=utf-8"));
        assertEquals("text/csv", NativeShellPolicy.safeMimeType("TEXT/CSV"));
        assertEquals("application/json", NativeShellPolicy.safeMimeType("text/html"));
        assertEquals("application/json", NativeShellPolicy.safeMimeType(null));
    }
}
