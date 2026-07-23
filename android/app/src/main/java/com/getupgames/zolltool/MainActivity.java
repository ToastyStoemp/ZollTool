package com.getupgames.zolltool;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MyPosPlugin.class);
        registerPlugin(WsServerPlugin.class);
        registerPlugin(FileSharePlugin.class);
        registerPlugin(ThermalPrinterPlugin.class);
        registerPlugin(DisplayLinkPlugin.class);
        registerPlugin(ScreenPlugin.class);
        registerPlugin(UpdaterPlugin.class);
        // Flavor-specific payment plugins (SumUp on "full", CarbonPayment on "carbon")
        PaymentSdks.INSTANCE.registerPlugins(this);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        // Flavor-provided payment SDKs may launch their own activities against this one.
        if (PaymentSdks.INSTANCE.handleActivityResult(requestCode, resultCode, data)) return;
        super.onActivityResult(requestCode, resultCode, data);
    }
}
