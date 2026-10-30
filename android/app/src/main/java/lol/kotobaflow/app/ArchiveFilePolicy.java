package lol.kotobaflow.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;

final class ArchiveFilePolicy {
    static final int MAX_BYTES = 8 * 1024 * 1024;
    private ArchiveFilePolicy() {}

    static void requireSize(int size) throws IOException {
        if (size <= 0 || size > MAX_BYTES) throw new IOException("Archive size outside 1–8 MiB limit");
    }

    static byte[] readBounded(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (output.size() + count > MAX_BYTES) throw new IOException("Archive exceeds 8 MiB");
            output.write(buffer, 0, count);
        }
        requireSize(output.size());
        return output.toByteArray();
    }

    static String decode(byte[] bytes) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString();
    }

    static String safeName(String name) {
        return name != null && name.matches("[a-zA-Z0-9._-]{1,120}\\.json") ? name : "kotobaflow-progress.json";
    }
}
