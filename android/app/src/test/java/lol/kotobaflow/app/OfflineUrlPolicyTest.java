package lol.kotobaflow.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class OfflineUrlPolicyTest {
    @Test public void onlyTheBundledOriginCanLoadOrNavigate() {
        assertTrue(OfflineUrlPolicy.isLocal("https://localhost/index.html"));
        assertTrue(OfflineUrlPolicy.isLocal("https://localhost/data/book.json?v=2"));
        assertTrue(OfflineUrlPolicy.isLocal("https://localhost:443/#lesson"));
        for (String url : new String[] {
            "https://example.com", "http://localhost/", "https://localhost:8080/",
            "https://localhost.evil/", "https://user@localhost/", "//localhost/",
            "intent://app", "mailto:user@example.com", "file:///sdcard/page.html",
            "javascript:alert(1)", "data:text/html,test", "not a url", ""
        }) assertFalse(url, OfflineUrlPolicy.isLocal(url));
    }
}
