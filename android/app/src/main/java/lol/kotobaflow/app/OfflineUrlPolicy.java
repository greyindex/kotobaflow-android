package lol.kotobaflow.app;

import java.net.URI;

final class OfflineUrlPolicy {
    private OfflineUrlPolicy() {}

    static boolean isLocal(String url) {
        try {
            URI uri = new URI(url);
            return "https".equals(uri.getScheme()) && "localhost".equals(uri.getHost()) &&
                uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception error) {
            return false;
        }
    }
}
