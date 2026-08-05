package io.github.b33zsm00th.gridlockchess;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the local native Fairy-Stockfish bridge before the web layer boots.
        registerPlugin(EnginePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
