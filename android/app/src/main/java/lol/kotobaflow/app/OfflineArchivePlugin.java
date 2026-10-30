package lol.kotobaflow.app;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Local files only; neither broad storage permission nor a network account is needed. */
@CapacitorPlugin(name = "OfflineArchive")
public class OfflineArchivePlugin extends Plugin {
    private volatile boolean pickerOpen;

    private Intent documentIntent(String action) {
        Intent intent = new Intent(action);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        return intent;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                String name = column >= 0 ? cursor.getString(column) : null;
                if (name != null && !name.trim().isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // Naming metadata is optional; an otherwise readable archive stays usable.
        }
        return "所选 JSON 备份";
    }

    private void launchPicker(PluginCall call, Intent intent, String callback, File pending) {
        // Plugin methods run on Capacitor's task handler; ActivityResult launchers
        // belong to Android's main thread. Keep file IO off that thread.
        getBridge().executeOnMainThread(() -> {
            try {
                startActivityForResult(call, intent, callback);
            } catch (Exception error) {
                pickerOpen = false;
                if (pending != null) pending.delete();
                call.reject("无法打开本机文件选择器，学习记录未改变", error);
            }
        });
    }

    @PluginMethod
    public void saveArchive(PluginCall call) {
        if (pickerOpen) { call.reject("已有文件选择器打开"); return; }
        File pending = null;
        try {
            String text = call.getString("text", "");
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            ArchiveFilePolicy.requireSize(bytes.length);
            pending = File.createTempFile("archive-export-", ".json", getContext().getCacheDir());
            try (FileOutputStream stream = new FileOutputStream(pending)) {
                stream.write(bytes);
                stream.getFD().sync();
            }
            // Do not put an up-to-8-MiB archive in Android's saved activity Bundle.
            call.getData().remove("text");
            call.getData().put("pendingFile", pending.getName());
            Intent intent = documentIntent(Intent.ACTION_CREATE_DOCUMENT);
            intent.putExtra(Intent.EXTRA_TITLE, ArchiveFilePolicy.safeName(call.getString("name", "progress.json")));
            call.getData().remove("name");
            pickerOpen = true;
            launchPicker(call, intent, "archiveCreated", pending);
        } catch (Exception error) {
            pickerOpen = false;
            if (pending != null) pending.delete();
            call.reject("无法打开保存位置，学习记录未改变", error);
        }
    }

    @ActivityCallback
    private void archiveCreated(PluginCall call, ActivityResult result) {
        pickerOpen = false;
        if (call == null) return;
        String name = call.getString("pendingFile", "");
        if (!name.matches("archive-export-[a-zA-Z0-9-]+\\.json")) {
            call.reject("待保存的备份不存在，请重试");
            return;
        }
        File pending = new File(getContext().getCacheDir(), name);
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            pending.delete();
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData().getData();
        execute(() -> {
            try (InputStream input = new FileInputStream(pending)) {
                byte[] bytes = ArchiveFilePolicy.readBounded(input);
                try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new java.io.IOException("No output stream");
                    output.write(bytes);
                    output.flush();
                }
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) {
                call.reject("备份未能写入所选文件，请重试；学习记录未改变", error);
            } finally {
                pending.delete();
            }
        });
    }

    @PluginMethod
    public void pickArchive(PluginCall call) {
        if (pickerOpen) { call.reject("已有文件选择器打开"); return; }
        try {
            Intent intent = documentIntent(Intent.ACTION_OPEN_DOCUMENT);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "application/octet-stream" });
            pickerOpen = true;
            launchPicker(call, intent, "archiveSelected", null);
        } catch (Exception error) {
            pickerOpen = false;
            call.reject("无法打开本机文件选择器", error);
        }
    }

    @ActivityCallback
    private void archiveSelected(PluginCall call, ActivityResult result) {
        pickerOpen = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData().getData();
        execute(() -> {
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                if (input == null) throw new java.io.IOException("No input stream");
                String text = ArchiveFilePolicy.decode(ArchiveFilePolicy.readBounded(input));
                call.resolve(new JSObject().put("text", text).put("name", displayName(uri)));
            } catch (Exception error) {
                call.reject("无法读取存档，请选择不超过 8 MB 的 UTF-8 JSON 文件", error);
            }
        });
    }
}
