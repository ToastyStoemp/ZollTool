package com.getupgames.zolltool

import android.app.KeyguardManager
import android.content.Context
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Wakes the device screen from an off/locked state — used by the customer
 * display and the register to turn the terminal back on when a cart update
 * arrives. There is no public Android API to force the screen off; the
 * counterpart is simply holding no wake lock and relying on the terminal's
 * own (short) display timeout.
 */
@CapacitorPlugin(name = "Screen")
class ScreenPlugin : Plugin() {
    @PluginMethod
    fun wake(call: PluginCall) {
        activity.runOnUiThread {
            activity.setTurnScreenOn(true)
            activity.setShowWhenLocked(true)
            val km = activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            km.requestDismissKeyguard(activity, null)
        }
        call.resolve()
    }
}
