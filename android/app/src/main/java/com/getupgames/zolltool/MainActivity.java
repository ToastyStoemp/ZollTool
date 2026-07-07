package com.getupgames.zolltool;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MyPosPlugin.class);
        registerPlugin(CarbonPaymentPlugin.class);
        registerPlugin(WsServerPlugin.class);
        registerPlugin(FileSharePlugin.class);
        registerPlugin(SumUpPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        // The SumUp SDK launches its own activities against this one.
        if (SumUpPlugin.Companion.handleActivityResult(requestCode, data)) return;
        super.onActivityResult(requestCode, resultCode, data);
    }
}
