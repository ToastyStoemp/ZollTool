package com.getupgames.zolltool;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MyPosPlugin.class);
        registerPlugin(CarbonPaymentPlugin.class);
        registerPlugin(WsServerPlugin.class);
        registerPlugin(FileSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}