package io.github.b33zsm00th.gridlockchess;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;

/**
 * Bridges the bundled native Fairy-Stockfish (arm64) engine to JS over UCI.
 *
 * The engine is shipped as jniLibs/arm64-v8a/libgridlockfsf.so — a native ARM executable (NOT a
 * shared library). With android:extractNativeLibs="true" it is extracted to the app's
 * nativeLibraryDir at install, where Android permits execution (the standard DroidFish technique;
 * Android 10+ forbids exec from writable app storage, so the native-lib dir is the only option).
 *
 * JS talks to it via:
 *   Engine.start()        -> spawns the process, copies variants.ini out of assets, streams stdout
 *   Engine.send({cmd})    -> writes one UCI line to the engine's stdin
 *   Engine.stop()         -> quits the process
 *   addListener('line')   -> every engine stdout line (uci/info/bestmove/...) as { line }
 */
@CapacitorPlugin(name = "Engine")
public class EnginePlugin extends Plugin {
    private Process engineProcess;
    private BufferedWriter engineStdin;
    private Thread readerThread;

    @PluginMethod
    public void start(PluginCall call) {
        try {
            // Always ensure variants.ini is on disk and compute paths — even if the engine is
            // already running — so callers reliably get the variant path (idempotent).
            File variantsFile = new File(getContext().getFilesDir(), "variants.ini");
            try (InputStream in = getContext().getAssets().open("public/variants.ini");
                 FileOutputStream out = new FileOutputStream(variantsFile)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }

            String enginePath = getContext().getApplicationInfo().nativeLibraryDir + "/libgridlockfsf.so";
            File engineFile = new File(enginePath);

            if (engineProcess == null) {
                ProcessBuilder pb = new ProcessBuilder(enginePath);
                pb.redirectErrorStream(true);
                engineProcess = pb.start();
                engineStdin = new BufferedWriter(
                    new OutputStreamWriter(engineProcess.getOutputStream(), StandardCharsets.UTF_8));

                readerThread = new Thread(() -> {
                    try (BufferedReader reader = new BufferedReader(
                            new InputStreamReader(engineProcess.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            JSObject ev = new JSObject();
                            ev.put("line", line);
                            notifyListeners("line", ev);
                        }
                    } catch (Exception e) {
                        JSObject ev = new JSObject();
                        ev.put("line", "[reader error] " + e.getMessage());
                        notifyListeners("line", ev);
                    }
                });
                readerThread.setDaemon(true);
                readerThread.start();
            }

            JSObject ret = new JSObject();
            ret.put("enginePath", enginePath);
            ret.put("engineExists", engineFile.exists());
            ret.put("variantsPath", variantsFile.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("engine start failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String cmd = call.getString("cmd");
        try {
            if (engineStdin == null || cmd == null) {
                call.reject("engine not started");
                return;
            }
            engineStdin.write(cmd);
            engineStdin.write("\n");
            engineStdin.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("send failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            if (engineStdin != null) {
                engineStdin.write("quit\n");
                engineStdin.flush();
            }
            if (engineProcess != null) engineProcess.destroy();
        } catch (Exception ignored) {
        }
        engineProcess = null;
        engineStdin = null;
        call.resolve();
    }
}
